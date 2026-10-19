// The browser at the table: assembles the battle screen's parts and talks to the
// one server. It never decides whose turn it is (CLAUDE.md rules 1 and 2): the
// command window is live only while the server says it's your turn, and an
// action is one POST that is shown if refused and never retried. Every message
// goes through the conductor, which shows events before it logs them (rule 11).
import manifestJson from "../assets/sprites.json";
import orrerySvg from "../assets/orrery/orrery.svg";
import {
  ROLES,
  type ActionId,
  type ActionResponse,
  type BattleState,
  type JoinResponse,
  type MeResponse,
  type RoleId,
  type RoomInfo,
} from "../shared/protocol.ts";
import type { JoinResult, SpriteManifest } from "./battle/api.ts";
import { createConductor } from "./battle/conductor.ts";
import { createLog } from "./battle/log.ts";
import { RENDERERS } from "./battle/registry.ts";
import { createAudio } from "./audio/audio.ts";
import { countdownFraction, mountCommandWindow, type CommandWindow } from "./command/window.ts";
import { door } from "./door.ts";
import { mountJoin } from "./join/join.ts";
import { getJSON, postJSON, watchBattle, watchRoom, type Link, type RoomGone } from "./net.ts";
import { createScene } from "./scene/scene.ts";
import { createStrip } from "./strip/strip.ts";

const manifest = manifestJson as unknown as SpriteManifest;
const OVER = new Set(["won", "lost", "abandoned"]);

function need<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`index.html is missing ${selector}`);
  return el;
}

const battleEl = need<HTMLElement>("#battle");
const announce = need<HTMLElement>("[data-announce]");
const linkEl = need<HTMLElement>("[data-link]");

const parts = { manifest, orrerySvg };
const scene = createScene(need<HTMLElement>("[data-scene]"), parts);
const strip = createStrip(need<HTMLElement>("[data-rail]"), parts);
const audio = createAudio({ muteButton: need<HTMLButtonElement>("[data-mute]") });
const log = createLog(need<HTMLElement>("[data-log]"));
const commandEl = need<HTMLElement>("[data-command]");
const join = mountJoin(need<HTMLElement>("[data-join-screen]"), { manifest, onJoin });

const app = {
  /** The room this page is in (rules 22-24), or null on a bare battle opened by ?battle= (the sensors'). */
  code: null as string | null,
  battleId: "",
  me: null as MeResponse | null,
  myId: null as string | null,
  role: null as RoleId | null,
  state: null as BattleState | null,
  command: null as CommandWindow | null,
  commandRole: null as RoleId | null,
  joinShown: false,
  endedShown: false,
  /** The turn whose hold warning has already sounded (by its deadline). */
  warned: null as number | null,
};

const conductor = createConductor({ scene, strip, audio, log, registry: RENDERERS, onState });

function say(text: string): void {
  announce.textContent = "";
  // a fresh node each time, so the same words twice are announced twice
  requestAnimationFrame(() => (announce.textContent = text));
}

function standing(state: BattleState, id: string | null): boolean {
  return !!id && state.queue.some((t) => t.id === id);
}

function mountCommand(role: RoleId): void {
  if (app.command && app.commandRole === role) return;
  app.command?.destroy();
  commandEl.replaceChildren();
  app.commandRole = role;
  app.command = mountCommandWindow(commandEl, {
    actions: ROLES[role].actions,
    allies: () => {
      const state = app.state;
      if (!state) return [];
      const party = state.queue.filter((t) => t.kind === "character");
      const mine = party.filter((t) => t.id === app.myId);
      return [...mine, ...party.filter((t) => t.id !== app.myId)].map((t) => ({ id: t.id, name: t.id === app.myId ? `${t.name} (you)` : t.name }));
    },
    // Card-target actions aim at the strip's boss cards, never at ally ids (review F7).
    cards: () => (app.state?.cards ?? []).map((c) => ({ id: c.id, name: cardName(c.intent, c.targetId, c.countdown) })),
    onTarget: (targetId) => scene.target(targetId),
    onChoose: (action, targetId) => void choose(action, targetId),
    // The ghost: where the server's preview puts your portrait for this command (rule 1).
    onPreview: (action) => {
      const preview = app.state?.preview;
      const mine = preview && preview.actorId === app.myId ? preview : null;
      strip.preview(mine && action ? mine.actorId : null, mine && action ? (mine.actions[action] ?? null) : null);
    },
  });
}

/** A boss card as the command window names it: what, at whom, how soon. */
function cardName(intent: string, targetId: string | null, countdown: number): string {
  const label = intent.charAt(0).toUpperCase() + intent.slice(1);
  const at =
    targetId === "party" ? "everyone" : targetId === null ? "the strip" : (app.state?.queue.find((t) => t.id === targetId)?.name ?? "someone");
  const when = countdown <= 0 ? "next" : `in ${countdown}`;
  return `${label} on ${at}, ${when}`;
}

async function choose(action: ActionId, targetId: string | null): Promise<void> {
  scene.target(null);
  app.command?.setEnabled(false);
  const res = await postJSON<ActionResponse>(
    `/api/battles/${app.battleId}/actions`,
    targetId && targetId !== "orrery" ? { action, targetId } : { action },
  );
  // Refused means dropped: say so, and wait for the server's next word.
  if (!res.ok) say(res.error ?? "That didn't go through.");
}

function onState(state: BattleState): void {
  app.state = state;
  const mine = standing(state, app.myId);
  document.body.dataset.me = app.myId ?? "";

  if (OVER.has(state.status)) {
    battleEl.dataset.phase = "ended";
    app.command?.setEnabled(false);
    app.command?.setCountdown(null);
    if (!app.endedShown) {
      app.endedShown = true;
      join.ended(state.status as "won" | "lost" | "abandoned");
    }
    return;
  }

  if (mine) {
    if (app.joinShown) {
      app.joinShown = false;
      join.hide();
    }
    battleEl.dataset.phase = "fight";
    const token = state.queue.find((t) => t.id === app.myId) ?? null;
    const role = (token?.role ?? app.role) as RoleId;
    mountCommand(role);
    const myTurn = state.status === "fighting" && state.activeId === app.myId;
    app.command?.setEnabled(myTurn);
    // Off-turn, the Reaction is the one thing live, and only at the card the server names (rule 2).
    app.command?.setReactionReady(state.status === "fighting" ? (token?.reactionCard ?? null) : null);
    app.command?.setSeat({ token, preview: myTurn && state.preview?.actorId === app.myId ? state.preview.actions : null });
    app.command?.setCountdown(myTurn ? countdownFraction(state, Date.now()) : null);
  } else {
    battleEl.dataset.phase = "join";
    app.command?.setEnabled(false);
    if (!app.joinShown) {
      app.joinShown = true;
      join.show(app.me);
    }
  }
}

async function onJoin(name: string, role: RoleId): Promise<JoinResult> {
  // In a room, by its code (rule 22); on a bare battle (the sensors'), by its id.
  const path = app.code ? `/api/rooms/${encodeURIComponent(app.code)}/join` : `/api/battles/${app.battleId}/join`;
  const res = await postJSON<JoinResponse>(path, { name, role });
  if (!res.ok || !res.data) return { ok: false, error: res.error ?? "The table couldn't seat you." };
  app.myId = res.data.characterId;
  app.role = role;
  conductor.setMe(app.myId);
  say(`You take your seat as ${ROLES[role].label}.`);
  // The broadcast that seated us usually lands before this POST answers, while
  // myId was still unknown, and the next one may be a whole turn away.
  if (app.state) onState(app.state);
  void loadMe();
  return { ok: true };
}

async function loadMe(): Promise<void> {
  const res = await getJSON<MeResponse>("/api/me");
  if (!res.ok || !res.data) return;
  app.me = res.data;
  if (res.data.character && !app.myId) {
    app.myId = res.data.character.id;
    app.role = res.data.character.role;
    conductor.setMe(app.myId);
  }
}

function setLink(link: Link): void {
  linkEl.dataset.link = link;
  linkEl.textContent = link === "live" ? "Live" : link === "connecting" ? "Connecting" : "Reconnecting";
}

/** The room's fight is now this one (on open, and when a fight ends and the next opens). */
function onRoom(room: RoomInfo): void {
  app.code = room.code;
  battleEl.dataset.room = room.code;
  if (room.battleId === app.battleId) return;
  const next = app.battleId !== "";
  app.battleId = room.battleId;
  battleEl.dataset.battle = room.battleId;
  // A new fight is a new truth: the next state is drawn whole, and the ending is shown afresh.
  conductor.resync();
  if (next) {
    app.endedShown = false;
    app.state = null;
  }
}

/** The room is gone for good (4410: it expired; 4404: there never was one). Said, never retried. */
function onGone(why: RoomGone): void {
  const text = why === "expired" ? "This room has closed: nobody had been at the table for too long." : "There's no room with that code.";
  battleEl.dataset.phase = "closed";
  battleEl.dataset.closed = why;
  app.command?.setEnabled(false);
  app.command?.setReactionReady(null);
  scene.banner(text);
  setLink("live");
  linkEl.textContent = why === "expired" ? "Room closed" : "No such room";
  say(text);
}

async function boot(): Promise<void> {
  setLink("connecting");
  const me = loadMe();
  const bare = new URLSearchParams(location.search).get("battle")?.trim();
  const onLink = (link: Link): void => {
    setLink(link);
    if (link === "reconnecting") conductor.resync();
  };
  if (bare) {
    // A bare battle by id (POST /api/battles): the sensors' way in, kept until they move onto rooms.
    app.battleId = bare;
    battleEl.dataset.battle = bare;
    await me;
    watchBattle(bare, (msg) => conductor.receive(msg), onLink, () => {});
  } else {
    // The front door (rule 23): the address's code, or the room the server's default door names.
    const code = await door(location.search, async (path) => (await getJSON<unknown>(path)).data);
    app.code = code;
    battleEl.dataset.room = code;
    await me;
    watchRoom(code, (msg) => conductor.receive(msg), onRoom, onLink, onGone);
  }
  // The countdown drains between messages too: the clock is stopped while
  // it's your turn, so the server sends nothing until someone acts.
  setInterval(() => {
    const state = app.state;
    if (state && state.activeId === app.myId && state.turnDeadline !== null) {
      const left = countdownFraction(state, Date.now()) ?? 0;
      app.command?.setCountdown(left);
      // a quarter of the turn left: the hold warning, once per turn
      if (left < 0.25 && app.warned !== state.turnDeadline) {
        app.warned = state.turnDeadline;
        audio.play("hold");
      }
    }
  }, 200);
}

void boot();

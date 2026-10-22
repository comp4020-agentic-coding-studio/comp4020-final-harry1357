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
  type EchoResponse,
  type JoinResponse,
  type MeResponse,
  type RoleId,
  type RoomInfo,
  type RoomJoinResponse,
  type StartResponse,
} from "../shared/protocol.ts";
import type { Door, JoinResult, SpriteManifest } from "./battle/api.ts";
import { createConductor } from "./battle/conductor.ts";
import { createLog } from "./battle/log.ts";
import { RENDERERS } from "./battle/registry.ts";
import { createAudio } from "./audio/audio.ts";
import { countdownFraction, mountCommandWindow, type CommandWindow } from "./command/window.ts";
import { door } from "./door.ts";
import { mountJoin } from "./join/join.ts";
import { getJSON, postJSON, watchBattle, watchRoom, type Link, type RoomGone, type Watch } from "./net.ts";
import { createLobby } from "./lobby/lobby.ts";
import { createScreen } from "./screen.ts";
import { createSeats } from "./seats/seats.ts";
import { createScene } from "./scene/scene.ts";
import { prompts } from "./command/prompts.ts";
import { createStrip } from "./strip/strip.ts";

const manifest = manifestJson as unknown as SpriteManifest;

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
const joinEl = need<HTMLElement>("[data-join-screen]");
const join = mountJoin(joinEl, { manifest, onJoin });
const seats = createSeats(need<HTMLElement>("[data-seats]"), { onEcho });
const lobby = createLobby(need<HTMLElement>("[data-lobby]"), {
  onStart: () => roomPost("start"),
  onLeave: () => roomPost("leave"),
  onEcho,
  lastOutcome: () => screen.lastOutcome(),
});
/** Which screen is up (join, lobby, fight, ended), decided in one place: src/client/screen.ts. */
const screen = createScreen({
  root: battleEl,
  banner: (text) => scene.banner(text),
  join: {
    show: () => join.show(app.me, { code: app.code, isPublic: app.state?.room?.isPublic ?? false }),
    hide: () => join.hide(),
    // In a room the link goes on to the room's next fight; on a bare battle, to the front door.
    ended: (outcome) => {
      join.ended(outcome, app.code ? { href: roomHref(app.code), go: goOn } : undefined);
      // The record this fight added, for the welcome when the person sits down again.
      void loadMe();
    },
    clear: () => join.clear(),
  },
  lobby: { show: () => app.state && lobby.show(app.state, app.myId, app.code), hide: () => lobby.hide() },
});

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
  /** The turn whose hold warning has already sounded (by its deadline). */
  warned: null as number | null,
  /** The socket this page is watching, so a change of room can let it go. */
  watch: null as Watch | null,
  /** The public raid's code, once the server's default door has named it. */
  publicCode: null as string | null,
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
    // Restore aims at the fallen: those downed, not those who left (phase two's gate, P2).
    fallen: () => (app.state?.fallen ?? []).filter((t) => t.kind === "character" && t.hp <= 0).map((t) => ({ id: t.id, name: t.name })),
    // Card-target actions aim at the strip's boss cards, never at ally ids (review F7).
    cards: () => (app.state?.cards ?? []).map((c) => ({ id: c.id, name: cardName(c.intent, c.targetId, c.countdown) })),
    // A card aim marks the card on the strip; any other aim lights its target on the field.
    onTarget: (targetId) => {
      const card = !!targetId && !!app.state?.cards.some((c) => c.id === targetId);
      scene.target(card ? null : targetId);
      strip.aim(card ? targetId : null);
    },
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
  // Refused means dropped: say so. The server took nothing, so nothing moved and it broadcasts nothing; the
  // window goes back to what its last word says (still your turn), not dark until the timeout (review R1).
  if (!res.ok) {
    say(res.error ?? "That didn't go through.");
    if (app.state) onState(app.state);
  }
}

function onState(state: BattleState): void {
  app.state = state;
  const mine = standing(state, app.myId);
  document.body.dataset.me = app.myId ?? "";
  seats.render(state, app.myId, app.code);
  const was = screen.phase();
  screen.state(state, app.myId);

  if (screen.phase() !== "fight" || !mine) {
    app.command?.setEnabled(false);
    app.command?.setCountdown(null);
    app.command?.setReactionReady(null);
    return;
  }

  const token = state.queue.find((t) => t.id === app.myId) ?? null;
  const role = (token?.role ?? app.role) as RoleId;
  mountCommand(role);
  const myTurn = state.status === "fighting" && state.activeId === app.myId;
  app.command?.setEnabled(myTurn);
  // Off-turn, the Reaction is the one thing live, and only at the card the server names (rule 2).
  app.command?.setReactionReady(state.status === "fighting" ? (token?.reactionCard ?? null) : null);
  app.command?.setSeat({
    token,
    preview: myTurn && state.preview?.actorId === app.myId ? state.preview.actions : null,
    prompts: prompts(state, token),
  });
  app.command?.setCountdown(myTurn ? countdownFraction(state, Date.now()) : null);
  // Just came into the fight (from the join screen or the lobby): focus goes to the commands, not the page body
  // (phase two's gate, P1), unless the person has already put it somewhere else.
  const lobbyEl = document.querySelector("[data-lobby]");
  if (
    was !== "fight" &&
    (!document.activeElement || document.activeElement === document.body || joinEl.contains(document.activeElement) || !!lobbyEl?.contains(document.activeElement))
  ) {
    app.command?.focus();
  }
}

/**
 * Sit down through the chosen door (rules 22-23). The public raid is whatever
 * room the server's default door names; a new room is made by sitting down in
 * it; a code is joined as given and refused if there's no such room. Once
 * seated, the page watches the room it sat down in.
 */
async function onJoin(door: Door, name: string, role: RoleId): Promise<JoinResult> {
  let res: { ok: boolean; data: JoinResponse | null; error: string | null };
  let code: string | null = app.code;
  if (door.kind === "here") {
    // A bare battle by id (the sensors'), or the room this page already watches.
    const path = app.code ? `/api/rooms/${encodeURIComponent(app.code)}/join` : `/api/battles/${app.battleId}/join`;
    res = await postJSON<JoinResponse>(path, { name, role });
  } else if (door.kind === "create") {
    const made = await postJSON<RoomJoinResponse>("/api/rooms", { name, role });
    res = made;
    code = made.data?.code ?? null;
  } else {
    code = door.kind === "raid" ? await publicRaid() : door.code;
    const joined = await postJSON<RoomJoinResponse>(`/api/rooms/${encodeURIComponent(code)}/join`, { name, role });
    res = joined;
    if (joined.status === 404) return { ok: false, error: "There's no room with that code." };
  }
  if (!res.ok || !res.data) return { ok: false, error: res.error ?? "The table couldn't seat you." };
  app.myId = res.data.characterId;
  app.role = role;
  conductor.setMe(app.myId);
  if (code && code !== app.code) enter(code);
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

/** The public raid's code, as the server's default door names it (never assumed). */
async function publicRaid(): Promise<string> {
  app.publicCode ??= await door("", async (path) => (await getJSON<unknown>(path)).data);
  return app.publicCode;
}

/** Watch another room from now on (after sitting down in it): the old socket goes, the conductor starts fresh. */
function enter(code: string): void {
  app.watch?.stop();
  app.code = code;
  app.battleId = "";
  app.state = null;
  // A new room is a clean screen: nothing of the last fight stays up (ADR-009).
  screen.entered();
  battleEl.dataset.room = code;
  delete battleEl.dataset.closed;
  conductor.resync();
  // The address carries a private room's code, so a reload, or a link, comes back to it.
  const search = code === app.publicCode ? "" : `?room=${encodeURIComponent(code)}`;
  if (location.search !== search) history.replaceState(null, "", `${location.pathname}${search}`);
  app.watch = watchRoom(code, (msg) => conductor.receive(msg), onRoom, onLinkChange, onGone);
}

/** The host's Start, or leaving the lobby (rule 27): the server's refusal, or null. */
async function roomPost(what: "start" | "leave"): Promise<string | null> {
  if (!app.code) return "There's no room to do that in.";
  const res = await postJSON<StartResponse>(`/api/rooms/${encodeURIComponent(app.code)}/${what}`, {});
  if (!res.ok) return res.error ?? "The table couldn't do that.";
  if (what === "leave") {
    // Left the lobby: off to the front door, as someone seated nowhere.
    location.assign("/");
  }
  return null;
}

/** Seat an Echo in this room (rule 25): the server's refusal, or null. */
async function onEcho(role: RoleId): Promise<string | null> {
  if (!app.code) return "Echoes are seated in a room.";
  const res = await postJSON<EchoResponse>(`/api/rooms/${encodeURIComponent(app.code)}/echoes`, { role });
  return res.ok ? null : (res.error ?? "The table couldn't seat the Echo.");
}

function onLinkChange(link: Link): void {
  setLink(link);
  if (link === "reconnecting") conductor.resync();
}

/** The room's fight is now this one (on open, and when a fight ends and the next opens). */
function onRoom(room: RoomInfo): void {
  app.code = room.code;
  battleEl.dataset.room = room.code;
  if (room.battleId === app.battleId) return;
  const next = app.battleId !== "";
  app.battleId = room.battleId;
  battleEl.dataset.battle = room.battleId;
  // A new fight is a new truth: the next state is drawn whole. A fight that just ended in this room is
  // still shown and written down first (conductor.next); then the screen is clean for the next fight:
  // its lobby, with the last fight's outcome on it, or for someone not seated in it, the end panel
  // until they go on (src/client/screen.ts).
  if (next) {
    app.state = null;
    screen.entered();
    conductor.next();
  } else conductor.resync();
}

/** A room's address: the public raid's is the front door. */
function roomHref(code: string): string {
  return code === app.publicCode ? "/" : `/?room=${encodeURIComponent(code)}`;
}

/** The end panel's link, in a room: sit down for the room's next fight, or, if the room has closed, the front door. */
function goOn(): void {
  if (battleEl.dataset.closed) {
    location.assign("/");
    return;
  }
  screen.goOn();
  if (app.state) onState(app.state);
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
  // The room's gone: an end panel up for its last fight goes on to the front door, not back into it, and
  // still says how that fight ended (breaker Q2).
  const outcome = screen.lastOutcome();
  if (screen.phase() === "ended" && outcome) join.ended(outcome);
  lobby.hide();
}

async function boot(): Promise<void> {
  setLink("connecting");
  const me = loadMe();
  const bare = new URLSearchParams(location.search).get("battle")?.trim();
  if (bare) {
    // A bare battle by id (POST /api/battles): the sensors' way in, kept until they move onto rooms.
    app.battleId = bare;
    battleEl.dataset.battle = bare;
    await me;
    app.watch = watchBattle(bare, (msg) => conductor.receive(msg), onLinkChange, () => {});
  } else {
    // The front door (rule 23): the address's code, or the room the server's default door names.
    const code = await door(location.search, async (path) => (await getJSON<unknown>(path)).data);
    if (!new URLSearchParams(location.search).get("room")) app.publicCode = code;
    app.code = code;
    battleEl.dataset.room = code;
    await me;
    app.watch = watchRoom(code, (msg) => conductor.receive(msg), onRoom, onLinkChange, onGone);
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

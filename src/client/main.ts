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
  type RaidResponse,
  type RoleId,
} from "../shared/protocol.ts";
import type { JoinResult, SpriteManifest } from "./battle/api.ts";
import { createConductor } from "./battle/conductor.ts";
import { createLog } from "./battle/log.ts";
import { RENDERERS } from "./battle/registry.ts";
import { createAudio } from "./audio/audio.ts";
import { mountCommandWindow, type CommandWindow } from "./command/window.ts";
import { mountJoin } from "./join/join.ts";
import { getJSON, postJSON, watchBattle, type Link } from "./net.ts";
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
    onTarget: (targetId) => scene.target(targetId),
    onChoose: (action, targetId) => void choose(action, targetId),
  });
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
    const role = (state.queue.find((t) => t.id === app.myId)?.role ?? app.role) as RoleId;
    mountCommand(role);
    const myTurn = state.status === "fighting" && state.activeId === app.myId;
    app.command?.setEnabled(myTurn);
    app.command?.setCountdown(
      myTurn && state.turnDeadline !== null ? Math.max(0, Math.min(1, (state.turnDeadline - Date.now()) / state.turnMs)) : null,
    );
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
  const res = await postJSON<JoinResponse>(`/api/battles/${app.battleId}/join`, { name, role });
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

async function findBattle(): Promise<string> {
  const fromUrl = new URLSearchParams(location.search).get("battle")?.trim();
  if (fromUrl) return fromUrl;
  for (let attempt = 0; ; attempt++) {
    const res = await getJSON<RaidResponse>("/api/raid");
    if (res.ok && res.data?.battleId) return res.data.battleId;
    await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, 1_000 * 2 ** attempt)));
  }
}

async function boot(): Promise<void> {
  setLink("connecting");
  const me = loadMe();
  app.battleId = await findBattle();
  battleEl.dataset.battle = app.battleId;
  await me;
  watchBattle(
    app.battleId,
    (msg) => conductor.receive(msg),
    (link) => {
      setLink(link);
      if (link === "reconnecting") conductor.resync();
    },
    () => {},
  );
  // The countdown drains between messages too: the clock is stopped while
  // it's your turn, so the server sends nothing until someone acts.
  setInterval(() => {
    const state = app.state;
    if (state && state.activeId === app.myId && state.turnDeadline !== null) {
      const left = Math.max(0, Math.min(1, (state.turnDeadline - Date.now()) / state.turnMs));
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

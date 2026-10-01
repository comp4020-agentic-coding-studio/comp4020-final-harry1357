// The browser at the table. It watches the one rail the server owns and draws
// it; it sends a person's join and their chosen action, and shows what the
// server answers. It never decides whose turn it is (CLAUDE.md, rules 1 and 2).
import type { BattleState, JoinResponse, MeResponse, RaidResponse, RoleId } from "../shared/protocol.ts";
import { renderLog } from "./log.ts";
import { getJSON, watchBattle, type Link, type Watch } from "./net.ts";
import { mountRail, renderFallen } from "./rail.ts";
import { mountSeat } from "./seat.ts";
import { mark, type MarkId } from "./sigils.ts";

const OVER = new Set(["won", "lost", "abandoned"]);

function need<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`index.html is missing ${selector}`);
  return el;
}

const railEl = need<HTMLElement>("[data-rail]");
const railStatus = need<HTMLElement>("[data-rail-status]");
const fallenHost = need<HTMLElement>("[data-fallen]");
const fallenList = need<HTMLElement>("[data-fallen-list]");
const logList = need<HTMLElement>("[data-log]");
const logEmpty = need<HTMLElement>("[data-log-empty]");
const linkEl = need<HTMLElement>("[data-link]");
const bootNote = need<HTMLElement>("[data-boot]");

// The legend wears the same glyphs as the discs.
for (const item of document.querySelectorAll<HTMLElement>("[data-legend]")) {
  item.prepend(mark(item.dataset.legend as MarkId, "mark"));
}

const rail = mountRail(railEl);
const seat = mountSeat(need<HTMLElement>("[data-seat-panel]"), onJoined, () => void loadMe());

const app = {
  battleId: null as string | null,
  state: null as BattleState | null,
  me: null as MeResponse | null,
  /** The character this page has joined with, or the cookie's character. */
  myId: null as string | null,
  joinedRole: null as RoleId | null,
  joined: false,
};

let watch: Watch | null = null;

function inThisBattle(): boolean {
  const { state, myId } = app;
  if (!myId) return false;
  if (app.joined) return true;
  return !!state && (state.queue.some((t) => t.id === myId) || state.fallen.some((t) => t.id === myId));
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function paintStatus(state: BattleState): void {
  const holder = state.queue.find((t) => t.id === state.activeId);
  let phase: string;
  if (state.status === "waiting") phase = "Waiting for the first seat to be taken.";
  else if (state.status === "won") phase = "Won. The Orrery is stilled.";
  else if (state.status === "lost") phase = "Lost. The Orrery stands.";
  else if (state.status === "abandoned") phase = "Abandoned.";
  else if (!holder) phase = "The clock is running.";
  else if (holder.kind === "boss") phase = "The Orrery is on the plate.";
  else phase = `${holder.name}${holder.id === app.myId ? " (you)" : ""} is on the plate.`;

  const key = `${state.tick}|${phase}|${holder?.kind ?? ""}`;
  if (railStatus.dataset.key === key) return;
  railStatus.dataset.key = key;
  railStatus.dataset.holder = holder?.kind ?? "none";
  const tickWord = document.createElement("span");
  tickWord.className = "status-tick";
  const num = document.createElement("span");
  num.className = "num";
  num.textContent = String(state.tick);
  tickWord.append("Tick ", num);
  const phaseEl = document.createElement("span");
  phaseEl.className = "status-phase";
  phaseEl.textContent = phase;
  railStatus.replaceChildren(tickWord, phaseEl);
}

function paint(): void {
  const { state } = app;
  const mine = inThisBattle() ? app.myId : null;
  if (mine) document.body.dataset.me = mine;
  else delete document.body.dataset.me;

  if (state) {
    rail.render(state, mine);
    renderFallen(fallenHost, fallenList, state.fallen, mine);
    renderLog(logList, state.log);
    logEmpty.hidden = state.log.length > 0;
    paintStatus(state);
  }
  if (app.battleId) {
    seat.render({
      battleId: app.battleId,
      state,
      character: app.me?.character ?? null,
      myId: app.myId,
      joinedRole: app.joinedRole,
      joined: app.joined,
    });
  }
}

/** Every state the client draws comes through here, already the newest. */
function receive(state: BattleState): void {
  const wasOver = !!app.state && OVER.has(app.state.status);
  app.state = state;
  bootNote.hidden = true;
  paint();
  if (OVER.has(state.status)) {
    // Nothing more will change on this battle. Stop watching it, and fetch the
    // record again so the trace shows how this one went.
    watch?.stop();
    watch = null;
    setLink("over");
    if (!wasOver) void loadMe();
  }
}

function onJoined(res: JoinResponse): void {
  app.myId = res.characterId;
  app.joinedRole = res.character.role;
  app.joined = true;
  app.me = { character: res.character, battles: app.me?.battles ?? [] };
  paint();
}

function setLink(link: Link | "over"): void {
  const words: Record<Link | "over", string> = {
    connecting: "Connecting to the table…",
    live: "Live",
    reconnecting: "Reconnecting…",
    over: "Battle over",
  };
  linkEl.dataset.link = link;
  setText(linkEl, words[link]);
}

async function loadMe(): Promise<void> {
  const res = await getJSON<MeResponse>("/api/me");
  if (!res.ok || !res.data) return;
  app.me = res.data;
  // The cookie's character is who we are, unless this page already joined.
  if (!app.joined) app.myId = res.data.character?.id ?? null;
  paint();
}

/** When the socket drops, ask once over HTTP whether the battle has ended
 *  (say the server restarted and closed it). A live battle is left to the
 *  reconnect, which brings full state with it. */
async function checkEnded(battleId: string): Promise<void> {
  const res = await getJSON<BattleState>(`/api/battles/${encodeURIComponent(battleId)}`);
  if (res.status === 404) {
    watch?.stop();
    watch = null;
    setLink("over");
    showBoot("This raid is no longer at the table.", true);
    return;
  }
  const state = res.data;
  if (!res.ok || !state || state.battleId !== battleId || !OVER.has(state.status)) return;
  const current = app.state;
  if (current && OVER.has(current.status) && current.version >= state.version) return;
  receive(state);
}

function showBoot(text: string, offerNext = false): void {
  bootNote.hidden = false;
  const line = bootNote.querySelector("[data-boot-line]");
  if (line) setText(line, text);
  const next = bootNote.querySelector<HTMLElement>("[data-boot-next]");
  if (next) next.hidden = !offerNext;
}

async function findBattle(): Promise<string> {
  const fromUrl = new URLSearchParams(location.search).get("battle")?.trim();
  if (fromUrl) return fromUrl;
  for (let attempt = 0; ; attempt++) {
    const res = await getJSON<RaidResponse>("/api/raid");
    if (res.ok && res.data?.battleId) return res.data.battleId;
    showBoot("Looking for the table…");
    await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, 1_000 * 2 ** attempt)));
  }
}

async function boot(): Promise<void> {
  setLink("connecting");
  const mePromise = loadMe();
  const battleId = await findBattle();
  app.battleId = battleId;
  railEl.dataset.battle = battleId;
  // Watch straight away, so a visitor sees the live rail before joining.
  watch = watchBattle(battleId, receive, setLink, () => void checkEnded(battleId));
  paint();
  await mePromise;
}

void boot();

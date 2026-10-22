// A private room's lobby (docs/adr/009; CLAUDE.md rule 27): the room's screen
// before its host's Start. The code to read out, every seat with the host
// marked, the last fight's outcome when there was one, "add an Echo" for the
// roles the server lists (state.echoRoles) and Start, both for the host only,
// and "waiting for the host" for everyone else. It decides nothing: who is host
// is the server's hostId, which roles are open is the server's, and Start and
// each Echo are one POST, refused if the server says so and never retried.
//
// Hooks the sensors and specs drive: section[data-lobby] holds
// [data-lobby-code], one [data-lobby-seat] per seat (data-host, data-mine,
// data-echo), button[data-start], button[data-lobby-leave], one
// button[data-add-echo=<role>] per open role (the host's), and
// [data-lobby-waiting] for everyone else.
import { ECHO_MAX, ROLES, type BattleState, type RoleId, type Token } from "../../shared/protocol.ts";

type Outcome = "won" | "lost" | "abandoned";

export interface LobbyOptions {
  /** The host's Start: the server's refusal, or null. */
  onStart(): Promise<string | null>;
  /** Seat an Echo of this role: the server's refusal, or null. */
  onEcho(role: RoleId): Promise<string | null>;
  /** Leave the lobby: the server's refusal, or null. */
  onLeave(): Promise<string | null>;
  /** How the fight before this lobby ended, if this page saw it end. */
  lastOutcome(): Outcome | null;
}

export interface Lobby {
  show(state: BattleState, myId: string | null, code: string | null): void;
  hide(): void;
}

const OUTCOME_LINE: Readonly<Record<Outcome, string>> = {
  won: "Last fight: victory. The Orrery ground to a halt.",
  lost: "Last fight: defeat. The rings turned on.",
  abandoned: "Last fight: left unfinished.",
};

const CURSOR =
  '<svg viewBox="0 0 5 9" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M0 0h1v1h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1v1h-1z"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const label = (role: string): string => (role in ROLES ? ROLES[role as RoleId].label : role);

export function createLobby(root: HTMLElement, opts: LobbyOptions): Lobby {
  root.hidden = true;
  const panel = el("div", "lobby-panel window");
  const kicker = el("p", "lobby-kicker", "The table is gathering");
  const title = el("h2", "lobby-title", "Waiting room");
  const codeLine = el("p", "lobby-code-line");
  const codeLabel = el("span", "lobby-code-label", "Room code");
  const code = el("span", "lobby-code");
  code.dataset.lobbyCode = "";
  codeLine.append(codeLabel, code);
  const last = el("p", "lobby-last");
  last.hidden = true;
  const seatsTitle = el("p", "lobby-label");
  const list = el("ul", "lobby-seats");
  list.setAttribute("aria-label", "Everyone seated");

  const echoes = el("div", "lobby-echoes");
  const echoTitle = el("p", "lobby-label");
  const echoButtons = el("div", "lobby-echo-buttons");
  echoes.append(echoTitle, echoButtons);

  const actions = el("div", "lobby-actions");
  const start = el("button", "lobby-start");
  start.type = "button";
  start.dataset.start = "";
  const startCursor = el("span", "lobby-cursor");
  startCursor.innerHTML = CURSOR;
  const startText = el("span", "", "Start the fight");
  start.append(startCursor, startText);
  const waiting = el("p", "lobby-waiting");
  waiting.dataset.lobbyWaiting = "";
  const leave = el("button", "lobby-leave", "Leave the table");
  leave.type = "button";
  leave.dataset.lobbyLeave = "";
  actions.append(start, waiting, leave);

  const said = el("p", "lobby-said");
  said.setAttribute("aria-live", "polite");
  panel.append(kicker, title, codeLine, last, seatsTitle, list, echoes, actions, said);
  root.replaceChildren(panel);

  let busy = false;
  let shownKey = "";
  let wasHost: boolean | null = null;
  let current: [BattleState, string | null, string | null] | null = null;

  async function press(work: () => Promise<string | null>, done: string | null): Promise<void> {
    if (busy) return;
    busy = true;
    said.textContent = "";
    if (current) draw(...current, true);
    let refused: string | null;
    try {
      refused = await work();
    } catch {
      refused = "The table couldn't be reached.";
    }
    busy = false;
    said.textContent = refused ?? done ?? "";
    if (current) draw(...current, true);
  }

  start.addEventListener("click", () => void press(opts.onStart, null));
  leave.addEventListener("click", () => void press(opts.onLeave, "You leave the table."));

  function draw(state: BattleState, myId: string | null, roomCode: string | null, force = false): void {
    current = [state, myId, roomCode];
    const seats = state.queue.filter((t): t is Token => t.kind === "character");
    const host = state.hostId;
    const isHost = !!myId && host === myId;
    const outcome = opts.lastOutcome();
    const key = JSON.stringify([busy, roomCode, myId, host, state.echoRoles, outcome, seats.map((t) => [t.id, t.name, t.role, t.seatedBy])]);
    if (key === shownKey && !force) return;
    shownKey = key;

    code.textContent = roomCode ?? "";
    code.setAttribute("aria-label", roomCode ? `Room code ${[...roomCode].join(" ")}` : "No code");
    last.hidden = outcome === null;
    last.textContent = outcome ? OUTCOME_LINE[outcome] : "";
    if (outcome) last.dataset.outcome = outcome;
    else delete last.dataset.outcome;

    const hostName = seats.find((t) => t.id === host)?.name ?? null;
    const people = seats.filter((t) => t.seatedBy === null).length;
    const echoCount = seats.length - people;
    seatsTitle.textContent = `Seated: ${people} ${people === 1 ? "person" : "people"}, ${echoCount} ${echoCount === 1 ? "Echo" : "Echoes"}`;
    list.replaceChildren(
      ...seats.map((t) => {
        const li = el("li", "lobby-seat");
        li.dataset.lobbySeat = t.id;
        li.dataset.role = t.role;
        li.dataset.host = String(t.id === host);
        li.dataset.mine = String(t.id === myId);
        li.dataset.echo = String(t.seatedBy !== null);
        const mark = el("span", "lobby-mark", t.id === host ? "Host" : t.seatedBy !== null ? "Echo" : t.id === myId ? "You" : "");
        const who = el("span", "lobby-name", t.name);
        const role = el("span", "lobby-role", label(t.role));
        for (const node of [mark, who, role]) node.setAttribute("aria-hidden", "true");
        const words = [`${t.name}, ${label(t.role)}`];
        if (t.id === host) words.push("the host");
        if (t.id === myId) words.push("you");
        if (t.seatedBy !== null) words.push("an Echo");
        li.append(mark, who, role, el("span", "visually-hidden", words.join(", ")));
        return li;
      }),
    );

    // The host composes the table: Echoes and Start are theirs; everyone else waits for them.
    echoes.hidden = !isHost;
    echoTitle.textContent = `Echoes ${echoCount} of ${ECHO_MAX}`;
    echoButtons.replaceChildren(
      ...state.echoRoles.map((role) => {
        const button = el("button", "lobby-add");
        button.type = "button";
        button.dataset.addEcho = role;
        button.textContent = `Add a ${label(role)} Echo`;
        button.disabled = busy;
        button.addEventListener("click", () => void press(() => opts.onEcho(role), `A ${label(role)} Echo takes a seat.`));
        return button;
      }),
    );
    if (isHost && state.echoRoles.length === 0) {
      echoButtons.append(el("p", "lobby-none", echoCount >= ECHO_MAX ? `The table has its ${ECHO_MAX} Echoes.` : "No Echo can be seated now."));
    }

    start.hidden = !isHost;
    start.disabled = busy || !isHost;
    waiting.hidden = isHost;
    waiting.textContent = hostName ? `Waiting for ${hostName} to start the fight.` : "Waiting for the host to start the fight.";
    leave.disabled = busy;

    // Just made host (the one before left): say so, once, where a screen reader hears it.
    if (wasHost === false && isHost) said.textContent = "You're the host now: start the fight when the table is ready.";
    wasHost = isHost;
  }

  return {
    show(state, myId, roomCode) {
      const opening = root.hidden;
      root.hidden = false;
      draw(state, myId, roomCode);
      if (opening) {
        const focusable = !start.hidden ? start : leave;
        if (!document.activeElement || document.activeElement === document.body || !root.contains(document.activeElement)) {
          focusable.focus({ preventScroll: true });
        }
      }
    },
    hide() {
      if (root.hidden) return;
      root.hidden = true;
      shownKey = "";
      wasHost = null;
      said.textContent = "";
    },
  };
}

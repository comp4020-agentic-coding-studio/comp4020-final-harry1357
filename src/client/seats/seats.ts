// The table (rules 22-25; docs/adr/007): every seat in the room's fight, the
// room's code where whoever made the room can read it out, and "add an Echo"
// for exactly the roles the server says an Echo can still be seated as
// (state.echoRoles), with the cap of four in plain sight. It decides nothing:
// who is seated, which roles are open and how many Echoes there are are all
// the server's; a press is one POST, refused if the server says so.
//
// Hooks: section[data-seats] holds [data-room-code], one [data-seat] per seat
// (data-echo, data-seated-echo, data-mine, data-out) and one
// button[data-add-echo=<role>] per open role.
import { ECHO_MAX, ROLES, type BattleState, type RoleId, type Token } from "../../shared/protocol.ts";

export interface SeatsOptions {
  /** Seat an Echo of this role; resolves to the server's refusal, or null. */
  onEcho(role: RoleId): Promise<string | null>;
}

export interface Seats {
  /** Draw the table as the server has it. */
  render(state: BattleState, myId: string | null, code: string | null): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const label = (role: string): string => (role in ROLES ? ROLES[role as RoleId].label : role);

/** Who a seat is, in words: never only a colour or a glyph. */
function describe(t: Token, mine: boolean, seater: string | null, out: boolean): string {
  const parts = [`${t.name}, ${label(t.role)}`];
  if (mine) parts.push("you");
  if (t.seatedBy !== null) parts.push(`an Echo, seated by ${seater ?? "someone at the table"}`);
  else if (t.echo) parts.push("an Echo plays this seat until its person is back");
  if (out) parts.push(t.hp > 0 ? "away" : "down");
  return parts.join(", ");
}

export function createSeats(root: HTMLElement, opts: SeatsOptions): Seats {
  root.classList.add("window");
  const title = el("h2", "window-title seats-title", "The table");
  const codeLine = el("p", "seats-room");
  const codeLabel = el("span", "seats-room-label");
  const code = el("span", "seats-code");
  code.dataset.roomCode = "";
  codeLine.append(codeLabel, code);
  const list = el("ul", "seats-list");
  list.setAttribute("aria-label", "Everyone seated");
  const echoes = el("div", "seats-echoes");
  const echoTitle = el("p", "seats-echo-title");
  const echoButtons = el("div", "seats-echo-buttons");
  const said = el("p", "seats-said");
  said.setAttribute("aria-live", "polite");
  echoes.append(echoTitle, echoButtons, said);
  root.replaceChildren(title, codeLine, list, echoes);

  let busy = false;
  let shownKey = "";

  function render(state: BattleState, myId: string | null, roomCode: string | null): void {
    const seats = [...state.queue, ...state.fallen].filter((t) => t.kind === "character");
    const echoCount = seats.filter((t) => t.seatedBy !== null).length;
    const seated = !!myId && state.queue.some((t) => t.id === myId);
    const key = JSON.stringify([
      roomCode,
      state.room?.isPublic ?? null,
      myId,
      seated,
      state.echoRoles,
      seats.map((t) => [t.id, t.name, t.role, t.echo, t.seatedBy, t.hp > 0, state.fallen.includes(t)]),
    ]);
    if (key === shownKey) return;
    shownKey = key;

    // The code, where it can be read out; the public raid has no secret to
    // read; a bare battle by id (the sensors') has no room, and no Echoes.
    const inRoom = state.room !== null && roomCode !== null;
    const isPublic = state.room?.isPublic ?? false;
    codeLabel.textContent = !inRoom ? "This table" : isPublic ? "The public raid" : "Room code";
    code.textContent = inRoom && !isPublic ? roomCode : "";
    code.hidden = !inRoom || isPublic;
    root.dataset.public = String(isPublic);
    echoes.hidden = !inRoom;
    if (inRoom && !isPublic) code.setAttribute("aria-label", `Room code ${[...roomCode].join(" ")}`);

    const names = new Map(seats.map((t) => [t.id, t.name]));
    list.replaceChildren(
      ...seats.map((t) => {
        const out = state.fallen.includes(t);
        const mine = t.id === myId;
        const li = el("li", "seats-seat");
        li.dataset.seat = t.id;
        li.dataset.role = t.role;
        li.dataset.echo = String(t.echo);
        li.dataset.seatedEcho = String(t.seatedBy !== null);
        li.dataset.mine = String(mine);
        if (out) li.dataset.out = t.hp > 0 ? "away" : "down";
        const mark = el("span", "seats-mark", t.seatedBy !== null || t.echo ? "Echo" : mine ? "You" : "");
        mark.setAttribute("aria-hidden", "true");
        const who = el("span", "seats-name", t.name);
        const role = el("span", "seats-role", label(t.role));
        const say = el("span", "visually-hidden", describe(t, mine, t.seatedBy ? (names.get(t.seatedBy) ?? null) : null, out));
        for (const node of [mark, who, role]) node.setAttribute("aria-hidden", "true");
        li.append(mark, who, role, say);
        return li;
      }),
    );

    // Echoes: exactly the roles the server lists, and the cap in plain sight.
    echoTitle.textContent = `Echoes ${echoCount} of ${ECHO_MAX}`;
    echoes.dataset.full = String(echoCount >= ECHO_MAX);
    echoButtons.replaceChildren(
      ...state.echoRoles.map((role) => {
        const button = el("button", "seats-add");
        button.type = "button";
        button.dataset.addEcho = role;
        button.textContent = `Add a ${label(role)} Echo`;
        button.disabled = !seated || busy;
        if (!seated) button.title = "Sit down first: only someone at the table can seat an Echo.";
        button.addEventListener("click", () => void add(role));
        return button;
      }),
    );
    if (state.echoRoles.length === 0) {
      echoButtons.append(el("p", "seats-none", echoCount >= ECHO_MAX ? `The table has its ${ECHO_MAX} Echoes.` : "No Echo can be seated now."));
    }
  }

  async function add(role: RoleId): Promise<void> {
    if (busy) return;
    busy = true;
    for (const b of echoButtons.querySelectorAll("button")) b.disabled = true;
    said.textContent = "";
    let refused: string | null = null;
    try {
      refused = await opts.onEcho(role);
    } catch {
      refused = "The table couldn't seat the Echo.";
    }
    busy = false;
    shownKey = ""; // redraw from the next state, whatever it says
    said.textContent = refused ?? `A ${label(role)} Echo takes a seat.`;
  }

  return { render };
}

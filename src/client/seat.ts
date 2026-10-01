// The seat panel: the join form while you aren't standing in this battle, the
// action panel while you are, and the plain word when the battle ends.
//
// The action buttons follow one rule and nothing else: enabled when the
// server's `activeId` is your character and the battle is "fighting". A click
// sends one POST. If the server refuses (409, not your turn), the refusal is
// shown and dropped: nothing is kept, re-sent, or fired later.
import {
  ACTIONS,
  NAME_MAX,
  ROLE_IDS,
  ROLES,
  type ActionId,
  type ActionRequest,
  type ActionResponse,
  type BattleState,
  type CharacterInfo,
  type JoinResponse,
  type RoleId,
  type Token,
} from "../shared/protocol.ts";
import { postJSON } from "./net.ts";
import { sigil } from "./sigils.ts";

export interface SeatView {
  battleId: string;
  state: BattleState | null;
  character: CharacterInfo | null;
  myId: string | null;
  /** The role this page joined with, until the queue shows our token. */
  joinedRole: RoleId | null;
  joined: boolean;
}

export interface Seat {
  render(view: SeatView): void;
}

const OVER = new Set(["won", "lost", "abandoned"]);

function need<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Rank as a word. It labels the wait; it is never turned into a counter. */
function waitWord(rank: number): string {
  if (rank <= 2) return "short wait";
  if (rank <= 3) return "steady wait";
  return "long wait";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function mountSeat(
  root: HTMLElement,
  onJoined: (res: JoinResponse) => void,
  /** After an action the server accepted: the record has moved on. */
  onActed: () => void,
): Seat {
  const greeting = need<HTMLElement>(root, "[data-greeting]");
  const greetingLine = need<HTMLElement>(greeting, "[data-greeting-line]");
  const record = need<HTMLElement>(greeting, "[data-record]");
  const form = need<HTMLFormElement>(root, "form[data-join]");
  const nameInput = need<HTMLInputElement>(form, 'input[name="name"]');
  const roleOptions = need<HTMLElement>(form, "[data-role-options]");
  const joinError = need<HTMLElement>(form, "[data-join-error]");
  const submit = need<HTMLButtonElement>(form, 'button[type="submit"]');
  const downNote = need<HTMLElement>(root, "[data-down]");
  const seat = need<HTMLElement>(root, "[data-seat]");
  const seatHeading = need<HTMLElement>(seat, "[data-seat-heading]");
  const seatWho = need<HTMLElement>(seat, "[data-seat-who]");
  const seatSigil = need<HTMLElement>(seat, "[data-seat-sigil]");
  const turnLive = need<HTMLElement>(seat, "[data-turn-live]");
  const turnStatus = need<HTMLElement>(seat, "[data-turn-status]");
  const countdown = need<HTMLElement>(seat, "[data-countdown]");
  const actions = need<HTMLElement>(seat, "[data-actions]");
  const actionError = need<HTMLElement>(seat, "[data-action-error]");
  const ending = need<HTMLElement>(root, "[data-ending]");
  const endingLine = need<HTMLElement>(ending, "[data-ending-line]");

  nameInput.maxLength = NAME_MAX;

  // The four roles, from the catalogue, each with its sigil and blurb.
  for (const id of ROLE_IDS) {
    const role = ROLES[id];
    const label = document.createElement("label");
    label.className = "role-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "role";
    input.value = id;
    input.required = true;
    const text = document.createElement("span");
    text.className = "role-text";
    const name = document.createElement("span");
    name.className = "role-name";
    name.textContent = role.label;
    const blurb = document.createElement("span");
    blurb.className = "role-blurb";
    blurb.textContent = role.blurb;
    const moves = document.createElement("span");
    moves.className = "role-moves";
    moves.textContent = role.actions.map((a) => ACTIONS[a].label).join(" · ");
    text.append(name, blurb, moves);
    label.append(input, sigil(id, "sigil role-sigil"), text);
    roleOptions.append(label);
  }

  let view: SeatView | null = null;
  let joining = false;
  let acting = false;
  let builtFor: RoleId | null = null;
  let prefilledFor: string | null = null;
  let wasMyTurn = false;
  let clock: ReturnType<typeof setInterval> | undefined;
  const buttons = new Map<ActionId, HTMLButtonElement>();
  let target: HTMLSelectElement | null = null;

  const myToken = (): Token | undefined =>
    view?.state && view.myId ? view.state.queue.find((t) => t.id === view?.myId) : undefined;

  /** The server's word, read fresh at the moment of asking. */
  const isMyTurn = (): boolean =>
    !!view?.state && !!view.myId && view.state.status === "fighting" && view.state.activeId === view.myId;

  function showJoinError(text: string): void {
    joinError.textContent = text;
    nameInput.setAttribute("aria-invalid", "true");
    // Keep the person in the form: back to the field the refusal is about.
    nameInput.focus();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (joining || !view) return;
    const name = nameInput.value.trim();
    const role = form.querySelector<HTMLInputElement>('input[name="role"]:checked')?.value as RoleId | undefined;
    if (!name) return showJoinError("Give the table a name to call you.");
    if (!role) {
      joinError.textContent = "Choose a role.";
      form.querySelector<HTMLInputElement>('input[name="role"]')?.focus();
      return;
    }
    joining = true;
    submit.disabled = true;
    setText(submit, "Taking a seat…");
    const res = await postJSON<JoinResponse>(`/api/battles/${encodeURIComponent(view.battleId)}/join`, { name, role });
    joining = false;
    submit.disabled = false;
    setText(submit, "Take a seat");
    if (!res.ok || !res.data) {
      const fallback =
        res.status === 409
          ? "That seat can't be taken: the name is already at this table, or the battle is over."
          : res.status === 400
            ? "The table couldn't accept that name or role."
            : "The table didn't answer. Try again.";
      return showJoinError(res.error ?? fallback);
    }
    joinError.textContent = "";
    nameInput.removeAttribute("aria-invalid");
    onJoined(res.data);
    // The form has gone; carry focus to the seat that replaced it.
    seatHeading.focus();
  });

  nameInput.addEventListener("input", () => {
    if (nameInput.getAttribute("aria-invalid")) {
      nameInput.removeAttribute("aria-invalid");
      joinError.textContent = "";
    }
  });

  async function act(id: ActionId): Promise<void> {
    if (!view || acting || !isMyTurn()) return;
    const info = ACTIONS[id];
    const body: ActionRequest = { action: id };
    if (info.target === "ally") body.targetId = target?.value || view.myId || undefined;
    acting = true;
    actionError.textContent = "";
    paint();
    const res = await postJSON<ActionResponse>(`/api/battles/${encodeURIComponent(view.battleId)}/actions`, body);
    acting = false;
    if (!res.ok) {
      // Shown, never retried. The panel goes back to whatever the server says.
      actionError.textContent =
        res.status === 409
          ? `Not your turn: the server refused ${info.label}${res.error ? ` (${res.error})` : ""}.`
          : `${info.label} was refused${res.error ? `: ${res.error}` : "."}`;
    } else {
      actions.focus();
      onActed();
    }
    paint();
  }

  function buildActions(role: RoleId): void {
    if (builtFor === role) return;
    builtFor = role;
    buttons.clear();
    target = null;
    const frag = document.createDocumentFragment();
    const ids = ROLES[role].actions;
    if (ids.some((a) => ACTIONS[a].target === "ally")) {
      const field = document.createElement("label");
      field.className = "field target-field";
      const word = document.createElement("span");
      word.className = "field-label";
      word.textContent = "Ally to aim at";
      target = document.createElement("select");
      target.name = "target";
      field.append(word, target);
      frag.append(field);
    }
    const row = document.createElement("div");
    row.className = "action-row";
    for (const id of ids) {
      const info = ACTIONS[id];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "action-button";
      button.dataset.action = id;
      button.disabled = true;
      const label = document.createElement("span");
      label.className = "action-label";
      label.textContent = info.label;
      const blurb = document.createElement("span");
      blurb.className = "action-blurb";
      blurb.textContent = info.blurb;
      const wait = document.createElement("span");
      wait.className = "action-wait";
      wait.textContent = `${info.target === "ally" ? "On an ally" : info.target === "self" ? "On yourself" : "At the Orrery"}, ${waitWord(info.rank)}`;
      button.append(label, blurb, wait);
      button.addEventListener("click", () => void act(id));
      buttons.set(id, button);
      row.append(button);
    }
    frag.append(row);
    actions.replaceChildren(frag);
  }

  function fillTargets(state: BattleState, myId: string): void {
    if (!target) return;
    const allies = state.queue.filter((t) => t.kind === "character");
    const key = allies.map((t) => `${t.id}:${t.name}:${t.hp}`).join("|");
    if (target.dataset.key === key) return;
    target.dataset.key = key;
    const chosen = target.value;
    const frag = document.createDocumentFragment();
    for (const ally of allies) {
      const option = document.createElement("option");
      option.value = ally.id;
      option.textContent = `${ally.id === myId ? "Yourself" : ally.name} (strength ${ally.hp} of ${ally.maxHp})`;
      frag.append(option);
    }
    target.replaceChildren(frag);
    target.value = allies.some((a) => a.id === chosen) ? chosen : myId;
  }

  function tickClock(): void {
    const deadline = view?.state?.turnDeadline;
    if (!isMyTurn() || !deadline) {
      setText(countdown, "");
      return;
    }
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setText(countdown, `${plural(left, "second", "seconds")} to act before the turn passes.`);
  }

  function paintTurn(state: BattleState, me: Token | undefined): void {
    const mine = isMyTurn();
    // One announcement per turn: on the edge into it, cleared on the way out.
    if (mine && !wasMyTurn) turnLive.textContent = `Your turn, ${me?.name ?? "you"}. Choose an action.`;
    if (!mine && wasMyTurn) turnLive.textContent = "";
    wasMyTurn = mine;

    if (mine) {
      if (!clock) clock = setInterval(tickClock, 250);
    } else if (clock) {
      clearInterval(clock);
      clock = undefined;
    }
    tickClock();

    const holder = state.queue.find((t) => t.id === state.activeId);
    turnStatus.replaceChildren();
    if (mine) {
      turnStatus.dataset.mine = "true";
      turnStatus.textContent = "Your token is on the strike plate.";
      return;
    }
    turnStatus.dataset.mine = "false";
    if (state.status === "waiting") {
      turnStatus.textContent = "The fight hasn't started yet.";
    } else if (!me) {
      turnStatus.textContent = view?.joined ? "Taking your seat at the rail…" : "";
    } else {
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(me.counter);
      const ahead = holder ? ` ${holder.kind === "boss" ? "The Orrery" : holder.name} is on the plate.` : "";
      turnStatus.append(`You are `, num, ` ${me.counter === 1 ? "tick" : "ticks"} from the plate.${ahead}`);
    }
  }

  function paintGreeting(v: SeatView, inBattle: boolean): void {
    const c = v.character;
    greeting.hidden = !c;
    if (!c) return;
    setText(greetingLine, inBattle ? `${c.name}'s record` : `Welcome back, ${c.name}.`);
    const rows: [string, number][] = [
      ["Turns", c.turns],
      ["Damage", c.damage],
      ["Healing", c.healing],
      ["Wins", c.wins],
      ["Losses", c.losses],
    ];
    const key = rows.map((r) => r[1]).join(",");
    if (record.dataset.key === key) return;
    record.dataset.key = key;
    record.replaceChildren(
      ...rows.map(([term, value]) => {
        const div = document.createElement("div");
        const dt = document.createElement("dt");
        dt.textContent = term;
        const dd = document.createElement("dd");
        dd.textContent = value.toLocaleString("en-AU");
        div.append(dt, dd);
        return div;
      }),
    );
  }

  function paint(): void {
    if (!view) return;
    const v = view;
    const state = v.state;
    const over = !!state && OVER.has(state.status);
    const me = myToken();
    const fallen = !!state && !!v.myId && state.fallen.some((t) => t.id === v.myId);
    const standing = !!me;
    const inBattle = standing || fallen || v.joined;

    paintGreeting(v, inBattle);

    // Prefill from the last character this cookie played: the trace on return.
    if (v.character && prefilledFor !== v.character.id) {
      prefilledFor = v.character.id;
      if (!nameInput.value) nameInput.value = v.character.name;
      const radio = form.querySelector<HTMLInputElement>(`input[name="role"][value="${v.character.role}"]`);
      if (radio && !form.querySelector('input[name="role"]:checked')) radio.checked = true;
    }

    form.hidden = over || standing || (v.joined && !fallen);
    downNote.hidden = over || !fallen;
    seat.hidden = over || !(standing || (v.joined && !fallen));
    ending.hidden = !over;

    if (over && state) {
      setText(
        endingLine,
        state.status === "won"
          ? "The Orrery is stilled. The table won."
          : state.status === "lost"
            ? "The table fell. The Orrery won."
            : "This raid was abandoned, and it won't be resumed. The log says why.",
      );
    }

    const role: RoleId | null = me && me.role !== "orrery" ? me.role : v.joinedRole;
    if (!seat.hidden && role) {
      buildActions(role);
      setText(seatWho, `${me?.name ?? v.character?.name ?? "You"}, ${ROLES[role].label}`);
      if (seatSigil.dataset.role !== role) {
        seatSigil.dataset.role = role;
        seatSigil.replaceChildren(sigil(role, "sigil seat-sigil"));
      }
    }
    actions.hidden = seat.hidden || !role;

    if (state && v.myId) fillTargets(state, v.myId);
    const enabled = isMyTurn() && !acting;
    for (const button of buttons.values()) button.disabled = !enabled;
    actions.dataset.enabled = String(enabled);

    if (state) paintTurn(state, me);
    else if (clock) {
      clearInterval(clock);
      clock = undefined;
    }
  }

  return {
    render(next) {
      view = next;
      paint();
    },
  };
}

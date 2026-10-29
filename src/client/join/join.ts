// The character select: the first thing anyone sees, laid over a fight that is
// already playing. It decides nothing. The name and the role are the
// person's; the seat is the server's to give. A refusal is shown here, in the
// person's own form, and never retried. Identity is the cookie the server
// mints (CLAUDE.md rule 3), so there's nothing here but a name and a role.
//
// The hooks the sensors drive are exact, and nothing else may rename them:
// form[data-join], input[name="name"], input[type="radio"][name="role"]
// [value=<roleId>] and button[type="submit"]. The form is built on the first
// show(), so it exists only once it can be seen and clicked.
//
// DOM order is door, then role, then name, then submit, which is also the
// reading order and the Tab order: arrows, Tab, arrows, Tab, type, Tab, Enter.
// You choose where you sit, then who you are at the table, then what it calls
// you. Phase two adds the doors (join the public raid, make a room, enter a
// code: rules 22-23, input[name="door"]) and each role's signature action, and
// a returning session's name is shown fixed, never offered for a rename (rule
// 24). On a bare battle opened by id (the sensors'), there are no doors.
import { ACTIONS, NAME_MAX, ROLE_IDS, ROLES, type CharacterInfo, type MeResponse, type RoleId } from "../../shared/protocol.ts";
import type { Door, Here, Join, JoinOptions, JoinResult, Next, SpriteManifest, SpriteRole } from "../battle/api.ts";
import { foldCode } from "../door.ts";

type Outcome = "won" | "lost" | "abandoned";

const ASSETS = "/assets/";

const ENDINGS: Readonly<Record<Outcome, { title: string; line: string }>> = {
  won: { title: "The Orrery grinds to a halt", line: "Its rings have stopped. The table won this raid." },
  lost: { title: "The table has fallen", line: "Every seat is down, and the rings turn on without you." },
  abandoned: { title: "Nobody stayed", line: "The fight was left unfinished. The Orrery turns on alone." },
};

/** The genre's menu cursor, drawn new: a stepped brass pointer, one cell per pixel. */
const CURSOR =
  '<svg viewBox="0 0 5 9" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M0 0h1v1h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1v1h-1z"/></svg>';

/** The title's "O" is a small orrery: a segmented outer ring with a moon on it,
 *  a counter-turning inner ring, and the ember eye at the centre. Each turning
 *  group carries an invisible hub circle so it turns about the glyph's centre. */
const TITLE =
  '<span class="join-title-the">The</span>' +
  '<span class="join-title-word">' +
  '<svg class="join-glyph" viewBox="-8 -8 16 16" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
  '<g class="join-glyph-outer"><circle r="8" fill="none"/>' +
  '<circle class="join-glyph-ring" r="6.5" fill="none" stroke-width="2" stroke-dasharray="5.6 1.207"/></g>' +
  '<g class="join-glyph-inner"><circle r="8" fill="none"/>' +
  '<circle class="join-glyph-ring-inner" r="3.5" fill="none" stroke-width="1" stroke-dasharray="4.3 1.198"/></g>' +
  '<rect class="join-glyph-core" x="-1" y="-1" width="2" height="2"/>' +
  '<g class="join-glyph-moon"><circle r="8" fill="none"/><rect class="join-glyph-moon-body" x="-1" y="-7.5" width="2" height="2"/></g>' +
  "</svg>" +
  '<span class="join-title-rest">rrery</span></span>' +
  '<span class="join-scale"></span>';

interface Puppet {
  el: HTMLElement;
  sprite: SpriteRole;
  frames: readonly number[];
  fps: number;
  /** ms, so the four don't breathe in step */
  phase: number;
  shown: number;
}

type DoorKind = "raid" | "create" | "code";

interface Form {
  form: HTMLFormElement;
  greeting: HTMLElement;
  doors: HTMLFieldSetElement;
  door: Map<DoorKind, HTMLInputElement>;
  code: HTMLInputElement;
  codeRow: HTMLElement;
  fixedName: HTMLElement;
  nameLabel: HTMLElement;
  name: HTMLInputElement;
  error: HTMLElement;
  radios: Map<RoleId, HTMLInputElement>;
  submit: HTMLButtonElement;
  submitText: HTMLElement;
}

interface End {
  panel: HTMLElement;
  title: HTMLElement;
  line: HTMLElement;
  link: HTMLAnchorElement;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

function welcome(c: CharacterInfo): string {
  return `Welcome back, ${c.name}: ${count(c.turns, "turn")}, ${count(c.wins, "win")}`;
}

const TAGLINE = "A raid for whoever is at the table. Choose where, choose a role, take a seat.";

/** Each role's signature: the one action that says what it is for (docs/design/overhaul.md). */
const SIGNATURE: Readonly<Record<RoleId, keyof typeof ACTIONS>> = {
  warden: "intercept",
  mender: "ward",
  striker: "finisher",
  breaker: "shatter",
  chronist: "delay",
};

/** The doors, in order, and what each button says. */
const DOORS: readonly { kind: DoorKind; label: string; line: string; submit: string }[] = [
  { kind: "raid", label: "Join the public raid", line: "Sit down with whoever is here now.", submit: "Take a seat" },
  { kind: "create", label: "Create a room", line: "A table of your own, behind a code you read out.", submit: "Make the room and sit down" },
  { kind: "code", label: "Enter a code", line: "Someone read you a room's code.", submit: "Sit down in that room" },
];

export function mountJoin(root: HTMLElement, opts: JoinOptions): Join {
  const manifest: SpriteManifest = opts.manifest;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const screenLabel = root.getAttribute("aria-label") ?? "Join the raid";
  const puppets: Puppet[] = [];
  let raf = 0;
  let pending = false;
  /** Where the end panel's link goes on to, when the page has somewhere better than a reload (a room's next fight). */
  let onNext: (() => void) | null = null;
  let shell: HTMLElement | null = null;
  let parts: Form | null = null;
  let end: End | null = null;

  // Nothing until show(): a returning visitor who is already standing never
  // gets one, and an empty veil over their fight would be a bug.
  root.hidden = true;

  // --- the idle loop ------------------------------------------------------

  function place(p: Puppet, index: number): void {
    if (p.shown === index) return;
    p.shown = index;
    const frame = p.frames[index] ?? 0;
    const { cell, columns, box } = p.sprite;
    p.el.style.setProperty("--fx", String((frame % columns) * cell[0] + box[0]));
    p.el.style.setProperty("--fy", String(Math.floor(frame / columns) * cell[1] + box[1]));
  }

  function tick(now: number): void {
    for (const p of puppets) place(p, Math.floor(((now + p.phase) * p.fps) / 1000) % p.frames.length);
    raf = requestAnimationFrame(tick);
  }

  function play(): void {
    if (raf || reduce.matches || root.hidden || !parts || parts.form.hidden || !puppets.length) return;
    raf = requestAnimationFrame(tick);
  }

  /** Under reduced motion the sprites hold their first idle frame. */
  function still(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    for (const p of puppets) place(p, 0);
  }

  reduce.addEventListener("change", () => (reduce.matches ? still() : play()));

  // --- building -----------------------------------------------------------

  function ensureShell(): HTMLElement {
    if (shell) return shell;
    shell = make("div", "join-shell");
    const title = make("div", "join-title");
    // The page's one <h1> already says "The Orrery"; this is its poster.
    title.setAttribute("aria-hidden", "true");
    title.innerHTML = TITLE;
    shell.append(title);
    root.append(shell);
    return shell;
  }

  function puppet(sprite: SpriteRole, index: number): HTMLElement {
    const node = make("span", "join-sprite");
    node.style.backgroundImage = `url("${ASSETS}${sprite.sheet}")`;
    node.style.setProperty("--w", String(sprite.box[2]));
    node.style.setProperty("--h", String(sprite.box[3]));
    node.style.setProperty("--sheet-w", String(sprite.cell[0] * sprite.columns));
    // The art faces left; at the table the party faces the Orrery, to the right.
    if (manifest.facing === "left") node.dataset.mirror = "";
    const idle = sprite.animations.idle;
    const p: Puppet = {
      el: node,
      sprite,
      frames: idle && idle.frames.length ? idle.frames : [0],
      fps: idle && idle.fps > 0 ? idle.fps : 8,
      phase: index * 173,
      shown: -1,
    };
    place(p, 0);
    puppets.push(p);
    return node;
  }

  function card(role: RoleId, index: number): { label: HTMLLabelElement; radio: HTMLInputElement } {
    const info = ROLES[role];
    const label = make("label", "join-card");
    label.dataset.role = role;

    const radio = make("input", "join-radio");
    radio.type = "radio";
    radio.name = "role";
    radio.value = role;
    radio.required = true;
    radio.setAttribute("aria-labelledby", `join-role-${role}`);
    radio.setAttribute("aria-describedby", `join-blurb-${role} join-moves-${role}`);

    const plinth = make("span", "join-plinth");
    plinth.setAttribute("aria-hidden", "true");
    const sprite = manifest.roles[role];
    if (sprite) plinth.append(puppet(sprite, index));

    const heading = make("span", "join-role");
    const mark = make("span", "join-mark");
    mark.innerHTML = CURSOR;
    const name = make("span", "join-role-name", info.label);
    name.id = `join-role-${role}`;
    heading.append(mark, name);

    const blurb = make("span", "join-blurb", info.blurb);
    blurb.id = `join-blurb-${role}`;

    const moves = make("span", "join-moves");
    moves.id = `join-moves-${role}`;
    // Its signature action, named first and marked; then the rest of the role's actions.
    const signature = make("span", "join-signature");
    signature.dataset.signature = SIGNATURE[role];
    signature.append(make("span", "join-signature-label", "Signature "), make("span", "join-move", ACTIONS[SIGNATURE[role]].label));
    moves.append(signature, make("span", "visually-hidden", ". Also: "));
    info.actions
      .filter((id) => id !== SIGNATURE[role])
      .forEach((id, i) => {
        if (i > 0) moves.append(make("span", "visually-hidden", ", "));
        moves.append(make("span", "join-move", ACTIONS[id].label));
      });

    label.append(radio, plinth, heading, blurb, moves);
    return { label, radio };
  }

  function ensureForm(): Form {
    if (parts) return parts;
    const host = ensureShell();

    const form = make("form", "join-form window");
    form.dataset.join = "";
    form.noValidate = true; // errors are said inline, in the live region, never in a browser bubble

    const greeting = make("p", "join-greeting");
    greeting.id = "join-greeting";

    // The doors (rules 22-23): where you'll sit.
    const doors = make("fieldset", "join-doors");
    doors.append(make("legend", "join-label", "Where to sit"));
    const doorList = make("div", "join-door-list");
    const door = new Map<DoorKind, HTMLInputElement>();
    for (const d of DOORS) {
      const option = make("label", "join-door");
      option.dataset.door = d.kind;
      const input = make("input", "join-radio");
      input.type = "radio";
      input.name = "door";
      input.value = d.kind;
      const words = make("span", "join-door-words");
      const doorMark = make("span", "join-mark");
      doorMark.innerHTML = CURSOR;
      words.append(make("span", "join-door-label", d.label), make("span", "join-door-line", d.line));
      option.append(input, doorMark, words);
      doorList.append(option);
      door.set(d.kind, input);
    }
    const codeRow = make("div", "join-code-row");
    const codeLabel = make("label", "join-label", "Room code");
    codeLabel.htmlFor = "join-code";
    const code = make("input", "join-code");
    code.id = "join-code";
    code.name = "code";
    code.type = "text";
    code.maxLength = 8;
    code.spellcheck = false;
    code.setAttribute("autocomplete", "off");
    code.setAttribute("autocapitalize", "characters");
    code.placeholder = "e.g. K3X9P";
    code.setAttribute("aria-describedby", "join-error");
    codeRow.append(codeLabel, code);
    codeRow.hidden = true;
    doors.append(doorList, codeRow);

    const plate = make("div", "join-plate");
    const nameLabel = make("label", "join-label", "Your name");
    nameLabel.htmlFor = "join-name";
    const name = make("input", "join-name");
    name.id = "join-name";
    name.name = "name";
    name.type = "text";
    name.maxLength = NAME_MAX;
    name.required = true;
    name.setAttribute("autocomplete", "nickname");
    name.spellcheck = false;
    name.placeholder = "What the table calls you";
    name.setAttribute("enterkeyhint", "go");
    name.setAttribute("aria-describedby", "join-error");
    const error = make("p", "join-error");
    error.id = "join-error";
    error.setAttribute("aria-live", "polite");
    error.setAttribute("aria-atomic", "true");
    // A returning session's name, fixed for life (rule 24): shown, never offered for a rename.
    const fixedName = make("p", "join-fixed-name");
    fixedName.hidden = true;
    plate.append(nameLabel, name, fixedName, error);

    const cast = make("fieldset", "join-cast");
    const legend = make("legend", "join-label", "Choose your role");
    const deck = make("div", "join-deck");
    const tallest = Math.max(...ROLE_IDS.map((r) => manifest.roles[r]?.box[3] ?? 0), 1);
    deck.style.setProperty("--tallest", String(tallest));
    const cards = make("div", "join-cards");
    const radios = new Map<RoleId, HTMLInputElement>();
    ROLE_IDS.forEach((role, i) => {
      const built = card(role, i);
      radios.set(role, built.radio);
      cards.append(built.label);
    });
    deck.append(cards);
    cast.append(legend, deck);

    const actions = make("div", "join-actions");
    const submit = make("button", "join-submit");
    submit.type = "submit";
    const submitCursor = make("span", "join-cursor");
    submitCursor.innerHTML = CURSOR;
    const submitText = make("span", "join-submit-text", "Take a seat");
    submit.append(submitCursor, submitText);
    actions.append(submit);

    // The name and the button ride one bar that sticks to the foot of the screen (RICE item 1): the seat is
    // always in view, whatever the cards above it run to. Its order in the DOM is unchanged.
    const seat = make("div", "join-seat");
    seat.append(plate, actions);
    form.append(greeting, doors, cast, seat);
    host.append(form);

    name.addEventListener("input", () => {
      if (name.hasAttribute("aria-invalid")) clearError();
    });
    code.addEventListener("input", () => {
      code.value = foldCode(code.value);
      if (code.hasAttribute("aria-invalid")) clearError();
    });
    for (const input of door.values()) {
      input.addEventListener("change", () => {
        form.dataset.doorChosen = ""; // the person's choice: a redraw doesn't undo it
        doorChanged();
      });
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitJoin();
    });

    parts = { form, greeting, doors, door, code, codeRow, fixedName, nameLabel, name, error, radios, submit, submitText };
    return parts;
  }

  function ensureEnd(): End {
    if (end) return end;
    const host = ensureShell();
    const panel = make("div", "join-end window");
    panel.dataset.joinEnd = "";
    const kicker = make("p", "join-label", "The raid is over");
    const title = make("h2", "join-end-title");
    const line = make("p", "join-end-line");
    const link = make("a", "join-next");
    link.href = "/";
    link.addEventListener("click", (event) => {
      if (!onNext) return;
      event.preventDefault();
      onNext();
    });
    const cursor = make("span", "join-cursor");
    cursor.innerHTML = CURSOR;
    link.append(cursor, make("span", "", "Join the next raid"));
    panel.append(kicker, title, line, link);
    host.append(panel);
    end = { panel, title, line, link };
    return end;
  }

  // --- the form's behaviour -------------------------------------------------

  function clearError(): void {
    if (!parts) return;
    parts.error.textContent = "";
    parts.name.removeAttribute("aria-invalid");
    parts.code.removeAttribute("aria-invalid");
  }

  /** The chosen door, or "here" when there are no doors (a bare battle). */
  function chosenDoor(): Door {
    if (!parts || parts.doors.hidden) return { kind: "here" };
    const kind = ([...parts.door].find(([, input]) => input.checked)?.[0] ?? "raid") as DoorKind;
    return kind === "code" ? { kind, code: foldCode(parts.code.value) } : { kind };
  }

  /** The code field shows only behind its door, and the button says where it leads. */
  function doorChanged(): void {
    if (!parts) return;
    const d = chosenDoor();
    parts.codeRow.hidden = d.kind !== "code";
    if (!pending) parts.submitText.textContent = DOORS.find((x) => x.kind === d.kind)?.submit ?? "Take a seat";
  }

  /** Say what went wrong, in the live region, and keep the person in the form. */
  function refuse(message: string): void {
    if (!parts) return;
    parts.error.textContent = message;
    if (parts.name.hidden) {
      // A returning session's name is fixed and its field hidden (rule 24): the refusal itself takes focus,
      // so it's read, and focus doesn't fall to the page body (breaker H20's note).
      parts.error.tabIndex = -1;
      parts.error.focus({ preventScroll: true });
      return;
    }
    parts.name.setAttribute("aria-invalid", "true");
    parts.name.focus({ preventScroll: true });
    parts.name.select();
  }

  function busy(on: boolean): void {
    if (!parts) return;
    pending = on;
    parts.submit.disabled = on;
    if (on) parts.form.setAttribute("aria-busy", "true");
    else parts.form.removeAttribute("aria-busy");
    parts.submitText.textContent = on ? "Taking a seat…" : (DOORS.find((x) => x.kind === chosenDoor().kind)?.submit ?? "Take a seat");
  }

  function chosen(): RoleId | null {
    if (!parts) return null;
    for (const [role, radio] of parts.radios) if (radio.checked) return role;
    return null;
  }

  async function submitJoin(): Promise<void> {
    if (!parts || pending) return;
    const name = parts.name.value.trim();
    const role = chosen();
    if (!name) {
      refuse("Give the table a name to call you.");
      return;
    }
    if (!role) {
      parts.error.textContent = "Choose a role first.";
      parts.radios.get(ROLE_IDS[0])?.focus({ preventScroll: true });
      return;
    }
    const door = chosenDoor();
    if (door.kind === "code" && !/^[A-Z0-9]{4,8}$/.test(door.code)) {
      parts.error.textContent = "A room code is the letters and numbers someone read out.";
      parts.code.setAttribute("aria-invalid", "true");
      parts.code.focus({ preventScroll: true });
      return;
    }
    clearError();
    busy(true);
    let result: JoinResult;
    try {
      result = await opts.onJoin(door, name, role);
    } catch {
      result = { ok: false, error: "The table couldn't seat you." };
    }
    if (result.ok) return; // main.ts hides the screen once the server has us standing
    busy(false);
    refuse(result.error || "The table couldn't seat you.");
  }

  function pick(role: RoleId): void {
    const radio = parts?.radios.get(role);
    if (radio) radio.checked = true;
  }

  function reveal(): void {
    root.hidden = false;
    root.scrollTop = 0;
  }

  return {
    show(me: MeResponse | null, here?: Here) {
      const f = ensureForm();
      // The doors, in a room; none on a bare battle. Opened by a private room's
      // code, its door is the code's, filled in; otherwise the public raid's.
      f.doors.hidden = !here || here.code === null;
      if (here && here.code !== null && !f.form.dataset.doorChosen) {
        const fromCode = !here.isPublic;
        (f.door.get(fromCode ? "code" : "raid") as HTMLInputElement).checked = true;
        if (fromCode) f.code.value = here.code;
      }
      doorChanged();
      if (end) end.panel.hidden = true;
      if (shell) delete shell.dataset.outcome;
      root.setAttribute("aria-label", screenLabel);
      f.form.hidden = false;
      busy(false);
      clearError();

      const known = me?.character ?? null;
      // A name is for life (rule 24): a returning session sees its own, fixed.
      f.name.hidden = !!known;
      f.nameLabel.hidden = !!known;
      f.fixedName.hidden = !known;
      if (known) f.fixedName.textContent = `You sit down as ${known.name}. A name stays with you; your role is yours to choose each fight.`;
      if (known) {
        f.name.value = known.name;
        pick(known.role);
        f.greeting.textContent = welcome(known);
        f.greeting.dataset.returning = "";
        // One press of Enter takes the same seat again; the greeting is what the button says it to.
        f.submit.setAttribute("aria-describedby", "join-greeting");
      } else {
        if (!chosen()) pick(ROLE_IDS[0]);
        f.greeting.textContent = TAGLINE;
        delete f.greeting.dataset.returning;
        f.submit.removeAttribute("aria-describedby");
      }

      reveal();
      if (reduce.matches) still();
      else play();
      (known ? f.submit : (f.radios.get(chosen() ?? ROLE_IDS[0]) ?? f.name)).focus({ preventScroll: true });
    },

    hide() {
      root.hidden = true;
      cancelAnimationFrame(raf);
      raf = 0;
      if (parts) busy(false);
    },

    clear() {
      // A new room or fight is a clean screen (ADR-009): no ending from the last one left up.
      onNext = null;
      if (end) {
        end.panel.hidden = true;
        delete end.panel.dataset.outcome;
      }
      if (shell) delete shell.dataset.outcome;
      root.setAttribute("aria-label", screenLabel);
      if (!parts || parts.form.hidden) {
        root.hidden = true;
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },

    ended(outcome: Outcome, next?: Next) {
      const host = ensureShell();
      const e = ensureEnd();
      // In a room, going on is to the room's next fight, behind its code; elsewhere the front door.
      onNext = next?.go ?? null;
      e.link.href = next?.href ?? "/";
      if (parts) {
        parts.form.hidden = true;
        busy(false);
      }
      cancelAnimationFrame(raf);
      raf = 0;
      const words = ENDINGS[outcome] ?? ENDINGS.abandoned;
      e.title.textContent = words.title;
      e.line.textContent = words.line;
      e.panel.dataset.outcome = outcome;
      e.panel.hidden = false;
      host.dataset.outcome = outcome;
      root.setAttribute("aria-label", "The raid is over");
      reveal();
      e.link.focus({ preventScroll: true });
    },
  };
}

// The wire contract between the one server and every browser at the table.
// Types and display catalogues only. Nothing in this file decides anything:
// turn order, counters, damage and the Orrery's script all live on the server.
// `rank` is here so the client can *label* an action ("a long wait"); the
// client never multiplies it into a counter.
//
// The roles and actions are the design record's (docs/design/overhaul.md,
// Priority 2; CLAUDE.md rules 13-21). Ranks run 1-5 (rule 13); `reaction`
// actions are taken out of turn against a boss card (rule 18).

export type RoleId = "warden" | "mender" | "striker" | "breaker" | "chronist";
export type ActionId =
  // shared by everyone
  | "brace"
  // Warden
  | "intercept"
  | "anchor"
  | "bastion"
  | "counterweight"
  // Mender
  | "veil"
  | "mend"
  | "ward"
  | "quicken"
  | "restore"
  // Striker
  | "riposte"
  | "jab"
  | "cleave"
  | "finisher"
  | "feint"
  // Breaker
  | "fracture"
  | "scan"
  | "pry"
  | "mark"
  | "shatter"
  // Chronist
  | "nudge"
  | "delay"
  | "haste"
  | "relay"
  | "stillpoint";
export type BattleStatus = "waiting" | "fighting" | "won" | "lost" | "abandoned";

/** The Orrery's three rings, outermost first. */
export type RingId = "outer" | "middle" | "inner";
/** What a ring is weak to. Hidden until a Breaker Scans it. */
export type Element = "ember" | "frost" | "aether";

export interface ActionInfo {
  id: ActionId;
  label: string;
  /** The rank term in tickSpeed × rank × hasteMultiplier, 1-5. Display only on the client. 0 for a Reaction, which takes no turn. */
  rank: number;
  /** "boss" aims at a ring (or the Orrery); "ally" needs a standing character's id; "card" needs a boss card's id; "self" needs nothing. */
  target: "boss" | "ally" | "card" | "self";
  /** A Reaction is taken out of turn, once per boss turn, against a telegraphed card (rule 18). */
  reaction?: true;
  /** Which resource it spends, and how much, if any. */
  spends?: { resource: Resource; amount: number | "all" };
  /** A role's signature move: it empties Charge and is the stronger for it (rule 17, ADR-011). */
  signature?: true;
  blurb: string;
}

/** Each role's own resource (docs/design/overhaul.md, Priority 2). Charge is everyone's (rule 17). */
export type Resource = "charge" | "resolve" | "grace" | "momentum" | "insight" | "flux";

export interface RoleInfo {
  id: RoleId;
  label: string;
  blurb: string;
  resource: Exclude<Resource, "charge">;
  /** Brace first: every role has it (rule 17). */
  actions: readonly ActionId[];
}

const a = (info: ActionInfo): ActionInfo => info;

export const ACTIONS: Readonly<Record<ActionId, ActionInfo>> = {
  brace: a({ id: "brace", label: "Brace", rank: 2, target: "self", blurb: "Halve the next blow and bank a Charge (up to 3)." }),

  intercept: a({ id: "intercept", label: "Intercept", rank: 0, target: "card", reaction: true, blurb: "Take a single-target blow meant for an ally." }),
  anchor: a({ id: "anchor", label: "Anchor", rank: 2, target: "card", blurb: "Pull the next targeted boss card onto yourself." }),
  bastion: a({ id: "bastion", label: "Bastion", rank: 4, target: "self", spends: { resource: "resolve", amount: "all" }, signature: true, blurb: "Blunt the next raid-wide card by 40%, more with Charge." }),
  counterweight: a({ id: "counterweight", label: "Counterweight", rank: 3, target: "boss", blurb: "Strike, and leave Exposed scaled by Resolve." }),

  veil: a({ id: "veil", label: "Veil", rank: 0, target: "card", reaction: true, blurb: "Ward whoever a single-target blow is aimed at." }),
  mend: a({ id: "mend", label: "Mend", rank: 2, target: "ally", blurb: "Heal an ally." }),
  ward: a({ id: "ward", label: "Ward", rank: 3, target: "ally", blurb: "Shield an ally a boss card is aimed at. Grace if it holds." }),
  quicken: a({ id: "quicken", label: "Quicken", rank: 3, target: "ally", blurb: "Cut an ally's wait by 30%: they move up the strip." }),
  restore: a({ id: "restore", label: "Restore", rank: 5, target: "ally", spends: { resource: "grace", amount: 3 }, signature: true, blurb: "Bring a fallen ally back to the table, stronger with Charge." }),

  riposte: a({ id: "riposte", label: "Riposte", rank: 0, target: "card", reaction: true, blurb: "Meet a blow aimed at you: guarded, and strike back." }),
  jab: a({ id: "jab", label: "Jab", rank: 1, target: "boss", blurb: "A quick blow. +1 Momentum." }),
  cleave: a({ id: "cleave", label: "Cleave", rank: 3, target: "boss", blurb: "+2 Momentum on a weakness." }),
  finisher: a({ id: "finisher", label: "Finisher", rank: 4, target: "boss", spends: { resource: "momentum", amount: "all" }, signature: true, blurb: "Spend all Momentum and Charge. Double against a Broken ring." }),
  feint: a({ id: "feint", label: "Feint", rank: 2, target: "boss", blurb: "Spend an Exposed stack for a sure Resonance." }),

  fracture: a({ id: "fracture", label: "Fracture", rank: 0, target: "card", reaction: true, blurb: "As a raid-wide card comes, crack the outer ring's shield." }),
  scan: a({ id: "scan", label: "Scan", rank: 2, target: "boss", blurb: "Reveal a ring's weakness to the room." }),
  pry: a({ id: "pry", label: "Pry", rank: 3, target: "boss", blurb: "Strip 2 shield pips if the element matches." }),
  mark: a({ id: "mark", label: "Mark", rank: 2, target: "boss", blurb: "Leave 2 Exposed stacks on a ring." }),
  shatter: a({ id: "shatter", label: "Shatter", rank: 4, target: "boss", spends: { resource: "insight", amount: 3 }, signature: true, blurb: "Break a ring down to 2 pips or fewer; Charge pushes the cards further." }),

  nudge: a({ id: "nudge", label: "Nudge", rank: 0, target: "card", reaction: true, blurb: "Push a boss card back one slot; a Retrograde comes apart." }),
  delay: a({ id: "delay", label: "Delay", rank: 3, target: "card", blurb: "Push the next boss card back one slot." }),
  haste: a({ id: "haste", label: "Haste", rank: 3, target: "ally", blurb: "Halve an ally's next 2 waits." }),
  relay: a({ id: "relay", label: "Relay", rank: 1, target: "self", blurb: "End your turn and hand +25% to the next player." }),
  stillpoint: a({ id: "stillpoint", label: "Stillpoint", rank: 5, target: "card", spends: { resource: "flux", amount: "all" }, signature: true, blurb: "Freeze a boss card for a whole cycle; Charge pays for Flux." }),
};

export const ROLES: Readonly<Record<RoleId, RoleInfo>> = {
  warden: { id: "warden", label: "Warden", blurb: "Takes the blows meant for others.", resource: "resolve", actions: ["brace", "intercept", "anchor", "bastion", "counterweight"] },
  mender: { id: "mender", label: "Mender", blurb: "Reads the strip and heals before the hit.", resource: "grace", actions: ["brace", "veil", "mend", "ward", "quicken", "restore"] },
  striker: { id: "striker", label: "Striker", blurb: "Builds Momentum and cashes in a Break.", resource: "momentum", actions: ["brace", "riposte", "jab", "cleave", "finisher", "feint"] },
  breaker: { id: "breaker", label: "Breaker", blurb: "Finds the weakness and cracks the shields.", resource: "insight", actions: ["brace", "fracture", "scan", "pry", "mark", "shatter"] },
  chronist: { id: "chronist", label: "Chronist", blurb: "Bends the turn order itself.", resource: "flux", actions: ["brace", "nudge", "delay", "haste", "relay", "stillpoint"] },
};

export const ROLE_IDS: readonly RoleId[] = ["warden", "mender", "striker", "breaker", "chronist"];

export const BOSS_ID = "orrery";
/** Rule 25: Echoes seated on purpose, one per role, at most this many in a room's fight. The server holds it; the client shows it. */
export const ECHO_MAX = 4;
export const NAME_MAX = 24;

/** One combatant, as the server placed it. */
export interface Token {
  id: string;
  kind: "character" | "boss";
  name: string;
  role: RoleId | "orrery";
  /** Ticks until this combatant reaches the strike plate. 0 = on the plate. */
  counter: number;
  hp: number;
  maxHp: number;
  /** Haste is pending on this combatant's next reset(s). */
  hasted: boolean;
  /** Bracing: takes half damage until its next turn. */
  braced: boolean;
  /** Order of arrival at the table; breaks ties on the same notch. */
  seat: number;
  /** Banked by Brace, max 3 (rule 17). Characters only; 0 for the Orrery. */
  charge: number;
  /** The role's own resource, by name (resolve, grace, momentum, insight, flux). */
  resource: number;
  /** Gravity stacks from the Orrery's Lunge: lethal at 3 unless a second Warden Anchors. */
  gravity: number;
  /** Timed out on their last turn: the portrait dims (rule 8). */
  drifting: boolean;
  /** Three timeouts in a row: the server acts for them, at low output, until they act (rule 8). */
  echo: boolean;
  /** Their one Reaction since the last boss turn is still unspent (rule 18). */
  reactionReady: boolean;
  /** A Mender's Ward stands on them: the next blow is absorbed. */
  warded: boolean;
  /** An Echo seated on purpose (rule 25): who seated it. Null for a person's
   *  seat, the Orrery's, and a person's seat that has timed out into an Echo.
   *  A seated Echo's `echo` is always true and it has no person to come back. */
  seatedBy: string | null;
  /** The boss card this seat's Reaction may answer now, as the server names it
   *  (rule 2: a Reaction is live only against the card the server names); null
   *  when no Reaction is ready or none can answer anything on the strip. */
  reactionCard: string | null;
}

/** Where a turn action would leave its actor, as the server works it out. */
export interface ActionPreview {
  /** The counter the actor would reset to. */
  counter: number;
  /** The slot in the queue, 0 first, the actor would land in: the action played
   *  on a copy, so anyone it moves (a Quicken's ally) is where it leaves them. */
  slot: number;
  /** It would refund a rank (rule 14), aimed at its default target. */
  resonance: boolean;
  /** Why the server would refuse it now, in its own words; null if it wouldn't. */
  refusal: string | null;
  /** The target the server would take with none chosen (an ally, a card, a
   *  ring), or for an ally action it won't take on yourself the first ally it
   *  would; null when it would take none. The window starts its aim here. */
  target: string | null;
}

/** An Exposed stack on a ring, and who set it (rule 16). */
export interface ExposedStack {
  appliedBy: string;
}

/** An Exposed stack that has been spent: who set it, and who spent it (rule 16). */
export interface SpentExposed {
  ringId: RingId;
  appliedBy: string;
  spentBy: string;
}

export interface Ring {
  id: RingId;
  /** Shield pips left. At 0 the ring is Broken. */
  pips: number;
  maxPips: number;
  /** The element it's weak to, once a Breaker has Scanned it; null while hidden. */
  weakness: Element | null;
  broken: boolean;
  /** Stacks waiting to be spent, oldest first, each with who set it. */
  exposed: ExposedStack[];
}

/** What a boss card will do when it resolves. The intent icon on the strip. */
export type Intent =
  | "revolution" // raid-wide damage
  | "eclipse" // single-target damage
  | "lunge" // single-target, adds Gravity
  | "perihelion" // raid-wide, a Break check four slots out
  | "retrograde" // flips the next five slots
  | "alignment"; // the Grand Alignment countdown: a wipe at 0

/** A boss attack, announced on the strip before it resolves (rule 19). */
export interface BossCard {
  id: string;
  intent: Intent;
  /** Who it will land on: a character id, "party" for raid-wide, or null for a card that touches the strip. */
  targetId: string | "party" | null;
  /** The number it will deal before mitigation, if it deals one. */
  amount: number | null;
  /** Slots until it resolves; 0 means it resolves on the Orrery's next turn. */
  countdown: number;
  /** Frozen by Stillpoint: it doesn't count down for a cycle. */
  frozen: boolean;
}

/** Consecutive player turns with no boss card between them (rule 15). */
export interface Chain {
  links: number;
  /** +10% per link, capped at +50%: what the next player turn deals, as a multiplier. */
  potency: number;
}

export interface LogEntry {
  seq: number;
  tick: number;
  kind: "join" | "action" | "boss" | "timeout" | "down" | "leave" | "end" | "system";
  actorId: string | null;
  text: string;
  /** Whether an Echo wrote it: the line's actor was an Echo seat when it was said. The
   *  log speaks in names, so a line is told apart by what wrote it, not by the name in
   *  it (the owner's ruling on phase two's gate, Q4). */
  echo: boolean;
}

export interface BattleState {
  battleId: string;
  /** Bumped on every broadcast. Two clients holding the same version hold the same state. */
  version: number;
  tick: number;
  /** How long one tick is on this server, in ms: what "within one tick" means here. */
  tickMs: number;
  /** How long a person on the strike plate has before the server Braces for them, in ms. */
  turnMs: number;
  /** How long whoever is on the plate now has, in ms: a person's turnMs, or an
   *  Echo's short beat for its person to reclaim the seat (rule 8). Null when no
   *  character is on the plate. Draw the countdown against this, not turnMs. */
  plateMs: number | null;
  status: BattleStatus;
  /** Whose turn it is, or null while the clock is running. Only the server sets this. */
  activeId: string | null;
  /** Epoch ms when the active character's turn times out; null if nobody human is on the plate. */
  turnDeadline: number | null;
  /** Standing combatants in turn order, as the server decided it. Render in this order. */
  queue: Token[];
  /** Characters who have fallen or left, off the rail. */
  fallen: Token[];
  /** The Orrery's phase: 1 Outer Ring, 2 Conjunction (below 70%), 3 Grand Alignment (below 35%). */
  phase: 1 | 2 | 3;
  /** The Orrery's rings, outermost first. */
  rings: Ring[];
  /** Boss attacks announced and waiting, soonest first. */
  cards: BossCard[];
  chain: Chain;
  /** Seats counted when the Orrery's HP was set at the pull (an Echo is half a seat). */
  pullSeats: number;
  /** Exposed stacks once spent: who set each and who spent it (rule 16). A
   *  client that connects late still sees both, not only from the event. */
  spentExposed: SpentExposed[];
  /** The room this fight is in (rules 22-24), or null for a bare battle. */
  room: { code: string; isPublic: boolean } | null;
  /** For whoever is on the plate, where each of their turn actions would leave
   *  them (rule 1: the client draws this ghost and never computes it). Null while
   *  the clock runs, or when the Orrery is on the plate. */
  preview: { actorId: string; actions: Partial<Record<ActionId, ActionPreview>> } | null;
  /** How many Alignments are still to resolve before the Grand Alignment's wipe; null until it begins, in phase
   *  III or past the Orrery's fortieth turn, whatever the phase (the enrage, ADR-010). */
  alignmentLeft: number | null;
  /** Gravity stacks at which the next Lunge on a seat is lethal (ADR-011's GRAVITY_LETHAL). The screen marks a
   *  seat's Gravity lethal from this, never from a number of its own (the owner's ruling, C3). */
  gravityLethal: number;
  /** Whether a Warden's Bastion stands against the next blow on everyone. The
   *  Warden's prompt to raise one, and the room's mark on the blow it meets,
   *  are drawn from this. */
  bastion: boolean;
  /** The card on the strip a Bastion, standing or raised now, would be spent on:
   *  the first Revolution or Perihelion to resolve (an Alignment doesn't spend
   *  one; a frozen card waits a cycle). Null if none is on the strip. The
   *  server's to say, as the Reaction's card is (rule 2). */
  bastionCard: string | null;
  /** The roles an Echo can still be seated as in this fight (rule 25): one per
   *  role, four at most, and only in a private room's lobby (ADR-009); none in
   *  the public raid or once the fight has started. The server decides it;
   *  the client offers exactly these, and only to the host. */
  echoRoles: RoleId[];
  /** Who may press Start (rule 27): a private room's host, the first person
   *  seated and passed on to the next if they leave the lobby. Null in the
   *  public raid and a bare battle, which have no host. The server's to say;
   *  the client draws Start live only for the person it names. */
  hostId: string | null;
  /** This fight is a private room's lobby: waiting on its host's Start, with
   *  no counter running and no card announced (rule 27). */
  lobby: boolean;
  /** Epoch ms when a public raid's (or a bare battle's) waiting fight pulls
   *  (ADR-009's ready window); null otherwise. Drawn as a countdown, decided
   *  by nobody but the server. */
  pullAt: number | null;
  /** The most recent log lines, oldest first. */
  log: LogEntry[];
}

// --- events ---------------------------------------------------------------
// What happened, as well as what is. Every step the server broadcasts carries
// the events that produced it, in order. An event that wrote a log line
// carries that line's `seq`, and the client writes the line only after the
// event's renderer has shown it (CLAUDE.md rule 11). `plate` (someone reached
// the strike plate) writes no line. Every kind here must have a renderer in
// src/client/battle/registry.ts; spec/shown.test.ts holds both sides. Phase one-b
// added "seat" (an Echo seated on purpose, rule 25): the client needs a renderer
// for it, as for every other kind below. The lobby (ADR-009) adds "start",
// "host" and "grow".

export const EVENT_KINDS = [
  // the table
  "join",
  "seat", // an Echo is seated on purpose by someone in the room (rule 25)
  "leave",
  "start", // a private room's host pressed Start (rule 27); the pull follows it
  "host", // a private room's host passed to the next seat (rule 27)
  "down",
  "plate",
  "end",
  // the action economy (rules 8, 14-18)
  "brace", // a Brace: Charge banked
  "hold", // a timeout: the server Braced for them, and the portrait dims
  "echo", // three timeouts: the character is now an Echo (or no longer one)
  "resonance", // a weakness hit refunded a rank: the portrait jumps
  "chain", // the Chain grew, or a boss action broke it
  "exposed", // an Exposed stack applied, or spent, with who did each
  "reaction", // a Reaction taken out of turn against a card
  "sting", // a Reaction's counter-blow on the Orrery (ADR-011)
  // the five roles (docs/design/overhaul.md, Priority 2)
  "intercept",
  "veil", // the Mender's Reaction: the blow's mark is Warded (ADR-011)
  "riposte", // the Striker's Reaction: guarded against the blow aimed at it (ADR-011)
  "fracture", // the Breaker's Reaction: the outer ring's shield cracks (ADR-011)
  "nudge", // the Chronist's Reaction: a card pushed back a slot (ADR-011)
  "anchor",
  "bastion",
  "counterweight",
  "mend",
  "ward",
  "quicken",
  "restore",
  "jab",
  "cleave",
  "finisher",
  "feint",
  "scan",
  "pry",
  "mark",
  "shatter",
  "delay",
  "haste",
  "relay",
  "stillpoint",
  // the Orrery (rule 19-20)
  "card", // a boss card is announced on the strip, with intent, target and countdown
  "pull", // the fight begins and the Orrery's HP is set from the seats present
  "grow", // a late joiner raised the Orrery's max HP, its percentage kept (rule 20)
  "phase", // the Orrery crosses 70% or 35%: a moment on every screen (rule 28)
  "break", // a ring's shield pips reach 0
  "revolution",
  "eclipse",
  "lunge", // the Orrery's Lunge: damage plus a Gravity stack
  "gravity", // three stacks: a lethal Lunge, or an Anchor that took it
  "perihelion",
  "retrograde", // the next five slots flip, or a Chronist cancelled it
  "alignment", // the Grand Alignment ticks down, or reaches 0
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

interface EventBase {
  /** The log line this event wrote; absent for `plate`, `card` and `chain`. */
  seq?: number;
  tick: number;
}

export interface Hit {
  targetId: string;
  amount: number;
}

type Act<K extends string, X = object> = EventBase & { kind: K; actorId: string } & X;
type Boss<K extends string, X = object> = EventBase & { kind: K; actorId: typeof BOSS_ID } & X;

export type BattleEvent =
  | Act<"join", { returning: boolean }>
  // actorId is the Echo; seatedBy the person who seated it.
  | Act<"seat", { role: RoleId; seatedBy: string }>
  | Act<"leave">
  // actorId is the host who pressed it; seats and maxHp are the pull's, for the card.
  | Act<"start", { seats: number; maxHp: number }>
  // actorId is the new host; from, the one who left.
  | Act<"host", { from: string | null }>
  | Act<"down">
  | Act<"plate">
  | (EventBase & { kind: "end"; outcome: "won" | "lost" | "abandoned" })
  | Act<"brace", { charge: number }>
  | Act<"hold", { charge: number; timeouts: number }>
  | Act<"echo", { on: boolean }>
  | Act<"resonance", { from: number; to: number }>
  | (EventBase & { kind: "chain"; links: number; potency: number; broken: boolean })
  | (EventBase & { kind: "exposed"; ringId: RingId; appliedBy: string; spentBy: string | null; stacks: number })
  | Act<"reaction", { action: ActionId; cardId: string }>
  | Act<"intercept", { cardId: string; protectedId: string }>
  // A Reaction's counter-blow (ADR-011): what came off the Orrery.
  | Act<"sting", { amount: number }>
  | Act<"veil", { cardId: string; targetId: string }>
  | Act<"riposte", { cardId: string }>
  | Act<"fracture", { cardId: string; ringId: RingId; pips: number }>
  | Act<"nudge", { cardId: string; countdown: number }>
  | Act<"anchor", { cardId: string }>
  | Act<"bastion", { spent: number; charge: number }>
  | Act<"counterweight", { ringId: RingId; amount: number; exposed: number }>
  | Act<"mend", { targetId: string; amount: number }>
  | Act<"ward", { targetId: string }>
  | Act<"quicken", { targetId: string; from: number; to: number }>
  | Act<"restore", { targetId: string; charge: number }>
  | Act<"jab", { ringId: RingId; amount: number }>
  | Act<"cleave", { ringId: RingId; amount: number; weakness: boolean }>
  | Act<"finisher", { ringId: RingId; amount: number; spent: number; broken: boolean; charge: number }>
  | Act<"feint", { ringId: RingId; amount: number }>
  | Act<"scan", { ringId: RingId; weakness: Element }>
  | Act<"pry", { ringId: RingId; pips: number }>
  | Act<"mark", { ringId: RingId; stacks: number }>
  | Act<"shatter", { ringId: RingId; charge: number }>
  | Act<"delay", { cardId: string; countdown: number }>
  | Act<"haste", { targetId: string }>
  | Act<"relay", { toId: string | null; potency: number }>
  | Act<"stillpoint", { cardId: string; charge: number }>
  | Boss<"card", { card: BossCard }>
  | Boss<"pull", { seats: number; maxHp: number }>
  | Boss<"grow", { seats: number; maxHp: number; hp: number }>
  // name: the phase's, for its card on the strip and its title (rule 28).
  // reshuffled: every ring's weakness hidden again and its element dealt anew (ADR-011).
  | Boss<"phase", { phase: 2 | 3; name: string; reshuffled: boolean }>
  | Boss<"break", { ringId: RingId; by: string }>
  // cardId: the strip card that resolved into this event (phase two).
  | Boss<"revolution", { hits: Hit[]; cardId: string }>
  // `spent`: the card's target had fallen or left, so it landed on nobody and
  // passes over (rule 19; review F8, R1). Drawn as passing, never as a hit.
  | Boss<"eclipse", { targetId: string; amount: number; spent?: true; cardId: string }>
  | Boss<"lunge", { targetId: string; amount: number; gravity: number; spent?: true; cardId: string }>
  | Boss<"gravity", { targetId: string; anchoredBy: string | null; lethal: boolean }>
  | Boss<"perihelion", { hits: Hit[]; broken: boolean; cardId: string }>
  // slots: the portraits it turned about, in the order they stood (none when cancelled).
  // setBack: the ticks every seat's counter was set back by an uncancelled Retrograde (ADR-011); 0 when cancelled.
  | Boss<"retrograde", { flipped: boolean; cancelledBy: string | null; cardId: string; slots: string[]; setBack: number }>
  | Boss<"alignment", { countdown: number; wipe: boolean; cardId: string }>;

/** One member per kind, so this never collapses to `never` (a member whose kind was a pair did). */
export type EventOf<K extends EventKind> = Extract<BattleEvent, { kind: K }>;

/** Every broadcast: the state as it now is, and the events that made it so (empty for a plain tick). */
export type ServerMessage = { type: "state"; battle: BattleState; events: BattleEvent[] };

/** A room as the server describes it (rules 22-23): its code and its fight now. */
export interface RoomInfo {
  code: string;
  isPublic: boolean;
  battleId: string;
}

/**
 * What a room's socket (/ws?room=<code>) carries besides state: the room as it
 * now is. Sent on open, before the first state, and whenever the room's fight
 * changes; every state after it is the new fight's. A battle's own socket
 * (/ws?battle=<id>) never carries one.
 */
export type RoomMessage = { type: "room"; room: RoomInfo };

/**
 * The close code a room's socket is closed with when the room expires (rule 26),
 * reason "This room has closed." A client seeing it must not reconnect: the code
 * is gone (GET /api/rooms/:code answers 404). The battle's own log stays
 * readable by id. Any other close is a dropped connection: reconnect.
 */
export const ROOM_CLOSED_CODE = 4410;

/**
 * Everything a room's socket can carry, and the full list of message types a
 * client renders: "state" (with its events; EVENT_KINDS lists the kinds, and
 * "seat" is the phase-one-b addition that needs a renderer) and "room".
 * Order on open: "room", then "state". On a change of fight: "room", then the
 * new fight's "state" (events empty), then states as usual.
 */
export type RoomSocketMessage = ServerMessage | RoomMessage;

export interface CharacterInfo {
  id: string;
  name: string;
  role: RoleId;
  turns: number;
  damage: number;
  healing: number;
  wins: number;
  losses: number;
}

export interface BattleSummary {
  battleId: string;
  status: BattleStatus;
  createdAt: number;
  endedAt: number | null;
}

// --- HTTP shapes ------------------------------------------------------------

/** GET /api/raid — the open public raid, for anyone arriving without a link. */
export interface RaidResponse {
  battleId: string;
  /** The public raid's room code (rule 23). */
  code: string;
}

/** POST /api/battles → 201 */
export interface NewBattleResponse {
  battleId: string;
}

/** POST /api/battles/:id/join */
export interface JoinRequest {
  name: string;
  role: RoleId;
}
export interface JoinResponse {
  battleId: string;
  characterId: string;
  character: CharacterInfo;
}

/** POST /api/battles/:id/actions */
export interface ActionRequest {
  action: ActionId;
  targetId?: string;
}
export interface ActionResponse {
  ok: true;
  tick: number;
}

/** GET /api/me */
export interface MeResponse {
  character: CharacterInfo | null;
  /** Battles this character took part in, newest first. */
  battles: BattleSummary[];
}

/** GET /api/battles/:id/log */
export interface LogResponse {
  battleId: string;
  status: BattleStatus;
  entries: LogEntry[];
}

/** POST /api/rooms → 201: a seated player's new room (rule 22). */
export interface NewRoomResponse {
  code: string;
  battleId: string;
}

/** GET /api/rooms/:code */
export type RoomResponse = RoomInfo;

/** POST /api/rooms/:code/join, with a JoinRequest: as a battle's join, plus the room. */
export interface RoomJoinResponse extends JoinResponse {
  code: string;
}

/** POST /api/rooms/:code/start → 200: the host's Start (rule 27). POST /api/rooms/:code/leave → 200. */
export interface StartResponse {
  ok: true;
  battleId: string;
}

/** POST /api/rooms/:code/echoes → 201 (rule 25). */
export interface EchoRequest {
  role: RoleId;
}
export interface EchoResponse {
  code: string;
  battleId: string;
  echoId: string;
}

/** Every non-2xx JSON answer. */
export interface ErrorResponse {
  error: string;
}

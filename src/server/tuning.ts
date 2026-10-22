// Every number the overhaul's rules run on, in one place. Where the design
// record (docs/design/overhaul.md) gives a number it is quoted; where it gives
// none, the value here is a starting value of ours, marked "ours", to be
// playtested (the record's Caveats: "starting values to playtest, not
// findings"). The rules in CLAUDE.md 13-21 hold whatever is here.

/** Rule 13: 1 Quick, 2 Light, 3 Standard, 4 Heavy, 5 Ultimate. */
export const RANK_MIN = 1;
export const RANK_MAX = 5;

/** Rule 8: a decision has 12 seconds. */
export const TURN_MS = 12_000;
/** Rule 8: three timeouts in a row make an Echo. */
export const TIMEOUTS_TO_ECHO = 3;
/** Rule 8: an Echo's output, as a share of a person's. Ours (ADR-010: 0.5 couldn't hold a seat at the room's pace). */
export const ECHO_POTENCY = 0.75;
/** Rule 8 (ADR-006, "The Echo"): an Echo on the plate waits this long for its
 *  person to reclaim the seat before the server plays it. */
export const ECHO_BEAT_MS = 3_000;

/** Rule 25 (ADR-007): Echoes seated on purpose, one per role, at most this many in a room's fight. Shared with the client, which shows the cap. */
export { ECHO_MAX } from "../shared/protocol.ts";
/** Rule 26 (ADR-007): a room with no person seated in its fight for this long is gone. ROOM_EMPTY_MS overrides it. */
export const ROOM_EMPTY_MS = 15 * 60 * 1000;

/** Rule 15: +10% per link, capped at +50%. */
export const CHAIN_STEP = 0.1;
export const CHAIN_CAP = 0.5;

/** Rule 17: Brace banks one Charge, to a maximum of 3. */
export const CHARGE_MAX = 3;

/** Relay: +25% to the next player portrait. */
export const RELAY_BONUS = 0.25;
/** Quicken: an ally's counter is cut by 30%. */
export const QUICKEN_CUT = 0.3;
/** Haste: an ally's next 2 waits are halved. */
export const HASTE_RESETS = 2;
/** Bastion: −40% to the next raid-wide card. */
export const BASTION_CUT = 0.4;
/** Mark: 2 Exposed stacks. Pry: 2 pips. Shatter: at 2 pips or fewer, for 3 Insight. */
export const MARK_STACKS = 2;
export const PRY_PIPS = 2;
export const SHATTER_AT = 2;
export const SHATTER_COST = 3;
/** Restore: 3 Grace. */
export const RESTORE_COST = 3;
/** Momentum runs 0-5; Jab +1, Cleave +2 on a weakness. Finisher doubles against a Broken ring. */
export const MOMENTUM_MAX = 5;
export const FINISHER_BROKEN = 2;
/** Resource caps the record doesn't name. Ours. */
export const RESOLVE_MAX = 5;
export const GRACE_MAX = 5;
export const INSIGHT_MAX = 5;
/** Stillpoint needs full Flux. Ours: full is 5. */
export const FLUX_MAX = 5;

/** Rule 20: HP = base × seats^0.75, an Echo half a seat. Base is ours (ADR-010: the Orrery acts three times as often). */
export const ORRERY_BASE_HP = 160;
export const HP_EXPONENT = 0.75;
export const ECHO_SEAT = 0.5;

/** ADR-010: every boss card's amount is the script's × this. Ours. */
export const CARD_DAMAGE = 0.5;

/**
 * ADR-010, rule 28: the Orrery keeps the room's pace. It resets to its own
 * tickSpeed × Standard rank, its tick speed TEMPO ÷ the room's combined rate
 * (Σ 1/tickSpeed over the seats standing), never below TEMPO_MIN ticks. Ours.
 */
export const TEMPO = 2.2;
export const TEMPO_MIN = 2;

/** ADR-009: the public raid's (and a bare battle's) next fight pulls this long after its first seat. Ours. */
export const READY_MS = 8_000;
/** ADR-009: a lobby seat with no socket open on its room for this long has left. Ours. */
export const LOBBY_GRACE_MS = 10_000;

/** Phases: II below 70%, III below 35%. */
export const PHASE_TWO_BELOW = 0.7;
export const PHASE_THREE_BELOW = 0.35;

/** Perihelion: announced 4 slots ahead; the outer ring gets 3 + squads pips. One squad for now. */
export const PERIHELION_LEAD = 4;
export const PERIHELION_BASE_PIPS = 3;
export const SQUADS = 1;
/** Gravity: lethal at 3 stacks. */
export const GRAVITY_LETHAL = 3;
/** Retrograde: flips the next 5 slots. */
export const RETROGRADE_SLOTS = 5;
/** Grand Alignment: every 4th boss card in phase III. */
export const ALIGNMENT_EVERY = 4;
/**
 * ADR-010, "The enrage": past this many Orrery turns, whatever the phase, the
 * Grand Alignment begins (every ALIGNMENT_EVERY-th card, the third the wipe).
 * Ours: past the 12-30 target, so no fight that ends on its own meets it.
 */
export const ENRAGE_AFTER = 40;

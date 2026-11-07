// What the strip asks of a command now, in words, for the command window's
// note (SeatInfo.prompts): one hint per role (ADR-012, piece 3; RICE item 7),
// modelled on the Warden's Bastion while a Perihelion is coming and none
// stands. Each is read from the state every client is sent and nothing else;
// the blow a Bastion would meet first is the server's to say (bastionCard;
// review R2). A hint is advice: it changes an option's words, never whether
// the option is live (rule 2; spec/hints.test.ts). Its own module so a test can
// hold it (third review, M5).
import type { ActionId, BattleState, BossCard, Token } from "../../shared/protocol.ts";
import { bastionFor } from "../strip/cards.ts";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const when = (c: BossCard): string => (c.countdown <= 0 ? "next" : `in ${c.countdown}`);
/** Soonest first, as the server sent them (rule 1: the client never re-sorts the strip). */
const first = (state: BattleState, ok: (c: BossCard) => boolean): BossCard | undefined => (state.cards ?? []).find(ok);
const seat = (state: BattleState, id: string | null): Token | undefined => state.queue.find((t) => t.id === id && t.kind === "character");

export function prompts(state: BattleState, token: Token | null): Partial<Record<ActionId, string>> {
  if (!token || state.status !== "fighting") return {};
  switch (token.role) {
    case "warden":
      return warden(state, token);
    case "mender":
      return mender(state, token);
    case "striker":
      return striker(state);
    case "breaker":
      return breaker(state);
    case "chronist":
      return chronist(state);
    default:
      return {};
  }
}

/** The Warden: Bastion against a Perihelion; Anchor a Lunge aimed at an ally who carries Gravity. */
function warden(state: BattleState, token: Token): Partial<Record<ActionId, string>> {
  const out: Partial<Record<ActionId, string>> = {};
  const asked = bastionFor(state, token);
  if (asked) {
    const before = asked.first ? ` The ${cap(asked.first.intent)}, ${when(asked.first)}, would take one raised now.` : "";
    out.bastion = `Perihelion ${when(asked.card)}: a Bastion blunts it.${before}`;
  }
  const lunge = first(state, (c) => c.intent === "lunge" && c.targetId !== token.id && (seat(state, c.targetId)?.gravity ?? 0) > 0);
  const mark = lunge ? seat(state, lunge.targetId) : undefined;
  if (lunge && mark) out.anchor = `Lunge ${when(lunge)} on ${mark.name}, at Gravity ${mark.gravity}: Anchor it onto yourself.`;
  return out;
}

/** The Mender: a Lunge or Eclipse aimed at a seat that isn't Warded. */
function mender(state: BattleState, token: Token): Partial<Record<ActionId, string>> {
  const blow = first(state, (c) => (c.intent === "lunge" || c.intent === "eclipse") && seat(state, c.targetId)?.warded === false);
  const mark = blow ? seat(state, blow.targetId) : undefined;
  if (!blow || !mark) return {};
  return { ward: mark.id === token.id ? `${cap(blow.intent)} ${when(blow)} on you: Ward yourself.` : `${cap(blow.intent)} ${when(blow)} on ${mark.name}: Ward them.` };
}

/** The Striker: a Broken ring, where a Finisher doubles. */
function striker(state: BattleState): Partial<Record<ActionId, string>> {
  const ring = (state.rings ?? []).find((r) => r.broken);
  return ring ? { finisher: `The ${ring.id} ring is Broken: a Finisher into it doubles.` } : {};
}

/** The Breaker: a revealed weakness on a ring that still has a shield. */
function breaker(state: BattleState): Partial<Record<ActionId, string>> {
  const ring = (state.rings ?? []).find((r) => r.weakness !== null && !r.broken && r.pips > 0);
  return ring ? { pry: `The ${ring.id} ring is weak to ${ring.weakness}: Pry it.` } : {};
}

/** The Chronist: a Retrograde on the strip, which a Delay takes apart. */
function chronist(state: BattleState): Partial<Record<ActionId, string>> {
  const retro = first(state, (c) => c.intent === "retrograde");
  return retro ? { delay: `Retrograde ${when(retro)}: Delay it and it comes apart.` } : {};
}

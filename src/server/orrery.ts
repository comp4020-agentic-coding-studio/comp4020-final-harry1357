// The Orrery (docs/design/overhaul.md, Priority 3; CLAUDE.md rules 19-20).
// Area (c) owns this file: its HP at the pull, its three phases, its rings
// with their shield pips and weaknesses, and its script, every move announced
// on the strip as a card before it resolves.
//
// SCAFFOLD: the Orrery plays a plain Revolution each turn until its script is
// built. The rules owed are in spec/orrery.test.ts, red.

import { BOSS_ID, type BossCard } from "../shared/protocol.ts";
import { downTheFallen, harm, type Ctx, type RingState } from "./rules.ts";
import { HP_EXPONENT, ORRERY_BASE_HP } from "./tuning.ts";

export const NAME = "The Orrery";
export const AGILITY = 40;

/** Base × seats^0.75 (rule 20). */
export function orreryHp(seats: number): number {
  return Math.round(ORRERY_BASE_HP * Math.max(1, seats) ** HP_EXPONENT);
}

/** The three rings at the start of a fight, outermost first. */
export function rings(): RingState[] {
  return [
    { id: "outer", pips: 0, maxPips: 0, weakness: null, element: "ember", broken: false, exposed: [] },
    { id: "middle", pips: 0, maxPips: 0, weakness: null, element: "frost", broken: false, exposed: [] },
    { id: "inner", pips: 0, maxPips: 0, weakness: null, element: "aether", broken: false, exposed: [] },
  ];
}

/** The fight has just begun: lay out the opening cards. */
export function onPull(ctx: Ctx): void {
  void ctx;
}

/** The Orrery has just taken damage: say so if it crossed a phase line. */
export function onWound(ctx: Ctx): void {
  void ctx;
}

/** Put a card on the strip (rule 19). */
export function announce(ctx: Ctx, card: Omit<BossCard, "id" | "frozen">): void {
  const placed: BossCard = { ...card, id: `card-${ctx.b.nextCard++}`, frozen: false };
  ctx.b.cards.push(placed);
  ctx.b.cards.sort((x, y) => x.countdown - y.countdown);
  ctx.emit({ kind: "card", actorId: BOSS_ID, card: { ...placed } });
}

/** The Orrery's turn. */
export function takeTurn(ctx: Ctx): void {
  const amount = 12;
  const hits = ctx.party().map((f) => ({ targetId: f.id, amount: harm(f, amount) }));
  ctx.say("boss", BOSS_ID, `The Orrery turns: Revolution — ${amount} to everyone standing.`, {
    kind: "revolution",
    actorId: BOSS_ID,
    hits,
  });
  downTheFallen(ctx);
  ctx.b.bossTurns += 1;
}

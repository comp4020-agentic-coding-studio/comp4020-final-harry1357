// A1's CTB arithmetic, ported as-is (comp4020-ass1, src/lib/ctb.ts).
//
// The claim it carries: a global tick takes EVERY counter down by exactly 1.
// Haste never touches that rate. It halves the value a counter is *reset to*
// after its owner acts: [tickSpeed × rank × haste], floored. Nothing in this
// file knows about battles; rules.ts uses it.
//
// Sourced in A1 from the community documentation of FFX's battle mechanics
// (SinirothX & SClemmons, "Stat Mechanics FAQ").

export type HasteState = "normal" | "haste";

export const HASTE_MULTIPLIER: Readonly<Record<HasteState, number>> = {
  haste: 0.5,
  normal: 1,
};

/** Rank 3 is Attack, and what a fresh arrival or a held turn resets to. */
export const ATTACK_RANK = 3;

/**
 * Agility maps to tick speed in bands, not continuously. Lower is faster.
 * Read as [minimum Agility, tick speed]; the first band whose minimum is met wins.
 */
const TICK_SPEED_BANDS: readonly (readonly [minAgility: number, tickSpeed: number])[] = [
  [170, 3],
  [98, 4],
  [62, 5],
  [44, 6],
  [35, 7],
  [29, 8],
  [23, 9],
  [19, 10],
  [17, 11],
  [15, 12],
  [12, 13],
  [10, 14],
  [7, 15],
  [5, 16],
  [4, 20],
  [3, 22],
  [2, 24],
  [1, 26],
  [0, 28],
];

export function tickSpeed(agility: number): number {
  const agi = Math.min(255, Math.max(0, Math.floor(agility)));
  for (const [minAgility, speed] of TICK_SPEED_BANDS) {
    if (agi >= minAgility) return speed;
  }
  return 28;
}

/** The value a counter is set to after acting. This, and only this, is what Haste changes. */
export function counterReset(agility: number, haste: HasteState, rank: number = ATTACK_RANK): number {
  return Math.floor(tickSpeed(agility) * rank * HASTE_MULTIPLIER[haste]);
}

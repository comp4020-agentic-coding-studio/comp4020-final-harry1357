// Why a request was refused, as the log says it (CLAUDE.md rule 32; the owner's ruling on the difficulty
// gate's C4). Every refusal names one of these codes. The person is told a sentence, which may say back what
// they sent ("There's no ring called …"); the log carries only the code, never a sentence, so nothing a
// request sent reaches stdout through a refusal. The list is closed: a refusal with a code not on it doesn't
// typecheck, and spec/refusals.test.ts holds that every refusal line's reason is one.

export const REASON_CODES = [
  // the request itself
  "bad-json",
  "not-found",
  "no-such-room",
  "no-such-battle",
  "not-your-seat",
  "not-seated",
  "not-standing",
  "fight-over",
  "fight-not-running",
  "fight-started",
  // joining and seats (rules 3, 4, 24, 25, 27)
  "bad-name",
  "bad-role",
  "name-taken",
  "name-kept-for-echo",
  "name-for-life",
  "role-at-other-table",
  "already-seated",
  "fell-this-fight",
  "seat-first",
  "not-in-lobby",
  "not-host",
  "no-host",
  "echo-public-raid",
  "echo-not-in-lobby",
  "echo-role-taken",
  "echo-table-full",
  // an action (rules 2, 10, 18, 30)
  "not-your-role",
  "not-your-turn",
  "bad-target",
  "no-such-ring",
  "no-such-card",
  "no-such-ally",
  "ally-not-fallen",
  "nobody-fallen",
  "ring-broken",
  "ring-hidden",
  "ring-no-pips",
  "ring-too-thick",
  "no-exposed",
  "card-not-single",
  "card-already-yours",
  "card-frozen",
  "already-warded",
  "not-on-yourself",
  "bastion-standing",
  "no-resource",
  "not-a-reaction",
  "reaction-on-turn",
  "reaction-spent",
  "reaction-no-card",
  "reaction-not-named",
  "reaction-cant-answer",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

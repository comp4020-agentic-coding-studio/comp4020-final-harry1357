// What a character carries, as the server holds it: the status marks drawn on
// their sprite (SceneApi.status), read straight off the token. No DOM and no
// decisions here, so the effects (which run in Node under spec/effects.test.ts)
// and the scene's reconcile() draw the same marks from the same state.
import type { Token } from "../../shared/protocol.ts";
import type { StatusMark } from "../battle/api.ts";

/** At most this many marks are drawn on a sprite; the rest are counted ("+1"). */
export const MAX_MARKS = 4;

/** Danger first, then what protects them, then what they've banked. */
const ORDER: readonly StatusMark["kind"][] = ["gravity", "warded", "braced", "hasted", "charge", "relay", "exposed"];

/**
 * A character's marks from their token. `bracedLeft` is how much of the Brace
 * is left (it holds until their next turn), when the caller has watched their
 * counter fall; otherwise the Brace is drawn whole.
 */
export function marksOf(t: Token, bracedLeft: number | null = null): StatusMark[] {
  if (t.kind !== "character" || t.hp <= 0) return [];
  const marks: StatusMark[] = [];
  if (t.gravity > 0) marks.push({ kind: "gravity", left: null, count: t.gravity });
  if (t.warded) marks.push({ kind: "warded", left: null });
  if (t.braced) marks.push({ kind: "braced", left: bracedLeft });
  if (t.hasted) marks.push({ kind: "hasted", left: null });
  if (t.charge > 0) marks.push({ kind: "charge", left: null, count: t.charge });
  return sortMarks(marks);
}

/** The drawing order, whoever built the list. */
export function sortMarks(marks: readonly StatusMark[]): StatusMark[] {
  return [...marks].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/** Words for a screen reader: "Gravity 2", "warded". */
export function markWords(marks: readonly StatusMark[]): string[] {
  return marks.map((m) => (m.count !== undefined ? `${LABEL[m.kind]} ${m.count}` : LABEL[m.kind]));
}

export const LABEL: Readonly<Record<StatusMark["kind"], string>> = {
  braced: "braced",
  hasted: "hasted",
  warded: "warded",
  gravity: "Gravity",
  charge: "Charge",
  relay: "relayed",
  exposed: "Exposed",
};

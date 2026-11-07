// The your-turn nudge (RICE item 2): when the server puts this page's seat on
// the plate, the tab's title says so and a phone vibrates, once per turn. The
// hold warning (main.ts) sounds only for someone with sound on and the tab in
// front; this reaches the rest, before rule 8's timeout turns them into an
// Echo. It reads the server's activeId and turnDeadline and nothing else: it
// never looks at a counter, so it can't decide a turn the server hasn't given
// (rule 1).
import type { BattleState } from "../shared/protocol.ts";

export interface Nudge {
  update(state: BattleState, myId: string | null): void;
}

interface Options {
  doc: Document;
  /** navigator.vibrate where there is one; a no-op where there isn't. */
  vibrate: (pattern: number | number[]) => unknown;
}

/** Two short pulses: the genre's "your move", felt rather than heard. */
const BUZZ = [120, 80, 120];

export function createNudge({ doc, vibrate }: Options): Nudge {
  /** The page's own title, kept while the nudge borrows it. */
  let resting: string | null = null;
  /** The turn already buzzed for, by the server's deadline for it. */
  let buzzed: number | null = null;

  return {
    update(state, myId) {
      const mine = !!myId && state.status === "fighting" && state.activeId === myId;
      if (mine) {
        resting ??= doc.title;
        const name = state.room?.code ? `room ${state.room.code}` : "The Orrery";
        doc.title = `▶ Your turn: ${name}`;
        if (state.turnDeadline !== null && buzzed !== state.turnDeadline) {
          buzzed = state.turnDeadline;
          vibrate(BUZZ);
        }
      } else if (resting !== null) {
        doc.title = resting;
        resting = null;
      }
    },
  };
}

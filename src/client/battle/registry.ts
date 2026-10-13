// Every event kind the server can broadcast, and how the battle screen shows it:
// `full` with motion, `reduced` with the same state change and none (CLAUDE.md
// rule 11 and "Design: the battle screen"). The effects live in ./effects/ and
// only ever draw through ctx.scene, ctx.strip and ctx.audio, so this module
// imports cleanly in Node. spec/shown.test.ts holds that every kind is here;
// spec/effects.test.ts holds that no reduced variant moves anything.
import type { Registry } from "./api.ts";
import * as orrery from "./effects/orrery.ts";
import * as party from "./effects/party.ts";
import * as table from "./effects/table.ts";

export const RENDERERS: Registry = {
  join: { full: table.join, reduced: table.joinReduced },
  strike: { full: party.strike, reduced: party.strikeReduced },
  lunge: { full: party.lunge, reduced: party.lungeReduced },
  brace: { full: party.brace, reduced: party.braceReduced },
  mend: { full: party.mend, reduced: party.mendReduced },
  hasten: { full: party.hasten, reduced: party.hastenReduced },
  hold: { full: table.hold, reduced: table.holdReduced },
  leave: { full: table.leave, reduced: table.leaveReduced },
  down: { full: table.down, reduced: table.downReduced },
  eclipse: { full: orrery.eclipse, reduced: orrery.eclipseReduced },
  perihelion: { full: orrery.perihelion, reduced: orrery.perihelionReduced },
  revolution: { full: orrery.revolution, reduced: orrery.revolutionReduced },
  plate: { full: table.plate, reduced: table.plate },
  end: { full: table.end, reduced: table.endReduced },
};

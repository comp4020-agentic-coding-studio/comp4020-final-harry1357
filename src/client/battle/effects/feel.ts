// Phase two, area (c): the feel. The events whose meaning is on the field:
// blows and boss attacks, heals and shields, the rings, seats arriving and
// falling, the pull, the phases, the end. Every action as anticipation, impact
// and follow-through; each reduced variant shows the same state change with no
// movement, and declares that state in `expected` (review F25). The renderers
// live in ./party.ts, ./orrery.ts and ./table.ts; this is their map.
import type { AreaRenderers } from "../api.ts";
import * as orrery from "./orrery.ts";
import * as party from "./party.ts";
import * as table from "./table.ts";

export const FEEL: AreaRenderers = {
  renderers: {
    join: { full: table.join, reduced: table.joinReduced },
    leave: { full: table.leave, reduced: table.leaveReduced },
    down: { full: table.down, reduced: table.downReduced },
    end: { full: table.end, reduced: table.endReduced },
    brace: { full: party.brace, reduced: party.braceReduced },
    mend: { full: party.mend, reduced: party.mendReduced },
    eclipse: { full: orrery.eclipse, reduced: orrery.eclipseReduced },
    perihelion: { full: orrery.perihelion, reduced: orrery.perihelionReduced },
    revolution: { full: orrery.revolution, reduced: orrery.revolutionReduced },
  },
  expected: {},
};

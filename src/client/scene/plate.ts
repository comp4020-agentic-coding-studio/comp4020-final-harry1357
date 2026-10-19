// A name plate: the visible name and an HP bar beneath a combatant, on a
// solid ink panel. The bar is a meter (ARIA 1.2) so the numbers are there for
// anyone who can't see the fill. Every setter compares before it touches the
// DOM, because reconcile() calls them on every tick.
//
// Two things ride on the plate's top edge without taking any room in it (they
// are positioned, so the phone's plate grid never sees them): the status marks
// on the left, and tags on the right ("ECHO", "DRIFT", the Orrery's phase),
// which say in words what the sprite shows in shape.

export interface Plate {
  readonly el: HTMLElement;
  /** Where the status marks are drawn (the scene's party fills it). */
  readonly marks: HTMLElement;
  name(text: string): void;
  hp(hp: number, maxHp: number): void;
  /** Words for a screen reader after the name: "you", "braced", "hasted", "down". */
  state(words: string[]): void;
  /** Short tags on the plate's corner, in the display face; [] clears them. */
  tags(words: readonly string[]): void;
}

export function createPlate(className = "plate"): Plate {
  const el = document.createElement("div");
  el.className = className;
  el.dataset.plate = "";

  const line = document.createElement("p");
  line.className = "plate-line";
  const nameEl = document.createElement("span");
  nameEl.className = "plate-name";
  const num = document.createElement("span");
  num.className = "plate-hp";
  num.setAttribute("aria-hidden", "true");
  line.append(nameEl, num);

  const meter = document.createElement("div");
  meter.className = "hp";
  meter.dataset.hp = "";
  meter.setAttribute("role", "meter");
  meter.setAttribute("aria-valuemin", "0");
  const lag = document.createElement("span");
  lag.className = "hp-lag";
  const fill = document.createElement("span");
  fill.className = "hp-fill";
  meter.append(lag, fill);

  const said = document.createElement("span");
  said.className = "visually-hidden";

  const marks = document.createElement("span");
  marks.className = "plate-marks";
  marks.setAttribute("aria-hidden", "true"); // said in words, by state()

  const tagRow = document.createElement("span");
  tagRow.className = "plate-tags";
  tagRow.setAttribute("aria-hidden", "true"); // said in words, by state()

  el.append(line, meter, said, marks, tagRow);

  let shownName = "";
  let shownHp = Number.NaN;
  let shownMax = Number.NaN;
  let shownFrac = Number.NaN;
  let shownState = "";
  let shownTags = "";

  return {
    el,
    marks,
    name(text) {
      if (text === shownName) return;
      shownName = text;
      nameEl.textContent = text;
      meter.setAttribute("aria-label", `${text}: HP`);
    },
    hp(hp, maxHp) {
      const max = Math.max(1, Math.round(maxHp));
      const now = Math.max(0, Math.min(max, Math.round(hp)));
      if (now === shownHp && max === shownMax) return;
      shownHp = now;
      shownMax = max;
      const frac = now / max;
      // Which way it moved picks the follow-through (scene.css, no-preference
      // only): a fall drops the fill at once and the ember ghost behind it
      // drains after a beat; a rise fills up to meet the new mark.
      if (frac < shownFrac) meter.dataset.trend = "down";
      else if (frac > shownFrac) meter.dataset.trend = "up";
      shownFrac = frac;
      meter.setAttribute("aria-valuemax", String(max));
      meter.setAttribute("aria-valuenow", String(now));
      meter.setAttribute("aria-valuetext", `${now} of ${max}`);
      // Both are set to the truth at once; only the CSS transition (under
      // no-preference) makes the fill or the lag arrive late.
      meter.style.setProperty("--hp", frac.toFixed(4));
      meter.style.setProperty("--hp-lag", frac.toFixed(4));
      if (frac <= 0.25) meter.dataset.low = "";
      else delete meter.dataset.low;
      num.textContent = String(now);
    },
    state(words) {
      const text = words.length ? `, ${words.join(", ")}` : "";
      if (text === shownState) return;
      shownState = text;
      said.textContent = text;
    },
    tags(words) {
      const key = words.join("|");
      if (key === shownTags) return;
      shownTags = key;
      tagRow.replaceChildren(
        ...words.map((w) => {
          const tag = document.createElement("span");
          tag.className = "plate-tag";
          tag.textContent = w;
          return tag;
        }),
      );
    },
  };
}

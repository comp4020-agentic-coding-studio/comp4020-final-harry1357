// A name plate: the visible name and an HP bar beneath a combatant, on a
// solid ink panel. The bar is a meter (ARIA 1.2) so the numbers are there for
// anyone who can't see the fill. Every setter compares before it touches the
// DOM, because reconcile() calls them on every tick.

export interface Plate {
  readonly el: HTMLElement;
  name(text: string): void;
  hp(hp: number, maxHp: number): void;
  /** Words for a screen reader after the name: "you", "braced", "hasted", "down". */
  state(words: string[]): void;
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

  el.append(line, meter, said);

  let shownName = "";
  let shownHp = Number.NaN;
  let shownMax = Number.NaN;
  let shownState = "";

  return {
    el,
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
      meter.setAttribute("aria-valuemax", String(max));
      meter.setAttribute("aria-valuenow", String(now));
      meter.setAttribute("aria-valuetext", `${now} of ${max}`);
      // The fill moves at once; the ember lag behind it drains after (CSS,
      // and only under no-preference: reduced motion sets both).
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
  };
}

// The Orrery's portrait: the same SVG the field inlines, made static and
// private to the strip. Its ring and segment hooks are renamed, so whatever
// turns, sheds or flashes the field's Orrery (by class or by data-ring) never
// finds this copy, and it never rotates. It's decoration: the portrait's text
// is on the list item.

/** A factory for static Orrery portraits from the SVG source, or null if the source isn't an SVG. */
export function orreryPortrait(source: string): (() => SVGSVGElement) | null {
  const quiet = source
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/\s(?:role|aria-label|data-ring|data-segment)="[^"]*"/g, "")
    .replace(/\borrery-(art|ring|segment|core)\b/g, "strip-orrery-$1");
  const template = document.createElement("template");
  template.innerHTML = quiet.trim();
  const svg = template.content.querySelector("svg");
  if (!svg) return null;
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  // Drawn on a 128-unit grid: at 128px every unit is one pixel, and the face
  // window crops the middle of it rather than scaling it down.
  svg.setAttribute("width", "128");
  svg.setAttribute("height", "128");
  svg.classList.add("strip-orrery");
  return () => svg.cloneNode(true) as SVGSVGElement;
}

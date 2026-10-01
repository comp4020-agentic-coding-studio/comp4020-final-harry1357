/**
 * The CSS a browser actually receives for these routes, however it arrives,
 * and just enough of a parser to ask it questions.
 *
 * Carried from crit 7, where Astro flipped from inlining the stylesheet as a
 * `<style>` block to emitting a `<link rel="stylesheet">` the day the file
 * crossed 4kB, and a reader that only looked at `<style>` went from seeing
 * everything to seeing nothing, with no error. So this follows both, and any
 * `@import` inside what it fetched. It is the stronger claim either way: what
 * the browser is served, not what the source says.
 *
 * The parser exists because a regex over the whole file can't tell `:root`
 * from a rule inside `@media (forced-colors)`, or `a {` from the tail of
 * `.panel-meta {`. It understands rules, declarations, grouping at-rules and
 * native nesting, and skips what isn't a style rule (`@font-face`,
 * `@keyframes`). Nothing more: it is a sensor, not a CSS engine.
 *
 * Only same-origin stylesheets are followed. The page also links Google Fonts'
 * CSS for the pixel faces, and that is Google's @font-face, not our design.
 * Fetching it would make the spec depend on someone else's network.
 */
export async function servedCss(baseUrl: string, routes: readonly string[]): Promise<string> {
  const blocks: string[] = [];
  const fetched = new Set<string>();

  const origin = new URL(baseUrl).origin;
  const sheet = async (href: URL): Promise<void> => {
    if (href.origin !== origin || fetched.has(href.href)) return;
    fetched.add(href.href);
    const res = await fetch(href);
    if (!res.ok) throw new Error(`a stylesheet the page links, ${href.pathname}, answered ${res.status}`);
    const css = await res.text();
    blocks.push(css);
    for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/g)) {
      await sheet(new URL(m[1], href));
    }
  };

  for (const route of routes) {
    const page = new URL(route, baseUrl);
    const res = await fetch(page);
    if (!res.ok) throw new Error(`GET ${route} answered ${res.status}, so there is no page to read CSS from`);
    const html = await res.text();

    for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) blocks.push(match[1]);

    // rel and href appear in either order, so match the whole tag, then pick.
    for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
      if (!/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(tag[0])) continue;
      const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag[0])?.[1];
      if (href) await sheet(new URL(href, page));
    }
  }

  return blocks.join("\n");
}

export interface Declaration {
  property: string;
  value: string;
}

export interface Rule {
  /** As written, comma list and all (nested selectors are composed with `:is()`). */
  selector: string;
  selectors: string[];
  /** The grouping at-rules around it, outermost first; "" at the top level. */
  context: string;
  declarations: Declaration[];
}

type Item = { decl: Declaration } | { block: { prelude: string; items: Item[] } };

const GROUPING = new Set(["media", "supports", "layer", "container", "scope", "document"]);

/** Split at top-level commas, ignoring any inside `:is(a, b)` or quotes. */
export function splitList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function items(css: string, from: number): { items: Item[]; end: number } {
  const out: Item[] = [];
  let start = from;
  let quote = "";
  let paren = 0;
  const declaration = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("@")) return; // @import, @charset
    const colon = trimmed.indexOf(":");
    if (colon <= 0) return;
    out.push({ decl: { property: trimmed.slice(0, colon).trim().toLowerCase(), value: trimmed.slice(colon + 1).trim() } });
  };
  for (let i = from; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (paren > 0) continue;
    else if (ch === ";") {
      declaration(css.slice(start, i));
      start = i + 1;
    } else if (ch === "{") {
      const prelude = css.slice(start, i).trim();
      const inner = items(css, i + 1);
      out.push({ block: { prelude, items: inner.items } });
      i = inner.end;
      start = i + 1;
    } else if (ch === "}") {
      declaration(css.slice(start, i));
      return { items: out, end: i };
    }
  }
  declaration(css.slice(start));
  return { items: out, end: css.length };
}

function nest(parent: string, child: string): string {
  const outer = splitList(parent).length > 1 ? `:is(${parent})` : parent;
  return splitList(child)
    .map((s) => (s.includes("&") ? s.replaceAll("&", outer) : `${outer} ${s}`))
    .join(", ");
}

function flatten(list: Item[], selector: string | null, context: string[], out: Rule[]): void {
  const declarations = list.flatMap((item) => ("decl" in item ? [item.decl] : []));
  if (selector !== null && declarations.length) {
    out.push({ selector, selectors: splitList(selector), context: context.join(" "), declarations });
  }
  for (const item of list) {
    if (!("block" in item)) continue;
    const { prelude, items: inner } = item.block;
    if (prelude.startsWith("@")) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
      // @font-face, @keyframes, @property, @page: not style rules.
      if (GROUPING.has(name)) flatten(inner, selector, [...context, prelude], out);
    } else {
      flatten(inner, selector === null ? prelude : nest(selector, prelude), context, out);
    }
  }
}

/** Every style rule in `css`, in source order. */
export function parseCss(css: string): Rule[] {
  const out: Rule[] = [];
  flatten(items(css.replace(/\/\*[\s\S]*?\*\//g, ""), 0).items, null, [], out);
  return out;
}

/** A rule that applies whatever the media, support or container conditions.
 *  (`@layer` only orders author styles, and author styles all beat the UA.) */
export const unconditional = (rule: Rule): boolean => !/@(media|supports|container)\b/i.test(rule.context);

const isRoot = (rule: Rule): boolean => rule.selectors.some((s) => s === ":root" || s === "html");

/** Every declaration of a custom property, wherever it is. */
export function declarationsOf(rules: Rule[], name: string): { value: string; rule: Rule }[] {
  const property = `--${name.replace(/^--/, "")}`;
  return rules.flatMap((rule) =>
    rule.declarations.filter((d) => d.property === property).map((d) => ({ value: d.value, rule })),
  );
}

/** A custom property's value as `:root` sets it unconditionally (the last
 *  such declaration wins, as in the cascade), or null if it never does. */
export function rootToken(rules: Rule[], name: string): string | null {
  const found = declarationsOf(rules, name).filter(({ rule }) => isRoot(rule) && unconditional(rule));
  return found.at(-1)?.value ?? null;
}

/** `var(--x)` followed to what `:root` sets it to, as many hops as it takes. */
export function resolve(value: string, rules: Rule[], depth = 0): string {
  const v = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$/.exec(value.trim());
  if (!v || depth > 8) return value.trim();
  const next = rootToken(rules, v[1]) ?? v[2];
  return next === undefined ? value.trim() : resolve(next, rules, depth + 1);
}

/** A colour as `#rrggbb` (or `#rrggbbaa` when not opaque), lowercase, or the
 *  value itself lowercased when it isn't hex or rgb() (a keyword, say). */
export function colour(value: string, rules: Rule[]): string {
  const v = resolve(value, rules).toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    return `#${full.endsWith("ff") && full.length === 8 ? full.slice(0, 6) : full}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(v);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number(rgb[4]);
    const parts = [rgb[1], rgb[2], rgb[3]].map((n) => Math.round(Number(n)).toString(16).padStart(2, "0"));
    return `#${parts.join("")}${alpha < 1 ? Math.round(alpha * 255).toString(16).padStart(2, "0") : ""}`;
  }
  return v;
}

import stylelint from "stylelint";

const { createPlugin, utils } = stylelint;

// The two design gates that need real parsing rather than a value regex.
// `backdrop-filter` is banned with the built-in
// declaration-property-value-disallowed-list, because "any value at all" is a
// thing that rule can already say.

/** Lengths in a value, in px, with functions stripped first so the numbers
 *  inside `rgb(0 0 0 / 50%)` are not mistaken for offsets. */
function lengths(value) {
  const stripped = value.replace(/\b[\w-]+\([^)]*\)/g, " ");
  const found = stripped.match(/-?\d*\.?\d+(?:px|rem|em|ch|vw|vh|pt|%)?/g) ?? [];
  return found.map((token) => {
    const number = Number.parseFloat(token);
    if (token.endsWith("rem") || token.endsWith("em")) return { px: number * 16, raw: token };
    // A percentage radius is always a curve, never a 2px one.
    if (token.endsWith("%")) return { px: number === 0 ? 0 : Infinity, raw: token };
    return { px: number, raw: token };
  });
}

const shadowName = "design-gates/no-blurred-shadow";
const shadowMessages = utils.ruleMessages(shadowName, {
  rejected: (blur) =>
    `Blurred shadow (${blur}). A soft glow is the look every site has; ` +
    "a hard offset (0 blur) is a decision. See the design gates in CLAUDE.md.",
});

// A design block may lift a gate for named selectors only, and only by saying
// why: `[true, { allowSelectors: ["regex", ...], lifted: "block: reason" }]`.
// .stylelintrc.json is strict JSON and can't hold a comment, so `lifted` is the
// comment, and an allow-list without one is a config error that lifts nothing.
// A declaration is lifted when some rule enclosing it (itself, or a parent
// through CSS nesting) has EVERY selector in its list matching, so a lifted
// selector can't carry an unlifted one in with it.
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const LIFT_OPTIONS = { allowSelectors: [isNonEmptyString], lifted: [isNonEmptyString] };

function liftFor(ruleName, secondary, result) {
  let allowed = (secondary?.allowSelectors ?? []).map((source) => new RegExp(source));
  if (allowed.length > 0 && !isNonEmptyString(secondary?.lifted)) {
    result.warn(`${ruleName}: allowSelectors needs a "lifted" reason naming the design block; nothing is lifted without one.`, {
      stylelintType: "invalidOption",
    });
    allowed = [];
  }
  return (decl) => {
    if (allowed.length === 0) return false;
    for (let node = decl.parent; node; node = node.parent) {
      if (node.type === "rule" && node.selectors.every((sel) => allowed.some((pattern) => pattern.test(sel.trim())))) {
        return true;
      }
    }
    return false;
  };
}

const shadowRule = (primary, secondary) => (root, result) => {
  const valid = utils.validateOptions(
    result,
    shadowName,
    { actual: primary, possible: [true] },
    { actual: secondary, possible: LIFT_OPTIONS, optional: true },
  );
  if (!valid) return;
  const isLifted = liftFor(shadowName, secondary, result);
  root.walkDecls(/^(-\w+-)?box-shadow$/i, (decl) => {
    if (isLifted(decl)) return;
    for (const shadow of decl.value.split(",")) {
      if (/^\s*(none|inherit|initial|unset|revert)\s*$/i.test(shadow)) continue;
      // box-shadow: [inset] <offset-x> <offset-y> [blur] [spread] <color>
      const blur = lengths(shadow)[2];
      if (blur && blur.px !== 0) {
        utils.report({
          message: shadowMessages.rejected(blur.raw),
          node: decl,
          result,
          ruleName: shadowName,
        });
        return;
      }
    }
  });
};
shadowRule.ruleName = shadowName;
shadowRule.messages = shadowMessages;

const radiusName = "design-gates/no-soft-corners";
const radiusMessages = utils.ruleMessages(radiusName, {
  rejected: (radius) =>
    `Border radius ${radius} is above 2px. Rounded corners are the default ` +
    "every framework ships. See the design gates in CLAUDE.md.",
});

const radiusRule = (primary, secondary) => (root, result) => {
  const valid = utils.validateOptions(
    result,
    radiusName,
    { actual: primary, possible: [true] },
    { actual: secondary, possible: LIFT_OPTIONS, optional: true },
  );
  if (!valid) return;
  const isLifted = liftFor(radiusName, secondary, result);
  root.walkDecls(/^(-\w+-)?border(-[a-z]+)*-radius$/i, (decl) => {
    if (isLifted(decl)) return;
    for (const radius of lengths(decl.value)) {
      if (radius.px > 2) {
        utils.report({
          message: radiusMessages.rejected(radius.raw),
          node: decl,
          result,
          ruleName: radiusName,
        });
        return;
      }
    }
  });
};
radiusRule.ruleName = radiusName;
radiusRule.messages = radiusMessages;

export default [createPlugin(shadowName, shadowRule), createPlugin(radiusName, radiusRule)];

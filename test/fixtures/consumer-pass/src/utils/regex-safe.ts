// Regression fixture for the R4 false-positive fix (BE-undangan-07 / v0.1.1): these are the
// exact 3 shapes that used to trip the old bare ".exec(" match, reproduced here to prove the
// binding-shaped-receiver check does NOT flag any of them.

// Shape 1 & 2: a regex literal's own .exec() call (liquid-gold/ember-editorial's client.ts).
function hexToRgb(hex: string, fallback: number[]) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Shape 3: a module-level `const` holding a compiled RegExp, then `.exec()` on that variable
// (scripts/check-template-literals.mjs's `OPEN.exec(src)`).
const OPEN = /export const \w+ = \/\* (?:css|js) \*\/ `/;
function findOpenDelimiter(src: string) {
  return OPEN.exec(src);
}

export { hexToRgb, findOpenDelimiter };

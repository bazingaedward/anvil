import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAppearance } from "../../desktop/shared/appearance";

test("appearance restores defaults for missing or malformed saved settings", () => {
  const defaults = normalizeAppearance(null);
  assert.equal(defaults.uiFontSize, 15);
  assert.equal(defaults.chatFontSize, 16);
  assert.deepEqual(normalizeAppearance({ uiFontSize: "large", chatFontSize: NaN }), defaults);
  assert.deepEqual(normalizeAppearance([]), defaults);
});
test("appearance bounds saved values and rounds to supported steps", () => {
  const result = normalizeAppearance({ uiFontSize: 100, chatFontSize: -1, codeFontSize: 15.3, terminalFontSize: Infinity, chatLineHeight: 1.776, unknown: 999 });
  assert.deepEqual(result, { uiFontSize: 18, chatFontSize: 14, codeFontSize: 15, terminalFontSize: 14, chatLineHeight: 1.8 });
  assert.deepEqual(normalizeAppearance(result), result);
});

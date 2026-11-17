import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownResponse } from "../../desktop/renderer/markdown-response";
test("assistant Markdown renders GFM tables, emphasis, quotes and code", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownResponse, {
      text: "| 项目 | 数值 |\n|---|---|\n| 当前 | **17°C** |\n\n> 数据来源\n\n- item\n\n```js\nconst x = 1;\n```",
    }),
  );
  for (const element of [
    "<table>",
    "<strong>17°C</strong>",
    "<blockquote>",
    "<ul>",
    "<pre>",
    "const x = 1;",
  ])
    assert.ok(html.includes(element), element);
});
test("assistant Markdown does not execute HTML or unsafe URLs, and accepts partial code fences", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownResponse, {
      text: "<script>alert(1)</script>\n\n[x](javascript:alert)\n\n![remote](https://example.com/tracker)\n\n```js\npartial",
    }),
  );
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("partial"));
});

test("code blocks expose copy controls and language labels, inline code does not", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownResponse, {
      text: "`inline`\n\n```sh\ncd /tmp\npnpm dev\n```\n\n```\n  plain text\n```\n\n```ts\npartial",
    }),
  );
  assert.equal((html.match(/aria-label="复制代码块"/g) || []).length, 3);
  assert.ok(html.includes("<span>sh</span>"));
  assert.ok(html.includes("<span>文本</span>"));
  assert.ok(html.includes("<span>ts</span>"));
  assert.ok(html.includes("<code>inline</code>"));
  assert.ok(html.includes("cd /tmp\npnpm dev\n"));
  assert.ok(html.includes("  plain text\n"));
});

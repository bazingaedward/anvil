import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserMessage } from "../../desktop/renderer/user-message";

test("user messages put image previews before text and retain other attachment names", () => {
  const html = renderToStaticMarkup(
    createElement(UserMessage, {
      text: "检查截图",
      attachments: [
        { id: "image", name: "screen.png", mime: "image/png", size: 1 },
        { id: "text", name: "log.txt", mime: "text/plain", size: 1 },
      ],
    }),
  );
  assert.ok(html.indexOf('class="message-images"') < html.indexOf("检查截图"));
  assert.ok(html.includes('aria-label="预览图片：screen.png"'));
  assert.ok(html.includes("log.txt"));
  assert.ok(!html.includes("已附带目录"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolActivity } from "../../desktop/renderer/tool-activity";
import type { AgentTask } from "../../desktop/shared/api";
test("tool activity keeps active work visible and renders summaries as text", () => {
  const task: AgentTask = {
    id: "t",
    conversationID: "c",
    prompt: "",
    text: "",
    status: "running",
    updated: Date.now(),
    startedAt: Date.now() - 5000,
    permissions: [],
    tools: [
      {
        id: "a",
        name: "shell",
        summary: "<script>bad</script>",
        status: "running",
        startedAt: Date.now() - 1000,
      },
      {
        id: "b",
        name: "write",
        summary: "app.ts",
        status: "completed",
        startedAt: 1000,
        endedAt: 3000,
      },
    ],
  };
  const html = renderToStaticMarkup(createElement(ToolActivity, { task }));
  assert.ok(html.includes("执行中"));
  assert.ok(html.includes("已完成"));
  assert.ok(html.includes("2s"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("可随时停止"));
  const stopped = renderToStaticMarkup(
    createElement(ToolActivity, { task: { ...task, status: "cancelled" } }),
  );
  assert.ok(!stopped.includes("执行中"));
  assert.ok(stopped.includes("已停止"));
});

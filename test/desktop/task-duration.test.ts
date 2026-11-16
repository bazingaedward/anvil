import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskDuration } from "../../desktop/renderer/task-duration";
import type { AgentTask } from "../../desktop/shared/api";

const task: AgentTask = {
  id: "t",
  conversationID: "c",
  prompt: "",
  text: "",
  permissions: [],
  status: "running",
  updated: 1,
  startedAt: 1000,
};
const render = (patch: Partial<AgentTask>) =>
  renderToStaticMarkup(
    createElement(TaskDuration, { task: { ...task, ...patch } }),
  );
test("conversation duration persists terminal time independently of record updates", () => {
  for (const status of [
    "completed",
    "unverified",
    "failed",
    "cancelled",
    "limit",
  ] as const) {
    assert.match(
      render({ status, endedAt: 84000, updated: 999999 }),
      /耗时 01:23/,
    );
  }
  assert.match(render({ status: "completed", endedAt: 3662000 }), /1:01:01/);
  assert.equal(render({ startedAt: undefined }), "");
  assert.equal(render({ status: "cancelled" }), "");
  assert.match(render({ startedAt: Date.now() - 5000 }), /已运行 00:05/);
});

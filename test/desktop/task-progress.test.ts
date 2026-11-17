import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentTask } from "../../desktop/shared/api";
import {
  taskDuration,
  taskProgressLabel,
} from "../../desktop/renderer/task-progress";

const task: AgentTask = {
  id: "task",
  conversationID: "chat",
  prompt: "test",
  text: "",
  status: "running",
  permissions: [],
  startedAt: 1000,
  updated: 1000,
};

test("task progress reflects execution while prioritizing user waits and stopping", () => {
  assert.equal(taskProgressLabel(task), "思考中…");
  const executing: AgentTask = {
    ...task,
    tools: [{ id: "tool", name: "shell", status: "running", startedAt: 1000 }],
  };
  assert.equal(taskProgressLabel(executing), "执行中…");
  assert.equal(
    taskProgressLabel({ ...executing, phase: "checking" }),
    "验证中…",
  );
  assert.equal(taskProgressLabel({ ...task, phase: "repairing" }), "修复中…");
  const asking: AgentTask = {
    ...executing,
    questions: [{ id: "q", blocking: true, questions: [{ title: "Choose" }] }],
  };
  assert.equal(taskProgressLabel(asking), "等待你的回答");
  assert.equal(
    taskProgressLabel({
      ...asking,
      permissions: [{ id: "p", action: "shell", resources: [] }],
    }),
    "等待授权",
  );
  assert.equal(
    taskProgressLabel({ ...asking, phase: "stopping" }),
    "正在停止…",
  );
  assert.equal(
    taskProgressLabel({
      ...task,
      questions: [{ id: "q", blocking: false, questions: [] }],
    }),
    "思考中…",
  );
  assert.equal(
    taskProgressLabel({
      ...task,
      tools: [{ ...executing.tools![0], status: "completed" }],
    }),
    "思考中…",
  );
});

test("total duration includes wall time and freezes at task end", () => {
  assert.equal(taskDuration(task, 62500), "01:01");
  assert.equal(taskDuration(task, 3662000), "01:01:01");
  assert.equal(taskDuration(task, 500), "00:00");
  const done = { ...task, status: "completed" as const, endedAt: 65000 };
  assert.equal(taskDuration(done, 999999), "01:04");
  assert.equal(taskDuration({ ...task, status: "queued" }, 65000), null);
  assert.equal(taskDuration({ ...task, startedAt: undefined }, 65000), null);
  assert.equal(taskDuration({ ...task, status: "failed" }, 65000), null);
});

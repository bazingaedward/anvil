import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tasks } from "../eval/tasks.mjs";
import { repoTasks } from "../eval/repo-tasks.mjs";
import { verify, writeFiles } from "../eval/verify.mjs";
for (const task of [...tasks, ...repoTasks])
  test(`eval verifier rejects starter and accepts reference: ${task.id}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "anvil-eval-test-"));
    try {
      await writeFiles(root, task.files);
      assert.equal((await verify(task, root)).passed, false);
      await writeFiles(root, task.solution);
      assert.equal((await verify(task, root)).passed, true);
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });

import { Agent } from "../../desktop/main/agent";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
mkdirSync(".anvil/acceptance-probes", { recursive: true });
const root = mkdtempSync(path.resolve(".anvil/acceptance-probes/run-"));
execFileSync("git", ["init", "-q", root], { windowsHide: true });
writeFileSync(
  path.join(root, "sum.cjs"),
  "module.exports = (a, b) => a - b;\n",
);
const checkSource =
  "const assert = require('node:assert/strict'); const sum = require('./sum.cjs'); assert.equal(sum(2, 3), 5); console.log('ANVIL_ACCEPTANCE_OK');\n";
writeFileSync(path.join(root, "check.cjs"), checkSource);
const replied = new Set<string>();
const agent = new Agent(
  root,
  path.join(root, "state"),
  path.resolve("runtime/opencode/dist/anvil-runtime.exe"),
  (task) => {
    for (const permission of task.permissions) {
      if (replied.has(permission.id)) continue;
      replied.add(permission.id);
      const allowed = permission.resources.every((resource) => {
        const target = path.resolve(root, resource);
        if (permission.action === "edit")
          return target === path.join(root, "sum.cjs");
        if (permission.action === "read")
          return [
            path.join(root, "sum.cjs"),
            path.join(root, "check.cjs"),
          ].includes(target);
        return false;
      });
      console.log(
        JSON.stringify({
          permission: permission.action,
          resources: permission.resources,
          allowed,
        }),
      );
      agent.reply(task.id, permission.id, allowed);
    }
  },
  {
    BYTEPLUS_ARK_API_KEY: process.env.BYTEPLUS_ARK_API_KEY,
    BYTEPLUS_ARK_RESPONSES_URL: process.env.BYTEPLUS_ARK_RESPONSES_URL,
  },
);
try {
  const task = agent.start(
    "acceptance-probe",
    "On this first response ONLY, say READY and do not use tools. After Anvil reports the acceptance failure, use only the read and edit tools to fix sum.cjs so it adds two numbers. Do not change check.cjs or the acceptance command. Let Anvil execute the check; do not use shell tools.",
    [root],
    root,
    {
      command: `"${process.execPath}" check.cjs`,
      directory: root,
      maxRepairs: 2,
      timeoutMs: 10000,
    },
  );
  const start = Date.now();
  while (
    agent.list().find((item) => item.id === task.id)?.status === "running" &&
    Date.now() - start < 120000
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  const result = agent.list().find((item) => item.id === task.id)!;
  console.log(
    JSON.stringify({
      status: result.status,
      round: result.round,
      checks: result.checks?.map((check) => ({
        exitCode: check.exitCode,
        output: check.output,
        timedOut: check.timedOut,
      })),
      error: result.error,
    }),
  );
  assert.equal(result.status, "completed");
  assert.ok((result.checks?.length || 0) >= 2);
  assert.notEqual(result.checks![0].exitCode, 0);
  assert.equal(result.checks!.at(-1)?.exitCode, 0);
  assert.equal(readFileSync(path.join(root, "check.cjs"), "utf8"), checkSource);
  console.log("REAL_ACCEPTANCE_LOOP_PASSED");
} finally {
  agent.stop();
}

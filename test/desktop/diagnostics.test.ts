import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initDiagnostics,
  diagnostic,
  diagnosticState,
} from "../../desktop/main/diagnostics";
test("diagnostics redacts credentials, saves heartbeat and rotates bounded logs", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-debug-"));
  try {
    initDiagnostics(root, ["test-secret-value"]);
    diagnostic("test.error", {
      message:
        "test-secret-value Bearer abcdef sk-example ghp_example https://user:password@example.test/?token=abc",
    });
    diagnosticState("runtime", {
      pid: 123,
      status: "running",
      lastEvent: "questions",
    });
    const dir = path.join(root, "diagnostics");
    const log = readFileSync(path.join(dir, "events.jsonl"), "utf8");
    for (const value of [
      "test-secret-value",
      "abcdef",
      "sk-example",
      "ghp_example",
      "password",
      "token=abc",
    ])
      assert.ok(!log.includes(value));
    assert.equal(
      JSON.parse(readFileSync(path.join(dir, "status.json"), "utf8")).runtime
        .lastEvent,
      "questions",
    );
    writeFileSync(path.join(dir, "events.jsonl"), "x".repeat(1024 * 1024 + 1));
    diagnostic("rotated");
    assert.ok(existsSync(path.join(dir, "events.jsonl.1")));
    assert.ok(
      readFileSync(path.join(dir, "events.jsonl"), "utf8").length < 1000,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

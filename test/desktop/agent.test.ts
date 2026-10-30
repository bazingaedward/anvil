import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Agent } from "../../desktop/main/agent";
import type { AgentTask } from "../../desktop/shared/api";

test("agent owns task state, validates permission replies, and persists only public history", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-agent-"));
  const script = path.join(root, "child.cjs");
  writeFileSync(
    script,
    `const readline=require('node:readline');const send=x=>console.log(JSON.stringify(x));readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='start'){send({type:'session',id:'ses-test'});send({type:'text',text:'hello'});send({type:'permission',permission:{id:'p1',action:'read',resources:['proof.txt']}});}if(m.type==='permission'){send({type:'permission-resolved',id:m.id});send({type:'done',status:'completed'});process.exit(0);}if(m.type==='cancel')process.exit(0);});`,
  );
  const events: AgentTask[] = [];
  const credentials = {
    BYTEPLUS_ARK_API_KEY: "test-secret",
    BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid/responses",
  };
  const agent = new Agent(
    root,
    path.join(root, "state"),
    process.execPath,
    (t) => events.push(t),
    credentials,
    [script],
  );
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("Timed out");
  };
  try {
    const task = agent.start("chat", "Read proof");
    assert.throws(() => agent.start("chat", "other"), /current task/);
    await until(() => events.some((t) => t.permissions.length === 1));
    assert.throws(
      () => agent.reply(task.id, "wrong", true),
      /no longer pending/,
    );
    agent.reply(task.id, "p1", true);
    await until(() => events.some((t) => t.status === "completed"));
    assert.equal(agent.list()[0].text, "hello");
    assert.equal("sessionID" in agent.list()[0], false);
    assert.equal(agent.list()[0].permissions.length, 0);
    const restored = new Agent(
      path.join(root, "another-directory"),
      path.join(root, "state"),
      process.execPath,
      () => {},
      credentials,
      [script],
    );
    assert.equal(restored.list()[0].status, "completed");
    assert.ok(!JSON.stringify(restored.list()).includes("test-secret"));
    restored.stop();
  } finally {
    agent.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing credentials do not create a misleading running task", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-agent-"));
  try {
    const agent = new Agent(root, root, process.execPath, () => {}, {});
    assert.throws(() => agent.start("chat", "hello"), /keygrant/);
    assert.deepEqual(agent.list(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unresponsive runtime is cancelled and cannot overwrite the final state on exit", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-agent-cancel-"));
  const script = path.join(root, "hang.cjs");
  writeFileSync(script, "process.stdin.resume();setInterval(()=>{},1000);");
  const agent = new Agent(
    root,
    path.join(root, "state"),
    process.execPath,
    () => {},
    {
      BYTEPLUS_ARK_API_KEY: "test-key",
      BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid/responses",
    },
    [script],
  );
  try {
    const task = agent.start("chat", "Wait");
    agent.cancel(task.id);
    await new Promise((resolve) => setTimeout(resolve, 5500));
    assert.equal(agent.list()[0].status, "cancelled");
    assert.equal(agent.list()[0].permissions.length, 0);
  } finally {
    agent.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(root, { recursive: true, force: true });
  }
});

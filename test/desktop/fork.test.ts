import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConversationStore } from "../../desktop/main/conversations";
import { Agent } from "../../desktop/main/agent";
test("fork copies exactly the chosen prefix without sharing runtime session or full-access permission", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-fork-"));
  const storage = path.join(root, "state");
  const store = new ConversationStore(storage);
  const source = store.create();
  store.grantFolders(source.id, [root]);
  store.setPermissionMode(source.id, "full");
  for (let i = 0; i < 3; i++)
    store.saveTask({
      id: `task-${i}`,
      conversationID: source.id,
      prompt: `question-${i}`,
      text: `answer-${i}`,
      status: "unverified",
      permissions: [],
      updated: Date.now() + i,
      sessionID: "original-session",
      directory: root,
    });
  const fork = store.fork("task-1");
  assert.deepEqual(fork.folders, [root]);
  assert.equal(fork.permissionMode, "ask");
  const records = store
    .tasks()
    .filter((task) => task.conversationID === fork.id);
  assert.equal(records.length, 2);
  assert.equal(records[1].text, "answer-1");
  assert.ok(records.every((task) => !task.sessionID && !task.directory));
  assert.equal(
    store.tasks().filter((task) => task.conversationID === source.id).length,
    3,
  );
  store.close();
  const script = path.join(root, "worker.cjs");
  writeFileSync(
    script,
    `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='start'){console.log(JSON.stringify({type:'text',text:JSON.stringify({prompt:m.text,previous:m.sessionID||null})}));console.log(JSON.stringify({type:'done',status:'completed'}));process.exit(0);}});`,
  );
  const agent = new Agent(
    root,
    storage,
    process.execPath,
    () => {},
    {
      BYTEPLUS_ARK_API_KEY: "fake",
      BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid/responses",
    },
    [script],
  );
  t.after(async () => {
    await agent.close();
    rmSync(root, { recursive: true, force: true });
  });
  const task = agent.start(fork.id, "continue");
  for (
    let i = 0;
    i < 100 && agent.list().some((item) => item.status === "running");
    i++
  )
    await new Promise((r) => setTimeout(r, 20));
  const result = JSON.parse(
    agent.list().find((item) => item.id === task.id)!.text,
  );
  assert.equal(result.previous, null);
  assert.match(result.prompt, /answer-1/);
  assert.doesNotMatch(result.prompt, /answer-2/);
  assert.equal(
    agent.list().filter((item) => item.conversationID === source.id).length,
    3,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ConversationStore } from "../../desktop/main/conversations";
import { Agent } from "../../desktop/main/agent";

test("memory migration, revisions, scope filtering and account separation", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-memory-"));
  const a = path.join(root, "a"),
    b = path.join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  let agent: Agent | undefined, other: Agent | undefined;
  try {
    let store = new ConversationStore(path.join(root, "account"));
    store.ensure("chat");
    store.close();
    const db = new DatabaseSync(
      path.join(root, "account", "conversations.sqlite"),
    );
    db.exec(
      "DROP TABLE memory_notes; DROP TABLE task_handoffs; PRAGMA user_version=4;",
    );
    db.close();
    agent = new Agent(
      a,
      path.join(root, "account"),
      process.execPath,
      () => {},
      {},
    );
    agent.grantFolders("chat", [a]);
    let state = agent.saveMemory("chat", {
      title: "Tests",
      body: "Use targeted checks.",
      kind: "feedback",
      scope: a,
      sourceTaskID: null,
    });
    const note = state.notes[0];
    agent.saveMemory("chat", { ...note, body: "Changed" });
    assert.throws(
      () => agent!.saveMemory("chat", { ...note, body: "Stale" }),
      /changed elsewhere/,
    );
    assert.throws(
      () =>
        agent!.saveMemory("chat", {
          title: "x",
          body: "x",
          kind: "project",
          scope: b,
          sourceTaskID: null,
        }),
      /attached folder/,
    );
    state = agent.contextState("chat");
    agent.saveHandoff("chat", {
      ...state.handoff,
      goal: "Fix login",
      enabled: true,
      memoryIDs: [note.id],
    });
    assert.throws(
      () => agent!.saveHandoff("chat", { ...state.handoff, goal: "stale" }),
      /changed elsewhere/,
    );
    await agent.close();
    agent = undefined;
    agent = new Agent(
      a,
      path.join(root, "account"),
      process.execPath,
      () => {},
      {},
    );
    assert.equal(agent.contextState("chat").handoff.goal, "Fix login");
    await agent.revokeFolder("chat", a);
    assert.equal(agent.contextState("chat").notes.length, 0);
    assert.deepEqual(agent.contextState("chat").handoff.memoryIDs, []);
    other = new Agent(
      a,
      path.join(root, "other"),
      process.execPath,
      () => {},
      {},
    );
    const chat = other.createConversation();
    assert.equal(other.contextState(chat.id).notes.length, 0);
    agent.grantFolders("chat", [a]);
    const updated = agent.contextState("chat").notes[0];
    agent.deleteMemory("chat", updated.id, updated.revision);
    assert.equal(agent.contextState("chat").notes.length, 0);
    assert.throws(
      () =>
        agent!.saveMemory("chat", {
          title: "x",
          body: "x".repeat(64001),
          kind: "feedback",
          scope: null,
          sourceTaskID: null,
        }),
      /length/,
    );
    await agent.deleteConversation("chat");
    await agent.close();
    agent = undefined;
    store = new ConversationStore(path.join(root, "account"));
    assert.equal(store.memory.handoff("chat").revision, 0);
    store.close();
  } finally {
    await agent?.close();
    await other?.close();
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

test("selected memory and handoff reach runtime with provenance; disabling stops injection", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-memory-runtime-"));
  const worker = path.join(root, "worker.cjs"),
    log = path.join(root, "requests.jsonl");
  writeFileSync(
    worker,
    `const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='start'){fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');console.log(JSON.stringify({type:'session',id:'same-session'}));console.log(JSON.stringify({type:'text',text:'Model claim'}));console.log(JSON.stringify({type:'done',status:'completed'}));}});`,
  );
  const agent = new Agent(
    root,
    path.join(root, "state"),
    process.execPath,
    () => {},
    {
      BYTEPLUS_ARK_API_KEY: "secret",
      BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid",
    },
    [worker],
  );
  const wait = async () => {
    for (let i = 0; i < 200; i++) {
      const task = agent.list().at(-1);
      if (task && task.status !== "running") return task;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("Timed out");
  };
  try {
    agent.start("chat", "first", [root]);
    const first = (await wait())!;
    let state = agent.saveMemory("chat", {
      title: "Preference",
      body: "Prefer concise results",
      kind: "user",
      scope: null,
      sourceTaskID: first.id,
    });
    const note = state.notes[0];
    agent.saveHandoff("chat", {
      ...state.handoff,
      enabled: true,
      goal: "Keep the API stable",
      memoryIDs: [note.id],
    });
    agent.start("chat", "second", [root]);
    const second = (await wait())!;
    const request = JSON.parse(
      readFileSync(log, "utf8").trim().split("\n").at(-1)!,
    );
    assert.equal(request.sessionID, "same-session");
    assert.match(request.text, /Preference/);
    assert.doesNotMatch(request.text, /Prefer concise results/);
    assert.doesNotMatch(request.text, /Keep the API stable/);
    assert.match(request.text, /Read relevant topic files on demand/);
    assert.deepEqual(second.contextUsed?.memories, []);
    assert.equal(second.contextUsed?.sourceTaskID, null);
    state = agent.contextState("chat");
    agent.saveHandoff("chat", {
      ...state.handoff,
      enabled: false,
      memoryIDs: [],
    });
    agent.setAutoMemory("chat", false);
    agent.start("chat", "third", [root]);
    await wait();
    assert.match(
      JSON.parse(readFileSync(log, "utf8").trim().split("\n").at(-1)!).text,
      /automatic memory is now disabled/,
    );
    const newChat = agent.createConversation();
    await agent.deleteConversation("chat");
    assert.equal(
      agent.contextState(newChat.id).notes[0].sourceAvailable,
      false,
    );
    assert.deepEqual(agent.contextState(newChat.id).handoff.memoryIDs, []);
  } finally {
    await agent.close();
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

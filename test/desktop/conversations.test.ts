import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  ConversationStore,
  type StoredTask,
} from "../../desktop/main/conversations";
import { Agent } from "../../desktop/main/agent";
import {
  filterConversations,
  conversationTitle,
  readLegacyDrafts,
} from "../../desktop/renderer/conversation-data";

const task = (id = "task", conversationID = "chat"): StoredTask => ({
  id,
  conversationID,
  prompt: "Explain schema",
  text: "SQLite migration",
  status: "unverified",
  updated: 100,
  permissions: [],
  sessionID: "private-session",
  directory: "original-folder",
});
const temp = () => mkdtempSync(path.join(os.tmpdir(), "anvil-conversations-"));

test("SQLite preserves drafts, renamed titles, archive state, selection and ordered messages across restart", () => {
  const root = temp();
  let store = new ConversationStore(root);
  try {
    const first = store.create(),
      second = store.create();
    const acceptance = {
      command: "npm test",
      directory: root,
      maxRepairs: 2,
      timeoutMs: 120000,
    };
    store.update(first.id, {
      title: "数据库设计",
      text: "下一步计划",
      acceptance,
    });
    store.saveTask(task("one", first.id));
    store.saveTask({ ...task("two", first.id), updated: 101 });
    store.update(first.id, { archived: true });
    store.select(first.id);
    store.close();
    store = new ConversationStore(root);
    assert.equal(store.state().selected, first.id);
    assert.equal(store.get(first.id).text, "下一步计划");
    assert.equal(store.get(first.id).title, "数据库设计");
    assert.equal(store.get(first.id).archived, true);
    assert.deepEqual(store.get(first.id).acceptance, acceptance);
    assert.deepEqual(
      store.tasks().map((t) => t.id),
      ["one", "two"],
    );
    store.update(first.id, { archived: false });
    store.remove(first.id);
    assert.equal(store.state().selected, second.id);
    assert.deepEqual(store.tasks(), []);
    // Simulate a late worker event after deletion.
    store.saveTask(task("late", first.id));
    assert.equal(store.list().length, 1);
    assert.deepEqual(store.tasks(), []);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy imports are transactional, idempotent and cannot resurrect deleted conversations", () => {
  const root = temp();
  const folder = path.join(root, "conversations");
  mkdirSync(folder);
  const file = path.join(folder, "tasks.json");
  const original = JSON.stringify([task()]);
  writeFileSync(file, original);
  let store = new ConversationStore(root);
  try {
    store.importDrafts([{ id: "chat", text: "unsent draft" }]);
    assert.equal(store.get("chat").text, "unsent draft");
    store.update("chat", { text: "new draft" });
    store.importDrafts([{ id: "chat", text: "stale draft" }]);
    assert.equal(store.get("chat").text, "new draft");
    assert.equal(store.tasks()[0].sessionID, "private-session");
    store.remove("chat");
    store.close();
    store = new ConversationStore(root);
    store.importDrafts([{ id: "chat", text: "old draft" }]);
    const later = path.join(root, "old-folder.json");
    writeFileSync(later, original);
    store.importTasks(later, root);
    assert.deepEqual(store.list(), []);
    assert.deepEqual(store.tasks(), []);
    assert.equal(readFileSync(file, "utf8"), original);
    const malformed = path.join(root, "malformed.json");
    writeFileSync(
      malformed,
      JSON.stringify([task("valid", "new"), { id: "broken" }]),
    );
    assert.throws(() => store.importTasks(malformed), /Invalid legacy/);
    assert.deepEqual(store.tasks(), []);
    assert.deepEqual(store.list(), []);
    writeFileSync(malformed, JSON.stringify([task("valid", "new")]));
    store.importTasks(malformed);
    assert.equal(store.tasks().length, 1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid draft batch rolls back and explicit fields cannot alter execution records", () => {
  const root = temp();
  const store = new ConversationStore(root);
  try {
    assert.throws(() =>
      store.importDrafts([
        { id: "one", text: "keep" },
        { id: "two", text: 3 } as any,
      ]),
    );
    assert.deepEqual(store.list(), []);
    assert.equal(store.state().legacyDraftsImported, false);
    const value = store.create();
    assert.throws(() => store.update(value.id, { title: "  " }), /title/);
    assert.throws(
      () => store.update(value.id, { sessionID: "injected" } as any),
      /Unknown/,
    );
    assert.throws(
      () => store.update(value.id, { archived: "yes" } as any),
      /archive/,
    );
    store.update(value.id, { title: "Robert'); DROP TABLE conversations;--" });
    assert.equal(store.list().length, 1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent imports both legacy locations, recovers interrupted tasks, and preserves private session context", async () => {
  const root = temp(),
    storage = path.join(root, "state");
  const global = path.join(storage, "conversations");
  mkdirSync(global, { recursive: true });
  const legacy = path.join(
    storage,
    createHash("sha256").update(root).digest("hex"),
  );
  mkdirSync(legacy);
  writeFileSync(
    path.join(global, "tasks.json"),
    JSON.stringify([{ ...task(), status: "running" }]),
  );
  writeFileSync(
    path.join(legacy, "tasks.json"),
    JSON.stringify([{ ...task("old", "older"), status: "completed" }]),
  );
  const agent = new Agent(root, storage, process.execPath, () => {}, {});
  try {
    assert.deepEqual(
      agent.list().map((t) => t.status),
      ["cancelled", "unverified"],
    );
    assert.equal("sessionID" in agent.list()[0], false);
    assert.equal(agent.conversations().conversations.length, 2);
    await agent.deleteConversation("older");
    agent.includeDirectory(root);
    assert.equal(agent.list().length, 1);
  } finally {
    await agent.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleting a running conversation cancels its worker before removing history and cannot restart its ID", async () => {
  const root = temp(),
    script = path.join(root, "worker.cjs");
  writeFileSync(
    script,
    `const send=x=>console.log(JSON.stringify(x));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='start'){send({type:'text',text:'started'});}if(m.type==='cancel'){send({type:'text',text:'late output'});send({type:'done',status:'completed'});process.exit(0);}});`,
  );
  const credentials = {
    BYTEPLUS_ARK_API_KEY: "fixture",
    BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid",
  };
  const agent = new Agent(
    root,
    path.join(root, "state"),
    process.execPath,
    () => {},
    credentials,
    [script],
  );
  try {
    const chat = agent.createConversation();
    agent.start(chat.id, "Wait for cancellation");
    for (let i = 0; i < 100 && !agent.list()[0].text; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(agent.list()[0].text, "started");
    assert.throws(
      () => agent.updateConversation(chat.id, { archived: true }),
      /Stop/,
    );
    const removal = agent.deleteConversation(chat.id);
    assert.throws(
      () => agent.updateConversation(chat.id, { text: "new" }),
      /being deleted/,
    );
    await removal;
    assert.deepEqual(agent.list(), []);
    assert.deepEqual(agent.conversations().conversations, []);
    assert.throws(() => agent.start(chat.id, "Resurrect"), /deleted/);
    const next = agent.createConversation();
    agent.updateConversation(next.id, { archived: true });
    assert.throws(() => agent.start(next.id, "Run archived"), /Restore/);
  } finally {
    await agent.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("search includes message bodies and drafts, respects archive filter and uses renamed title", () => {
  const c = {
    id: "chat",
    title: "设计方案",
    text: "unsent idea",
    archived: false,
    created: 1,
    updated: 2,
  };
  assert.equal(conversationTitle(c, [task()]), "设计方案");
  assert.equal(filterConversations([c], [task()], "SQLITE", false).length, 1);
  assert.equal(filterConversations([c], [task()], "idea", false).length, 1);
  assert.equal(filterConversations([c], [task()], "sqlite", true).length, 0);
  assert.equal(
    filterConversations([{ ...c, archived: true }], [task()], "设计", true)
      .length,
    1,
  );
  assert.deepEqual(
    readLegacyDrafts({
      getItem: () => JSON.stringify([{ id: "chat", text: "draft" }]),
    } as any),
    [{ id: "chat", text: "draft" }],
  );
  assert.throws(() =>
    readLegacyDrafts({ getItem: () => "broken json" } as any),
  );
});

test("a restarted agent resumes the stored SDK session after conversation metadata changes", async () => {
  const root = temp(),
    script = path.join(root, "worker.cjs");
  writeFileSync(
    script,
    `const fs=require('node:fs'); const path=require('node:path'); const send=x=>console.log(JSON.stringify(x));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type!=='start')return;fs.appendFileSync(path.join(m.repo,'sessions.jsonl'),JSON.stringify({id:m.sessionID||null})+'\\n');send({type:'session',id:m.sessionID||'persisted-session'});send({type:'text',text:'Done'});send({type:'done',status:'completed'});process.exit(0);});`,
  );
  const credentials = {
    BYTEPLUS_ARK_API_KEY: "fixture",
    BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid",
  };
  const open = () =>
    new Agent(
      root,
      path.join(root, "state"),
      process.execPath,
      () => {},
      credentials,
      [script],
    );
  let agent = open();
  const finish = async () => {
    for (
      let i = 0;
      i < 100 && agent.list().some((t) => t.status === "running");
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(agent.list().every((t) => t.status === "unverified"));
  };
  try {
    const chat = agent.createConversation();
    agent.start(chat.id, "First turn");
    await finish();
    agent.updateConversation(chat.id, {
      title: "Renamed",
      archived: true,
      text: "Second turn",
    });
    await agent.close();
    agent = open();
    agent.updateConversation(chat.id, { archived: false });
    agent.start(chat.id, "Second turn");
    await finish();
    assert.deepEqual(
      readFileSync(path.join(root, "sessions.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).id),
      [null, "persisted-session"],
    );
    assert.equal(agent.conversations().conversations[0].title, "Renamed");
    assert.ok(agent.list().every((t) => !("sessionID" in t)));
  } finally {
    await agent.close();
    rmSync(root, { recursive: true, force: true });
  }
});

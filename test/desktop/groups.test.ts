import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ConversationStore } from "../../desktop/main/conversations";

test("groups persist, move conversations, preserve pins and dissolve without deleting history or grants", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-groups-"));
  let store = new ConversationStore(root);
  try {
    const a = store.create(),
      b = store.create();
    const first = store.createGroup("Work"),
      second = store.createGroup("Personal");
    store.grantFolders(a.id, [root]);
    store.setPermissionMode(a.id, "auto");
    store.update(a.id, { text: "unsent", pinned: true, groupID: first.id });
    store.saveTask({
      id: "task",
      conversationID: a.id,
      prompt: "question",
      text: "answer",
      status: "unverified",
      permissions: [],
      updated: Date.now(),
    });
    store.updateGroup(first.id, { name: "工作", collapsed: true });
    store.update(b.id, { groupID: second.id });
    store.close();
    store = new ConversationStore(root);
    assert.equal(store.getGroup(first.id).collapsed, true);
    assert.equal(store.getGroup(first.id).name, "工作");
    assert.equal(store.get(a.id).pinned, true);
    assert.equal(store.get(a.id).groupID, first.id);
    store.update(a.id, { groupID: second.id });
    store.deleteGroup(second.id);
    assert.equal(store.get(a.id).groupID, null);
    assert.equal(store.get(b.id).groupID, null);
    assert.equal(store.get(a.id).text, "unsent");
    assert.equal(store.get(a.id).pinned, true);
    assert.equal(store.get(a.id).permissionMode, "auto");
    assert.deepEqual(store.get(a.id).folders, [root]);
    assert.equal(store.tasks()[0].text, "answer");
    assert.equal(store.state().groups.length, 1);
    assert.throws(
      () =>
        store.update(a.id, { title: "must not change", groupID: "missing" }),
      /Group/,
    );
    assert.equal(store.get(a.id).title, "");
    assert.throws(() => store.update(a.id, { pinned: "yes" } as any), /pin/);
    assert.throws(() => store.createGroup("  "), /name/);
    assert.throws(
      () => store.updateGroup(first.id, { collapsed: 1 } as any),
      /state/,
    );
    store.update(a.id, { groupID: first.id, pinned: false });
    store.remove(a.id);
    assert.equal(store.getGroup(first.id).name, "工作");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("schema v3 upgrades without losing conversations and nested legacy draft imports remain atomic", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-group-upgrade-"));
  const db = new DatabaseSync(path.join(root, "conversations.sqlite"));
  db.exec(
    `CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL DEFAULT '',draft TEXT NOT NULL DEFAULT '',acceptance TEXT,archived INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL); INSERT INTO conversations(id,title,created,updated) VALUES ('old','Existing chat',1,1); PRAGMA user_version=3;`,
  );
  db.close();
  const store = new ConversationStore(root);
  try {
    assert.equal(store.get("old").title, "Existing chat");
    assert.equal(store.get("old").pinned, false);
    assert.equal(store.get("old").groupID, null);
    assert.deepEqual(store.state().groups, []);
    assert.throws(() =>
      store.importDrafts([
        { id: "old", text: "temporary" },
        { id: "bad", text: 5 } as any,
      ]),
    );
    assert.equal(store.get("old").text, "");
    assert.equal(store.list().length, 1);
    store.importDrafts([{ id: "old", text: "restored" }]);
    assert.equal(store.get("old").text, "restored");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("new group and moving its conversation are atomic and preserve existing data", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-create-move-"));
  const store = new ConversationStore(root);
  try {
    const chat = store.create();
    store.update(chat.id, { text: "draft", pinned: true });
    assert.throws(
      () => store.createGroup("Not created", "missing"),
      /no longer exists/,
    );
    assert.equal(store.groups().length, 0);
    const group = store.createGroup("New destination", chat.id);
    assert.equal(store.get(chat.id).groupID, group.id);
    assert.equal(store.get(chat.id).text, "draft");
    assert.equal(store.get(chat.id).pinned, true);
    assert.equal(store.groups().length, 1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

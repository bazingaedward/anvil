import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversationStore } from "../../desktop/main/conversations";
import { DatabaseSync } from "node:sqlite";
import { allowsMemoryOperation } from "../../desktop/main/folder-access";

test("legacy DB notes migrate to Markdown once; external edits and deletions stay authoritative", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-migrate-"));
  try {
    let store = new ConversationStore(root);
    store.close();
    const db = new DatabaseSync(path.join(root, "conversations.sqlite"));
    const note = {
      id: "legacy",
      title: "偏好",
      body: "使用中文",
      kind: "user",
      scope: null,
      sourceTaskID: null,
      revision: 1,
      updated: 1,
    };
    db.prepare("INSERT INTO memory_notes VALUES (?,?,?,?)").run(
      note.id,
      JSON.stringify(note),
      1,
      1,
    );
    db.close();
    store = new ConversationStore(root);
    const files = store.memory.files;
    const saved = store.memory.notes()[0];
    assert.match(saved.id, /legacy.md$/);
    assert.match(
      readFileSync(path.join(files.root, saved.id), "utf8"),
      /使用中文/,
    );
    assert.match(files.indexes([])[0].index, /偏好/);
    writeFileSync(path.join(files.root, saved.id), "# 新偏好\n改用简短中文。");
    assert.equal(store.memory.notes()[0].title, "新偏好");
    assert.throws(
      () => store.memory.save({ ...saved, body: "过时修改" }),
      /changed elsewhere/,
    );
    const dir = files.directory(null);
    writeFileSync(
      path.join(dir, "agent.md"),
      "# Agent 保存\n可直接编辑的 Markdown。",
    );
    assert.equal(store.memory.notes().length, 2);
    assert.equal(files.enabled(), true);
    files.setEnabled(false);
    store.close();
    store = new ConversationStore(root);
    assert.equal(store.memory.files.enabled(), false);
    const current = store.memory.notes().find((n) => n.id === saved.id)!;
    store.memory.remove(current.id, current.revision);
    store.close();
    store = new ConversationStore(root);
    assert.equal(store.memory.notes().length, 1);
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("automatic memory permission stays within exact memory directories and Markdown file tools", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-memory-policy-"));
  try {
    const dirs = [root];
    assert.equal(
      allowsMemoryOperation("edit", [path.join(root, "MEMORY.md")], root, dirs),
      true,
    );
    assert.equal(
      allowsMemoryOperation(
        "external_directory",
        [root.replaceAll("\\", "/") + "/*"],
        root,
        dirs,
      ),
      true,
    );
    for (const [action, resource] of [
      ["shell", "echo x"],
      ["edit", path.join(root, "settings.json")],
      ["read", path.join(root, "../secret.md")],
      ["external_directory", path.dirname(root) + "/*"],
    ])
      assert.equal(
        allowsMemoryOperation(action, [resource], root, dirs),
        false,
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

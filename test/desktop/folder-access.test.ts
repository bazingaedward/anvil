import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  allowsFolderOperation,
  allowsOperation,
} from "../../desktop/main/folder-access";
import { ConversationStore } from "../../desktop/main/conversations";

test("folder grants only allow explicit in-scope file operations, including new files", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "anvil-grants-")),
  );
  const folder = path.join(root, "allowed");
  mkdirSync(folder);
  const outside = path.join(root, "outside");
  mkdirSync(outside);
  try {
    assert.equal(
      allowsFolderOperation("read", ["file.ts"], folder, [folder]),
      true,
    );
    assert.equal(
      allowsFolderOperation("edit", ["new/sub/file.ts"], folder, [folder]),
      true,
    );
    for (const resources of [
      ["../outside/file"],
      ["../allowed-other/file"],
      ["*.ts"],
      [],
      ["file", 2],
      ["file", "../outside/file"],
    ])
      assert.equal(
        allowsFolderOperation("read", resources, folder, [folder]),
        false,
      );
    assert.equal(
      allowsFolderOperation("shell", [folder], folder, [folder]),
      false,
    );
    assert.equal(
      allowsFolderOperation("mcp_edit", [folder], folder, [folder]),
      false,
    );
    assert.equal(allowsFolderOperation("read", ["file"], folder, []), false);
    symlinkSync(
      outside,
      path.join(folder, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.equal(
      allowsFolderOperation("edit", ["link/new.txt"], folder, [folder]),
      false,
    );
    if (process.platform === "win32")
      assert.equal(
        allowsFolderOperation("read", ["file:secret"], folder, [folder]),
        false,
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("folder authorization survives restart, is per-conversation and cannot be set by draft updates", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-grant-store-"));
  let store = new ConversationStore(root);
  try {
    const a = store.create(),
      b = store.create();
    assert.deepEqual(a.folders, []);
    assert.equal(a.permissionMode, "ask");
    store.setPermissionMode(a.id, "auto");
    assert.equal(store.get(b.id).permissionMode, "ask");
    assert.throws(
      () => store.update(b.id, { permissionMode: "full" } as any),
      /Unknown/,
    );
    assert.throws(
      () => store.setPermissionMode(b.id, "invalid" as any),
      /Invalid/,
    );
    store.grantFolders(a.id, [root, root]);
    assert.deepEqual(store.get(a.id).folders, [root]);
    assert.deepEqual(store.get(b.id).folders, []);
    assert.throws(
      () => store.update(b.id, { folders: [root] } as any),
      /Unknown/,
    );
    store.close();
    store = new ConversationStore(root);
    assert.deepEqual(store.get(a.id).folders, [root]);
    assert.equal(store.get(a.id).permissionMode, "auto");
    store.revokeFolder(a.id, root);
    assert.deepEqual(store.get(a.id).folders, []);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("permission modes distinguish scoped reads, edits, commands and outside access", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "anvil-mode-")));
  try {
    for (const mode of ["ask", "auto", "full"] as const) {
      assert.equal(
        allowsOperation(mode, "read", ["file.txt"], root, [root]),
        true,
      );
      assert.equal(
        allowsOperation(mode, "edit", ["file.txt"], root, [root]),
        mode !== "ask",
      );
      for (const action of ["shell", "bash", "mcp"])
        assert.equal(
          allowsOperation(mode, action, ["echo hello"], root, [root]),
          mode === "full",
        );
      assert.equal(
        allowsOperation(mode, "edit", ["../outside"], root, [root]),
        mode === "full",
      );
    }
    assert.equal(
      allowsOperation("invalid", "read", ["file"], root, [root]),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

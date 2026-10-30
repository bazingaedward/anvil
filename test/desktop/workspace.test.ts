import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace, git } from "../../desktop/main/workspace";

async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  commit = true,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-desktop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Anvil Test"]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(root, "hello.ts"), "export const hello = 1;\n");
  if (commit) {
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "fixture"]);
  }
  return { root, workspace: await Workspace.open(root) };
}

test("preserves the selected directory boundary and handles unborn HEAD", async (t) => {
  const { root, workspace } = await fixture(t, false);
  await mkdir(path.join(root, "nested"));
  assert.equal(
    (await Workspace.open(path.join(root, "nested"))).root,
    path.join(workspace.root, "nested"),
  );
  const nested = await Workspace.open(path.join(root, "nested"));
  assert.equal((await nested.status()).git, false);
  await assert.rejects(nested.read("../hello.ts"), /outside/);
  assert.equal((await workspace.status()).branch, "main");
  await git(root, ["add", "hello.ts"]);
  assert.deepEqual(await workspace.diff("hello.ts", "index"), {
    path: "hello.ts",
    original: "",
    modified: "export const hello = 1;\n",
  });
});

test("ordinary directories support file editing without Git", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-folder-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "note.txt"), "hello");
  const folder = await Workspace.open(root);
  assert.equal((await folder.status()).git, false);
  assert.equal((await folder.status()).branch, "");
  const note = await folder.read("note.txt");
  await folder.save({ ...note, content: "updated" });
  assert.equal((await folder.read("note.txt")).content, "updated");
});

test("diffs index and worktree independently and preserves unrelated staged edits on save", async (t) => {
  const { root, workspace } = await fixture(t);
  await writeFile(path.join(root, "hello.ts"), "export const hello = 2;\n");
  await git(root, ["add", "hello.ts"]);
  await writeFile(path.join(root, "hello.ts"), "export const hello = 3;\n");
  const state = await workspace.status();
  assert.equal(state.changes[0].index + state.changes[0].worktree, "MM");
  assert.equal(
    (await workspace.diff("hello.ts", "index")).modified,
    "export const hello = 2;\n",
  );
  const diff = await workspace.diff("hello.ts", "worktree");
  assert.equal(diff.original, "export const hello = 2;\n");
  assert.equal(diff.modified, "export const hello = 3;\n");
  const doc = await workspace.read("hello.ts");
  await workspace.save({ ...doc, content: "export const hello = 4;\n" });
  assert.equal(
    (await git(root, ["show", ":hello.ts"])).toString(),
    "export const hello = 2;\n",
  );
});

test("rejects stale saves without losing the external file", async (t) => {
  const { root, workspace } = await fixture(t);
  const doc = await workspace.read("hello.ts");
  await writeFile(path.join(root, "hello.ts"), "external edit");
  await assert.rejects(
    workspace.save({ ...doc, content: "my edit" }),
    /changed on disk/,
  );
  assert.equal(
    await readFile(path.join(root, "hello.ts"), "utf8"),
    "external edit",
  );
});

test("handles Unicode, spaces, renames, deletions and untracked files", async (t) => {
  const { root, workspace } = await fixture(t);
  await git(root, ["mv", "hello.ts", "你好 world.ts"]);
  const renamed = (await workspace.status()).changes[0];
  assert.equal(renamed.originalPath, "hello.ts");
  const diff = await workspace.diff(renamed.path, "index");
  assert.equal(diff.original, diff.modified);
  await rm(path.join(root, renamed.path));
  assert.equal((await workspace.diff(renamed.path, "worktree")).modified, "");
  await writeFile(path.join(root, "new file.txt"), "new\n");
  assert.deepEqual(await workspace.diff("new file.txt", "worktree"), {
    path: "new file.txt",
    original: "",
    modified: "new\n",
  });
});

test("blocks traversal, Git internals, symlinks, binary and oversized files", async (t) => {
  const { root, workspace } = await fixture(t);
  await assert.rejects(workspace.read("../outside"), /outside/);
  await assert.rejects(workspace.list(".git"), /Git internals/);
  await assert.rejects(workspace.read(root), /Invalid/);
  if (process.platform !== "win32") {
    await symlink(path.join(root, "hello.ts"), path.join(root, "link"));
    await assert.rejects(workspace.read("link"), /Symbolic/);
  }
  await writeFile(path.join(root, "binary"), Buffer.from([0, 255]));
  await assert.rejects(workspace.diff("binary", "worktree"), /Binary/);
  await writeFile(
    path.join(root, "big"),
    Buffer.alloc(2 * 1024 * 1024 + 1, 65),
  );
  await assert.rejects(workspace.read("big"), /2 MiB/);
  assert.equal(
    (await workspace.list("")).some((entry) => entry.name === ".git"),
    false,
  );
});

test("staged deletions show HEAD content against an empty index", async (t) => {
  const { root, workspace } = await fixture(t);
  await git(root, ["rm", "hello.ts"]);
  const diff = await workspace.diff("hello.ts", "index");
  assert.equal(diff.original, "export const hello = 1;\n");
  assert.equal(diff.modified, "");
});

test("Git-special filenames are looked up as literal paths", async (t) => {
  const { root, workspace } = await fixture(t);
  for (const name of ["[one].txt", "-option.txt"])
    await writeFile(path.join(root, name), "before");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "paths"]);
  for (const name of ["[one].txt", "-option.txt"]) {
    await writeFile(path.join(root, name), "after");
    await git(root, ["add", "--", name]);
    assert.equal((await workspace.diff(name, "index")).original, "before");
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { git } from "../../desktop/main/workspace";
import {
  fetchRemotes,
  reviewHistory,
  reviewPatch,
} from "../../desktop/main/review";
test("review graph follows branches and merge parents; comparisons use explicit commits", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  assert.deepEqual((await reviewHistory(root, 100)).commits, []);
  await writeFile(path.join(root, "a.txt"), "base\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);
  const first = (await git(root, ["rev-parse", "HEAD"])).toString().trim();
  await git(root, ["checkout", "-b", "feature"]);
  await writeFile(path.join(root, "feature.txt"), "feature\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "feature change"]);
  await git(root, ["checkout", "main"]);
  await writeFile(path.join(root, "main.txt"), "main\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "main change"]);
  await git(root, ["merge", "--no-ff", "feature", "-m", "merge feature"]);
  const last = (await git(root, ["rev-parse", "HEAD"])).toString().trim();
  const history = await reviewHistory(root, 100);
  assert.ok(history.commits.some((c) => c.hash === first));
  assert.ok(history.commits.some((c) => c.title === "feature change"));
  assert.equal(history.commits[0].parents.length, 2);
  assert.equal(history.commits[0].title, "merge feature");
  const branch = await reviewHistory(root, 100, {
    branch: "refs/heads/feature",
  });
  assert.ok(!branch.commits.some((c) => c.hash === last));
  await assert.rejects(
    reviewHistory(root, 100, { branch: "--output=bad" }),
    /Unknown/,
  );
  await writeFile(path.join(root, "a.txt"), "stash change\n");
  await git(root, ["stash", "push", "-m", "hidden stash"]);
  assert.ok(
    !(await reviewHistory(root, 100)).commits.some((c) =>
      c.title.includes("hidden stash"),
    ),
  );
  assert.ok(
    (await reviewHistory(root, 100, { stash: true })).commits.some((c) =>
      c.title.includes("hidden stash"),
    ),
  );
  const patch = await reviewPatch(root, last, first);
  assert.ok(patch.includes("+feature"));
  assert.ok(patch.includes("+main"));
  const single = await reviewPatch(root, first);
  assert.ok(single.includes("+base"));
  assert.equal((await reviewHistory(root, 1)).commits[0].hash, last);
  await assert.rejects(reviewPatch(root, "--output=bad"), /Invalid/);
  await assert.rejects(reviewHistory(root, 1001), /Invalid/);
  await mkdir(path.join(root, "nested"));
  await assert.rejects(reviewHistory(path.join(root, "nested"), 100), /root/);
});

import { graphRows } from "../../desktop/renderer/review-graph";
test("graph lanes connect merge parents and converge at their shared ancestor", () => {
  const rows = graphRows(
    [
      { hash: "merge", parents: ["left", "right"] },
      { hash: "left", parents: ["base"] },
      { hash: "right", parents: ["base"] },
      { hash: "base", parents: [] },
    ].map((c) => ({ ...c, title: c.hash, author: "", date: "", refs: [] })),
  );
  assert.equal(rows[0].incoming, false);
  assert.equal(rows[0].edges.length, 2);
  assert.notEqual(rows[0].edges[0].to, rows[0].edges[1].to);
  assert.equal(rows[2].edges.filter((e) => e.start)[0].to, rows[3].column);
  assert.equal(rows[3].edges.length, 0);
  for (const row of rows) assert.ok(row.edges.every((e) => e.to >= 0));
});

test("fetch updates remote history while preserving HEAD, index and dirty files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-fetch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote");
  const local = path.join(root, "local");
  await mkdir(remote);
  await git(remote, ["init", "-b", "main"]);
  await git(remote, ["config", "user.name", "Test"]);
  await git(remote, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(remote, "file.txt"), "initial");
  await git(remote, ["add", "."]);
  await git(remote, ["commit", "-m", "initial"]);
  await assert.rejects(fetchRemotes(remote), /No remotes/);
  await git(root, ["clone", remote, local]);
  await writeFile(path.join(local, "file.txt"), "staged");
  await git(local, ["add", "."]);
  await writeFile(path.join(local, "file.txt"), "unstaged");
  await writeFile(path.join(local, "untracked.txt"), "keep me");
  const head = await git(local, ["rev-parse", "HEAD"]);
  const index = await git(local, ["write-tree"]);
  const status = await git(local, ["status", "--porcelain"]);
  await writeFile(path.join(remote, "file.txt"), "remote update");
  await git(remote, ["commit", "-am", "new remote commit"]);
  const remoteHead = (await git(remote, ["rev-parse", "HEAD"]))
    .toString()
    .trim();
  assert.ok(
    !(await reviewHistory(local, 100)).commits.some(
      (c) => c.hash === remoteHead,
    ),
  );
  await fetchRemotes(local);
  assert.ok(
    (await reviewHistory(local, 100)).commits.some(
      (c) => c.hash === remoteHead,
    ),
  );
  assert.deepEqual(await git(local, ["rev-parse", "HEAD"]), head);
  assert.deepEqual(await git(local, ["write-tree"]), index);
  assert.deepEqual(await git(local, ["status", "--porcelain"]), status);
  assert.equal(
    await readFile(path.join(local, "file.txt"), "utf8"),
    "unstaged",
  );
  assert.equal(
    await readFile(path.join(local, "untracked.txt"), "utf8"),
    "keep me",
  );
  await git(local, ["remote", "set-url", "origin", path.join(root, "missing")]);
  await assert.rejects(fetchRemotes(local));
  await mkdir(path.join(local, "nested"));
  await assert.rejects(fetchRemotes(path.join(local, "nested")), /root/);
});

test("search spans unloaded history, paginates, respects scopes and opens old commit context", async (t) => {
  const { searchHistory } = await import("../../desktop/main/review");
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Search Author"]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(root, "file"), "base");
  await git(root, ["add", "."]);
  const tree = (await git(root, ["write-tree"])).toString().trim();
  let head = "";
  const ids: string[] = [];
  for (let i = 0; i < 105; i++) {
    head = (
      await git(root, [
        "commit-tree",
        tree,
        ...(head ? ["-p", head] : []),
        "-m",
        `record ${i}`,
      ])
    )
      .toString()
      .trim();
    ids.push(head);
  }
  await git(root, ["update-ref", "refs/heads/main", head]);
  await git(root, ["tag", "release-needle", ids[0]]);
  assert.ok(
    !(await reviewHistory(root, 100)).commits.some((c) => c.hash === ids[0]),
  );
  assert.equal(
    (await searchHistory(root, ids[0].slice(0, 12))).commits[0].hash,
    ids[0],
  );
  assert.equal(
    (await searchHistory(root, "RELEASE-NEEDLE")).commits[0].hash,
    ids[0],
  );
  const first = await searchHistory(root, "Search Author");
  assert.equal(first.commits.length, 50);
  const second = await searchHistory(root, "Search Author", first.next!);
  const third = await searchHistory(root, "Search Author", second.next!);
  assert.equal(
    new Set(
      [...first.commits, ...second.commits, ...third.commits].map(
        (c) => c.hash,
      ),
    ).size,
    105,
  );
  assert.equal(third.next, null);
  const remote = (
    await git(root, [
      "commit-tree",
      tree,
      "-p",
      head,
      "-m",
      "remote-only-message",
    ])
  )
    .toString()
    .trim();
  await git(root, ["update-ref", "refs/remotes/origin/feature", remote]);
  assert.equal(
    (await searchHistory(root, "remote-only-message")).commits.length,
    1,
  );
  assert.equal(
    (await searchHistory(root, "remote-only-message", 0, { remotes: false }))
      .commits.length,
    0,
  );
  assert.equal(
    (
      await searchHistory(root, "remote-only-message", 0, {
        branch: "refs/heads/main",
      })
    ).commits.length,
    0,
  );
  assert.equal(
    (await searchHistory(root, "no such [literal] --option")).commits.length,
    0,
  );
  assert.equal(
    (await reviewHistory(root, 100, { commit: ids[0] })).commits[0].hash,
    ids[0],
  );
  assert.ok((await reviewPatch(root, ids[0])).includes("record 0"));
  await assert.rejects(searchHistory(root, "record", -1), /Invalid/);
  await assert.rejects(
    searchHistory(root, "record", 0, { branch: "--all" }),
    /Unknown/,
  );
});

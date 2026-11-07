import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { git } from "../../desktop/main/workspace";
import { reviewHistory, reviewPatch } from "../../desktop/main/review";
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

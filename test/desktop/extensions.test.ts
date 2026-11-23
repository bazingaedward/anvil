import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  expandSkill,
  githubSkill,
  readSkill,
  repoFromOrigin,
} from "../../desktop/main/extensions";
import {
  defaultExtensions,
  validateExtensions,
} from "../../desktop/shared/extensions";

test("clones share bindings by GitHub origin without sharing local paths", () => {
  for (const origin of [
    "git@github.com:Alice/Example.git",
    "https://github.com/alice/example",
    "ssh://git@github.com/alice/example.git",
  ])
    assert.equal(repoFromOrigin(origin), "alice/example");
  for (const origin of [
    "https://github.com.evil.invalid/alice/example",
    "file:///tmp/repo",
    "https://user:secret@github.com/u/r",
  ])
    assert.equal(repoFromOrigin(origin), null);
});
test("skill imports snapshot relative text files, exclude hidden files and links, and work on another device", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anvil-skills-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    path.join(dir, "SKILL.md"),
    "---\nname: review-tests\n---\nReview the test coverage.",
  );
  await mkdir(path.join(dir, "references"));
  await writeFile(
    path.join(dir, "references", "guide.md"),
    "Check boundary cases",
  );
  await writeFile(path.join(dir, ".env"), "PRIVATE_MARKER");
  if (process.platform !== "win32")
    await symlink(path.join(dir, ".env"), path.join(dir, "link.md"));
  const skill = await readSkill(dir);
  const config = validateExtensions(
    JSON.parse(JSON.stringify({ ...defaultExtensions, skills: [skill] })),
  );
  assert.equal(skill.id, "review-tests");
  const text = expandSkill(
    "/review-tests module",
    { repo: null, config },
    true,
  );
  assert.match(text, /boundary cases/);
  assert.match(text, /module/);
  assert.ok(!text.includes(dir) && !text.includes("PRIVATE_MARKER"));
});
test("built-in review requires matching runtime, enabled tool and binding", () => {
  const binding = { repo: "a/b", login: "alice", auth: "cli" as const };
  const config = validateExtensions({
    ...defaultExtensions,
    enabled: ["github", "review-pr"],
    bindings: [binding],
  });
  assert.throws(() =>
    expandSkill("/review-pr 42", { repo: null, config }, false),
  );
  assert.throws(() =>
    expandSkill("/review-pr 42", { repo: "a/b", binding, config }, true),
  );
  assert.match(
    expandSkill("/review-pr 42", { repo: "a/b", binding, config }, false),
    /alice/,
  );
});

test("repository imports resolve only the selected commit, directory and regular text blobs", async () => {
  const sha = "1".repeat(40),
    blob = "2".repeat(40),
    source = "https://github.com/example/repo/tree/" + sha + "/skills/demo";
  const calls: string[] = [];
  const load: typeof fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/trees/"))
      return Response.json({
        tree: [
          { path: "skills/demo/SKILL.md", mode: "100644", sha: blob, size: 4 },
          { path: "skills/demo/link.md", mode: "120000", sha: blob, size: 4 },
          { path: "elsewhere/private.md", mode: "100644", sha: blob, size: 4 },
        ],
      });
    return Response.json({ content: Buffer.from("demo").toString("base64") });
  };
  const skill = await githubSkill(source, load);
  assert.deepEqual(skill, {
    id: "demo",
    source,
    enabled: true,
    files: [{ path: "SKILL.md", text: "demo" }],
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0], new RegExp(sha));
  await assert.rejects(githubSkill(source.replace(sha, "main"), load));
  assert.equal(calls.length, 2);
});

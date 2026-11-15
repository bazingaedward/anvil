import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  lstat,
  rm,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
const exec = promisify(execFile);
export async function writeFiles(root, files) {
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }
}
async function runTest(root, args) {
  try {
    await exec(process.execPath, args, {
      cwd: root,
      timeout: 15000,
      maxBuffer: 65536,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: os.tmpdir(),
      },
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}
export async function verify(task, candidate) {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-verifier-"));
  try {
    // Only declared source files enter the verifier, never agent-edited configuration.
    for (const name of Object.keys(task.solution)) {
      let parent = candidate;
      for (const segment of name.split("/")) {
        parent = path.join(parent, segment);
        if ((await lstat(parent)).isSymbolicLink())
          return { passed: false, reason: "symlink" };
      }
      const stat = await lstat(parent);
      if (!stat.isFile() || stat.size > 262144)
        return { passed: false, reason: "invalid-file" };
      await writeFiles(root, { [name]: await readFile(parent, "utf8") });
    }
    if (task.mutationTest) {
      if (
        (await readFile(path.join(root, "src/slug.mjs"), "utf8")) !==
        task.files["src/slug.mjs"]
      )
        return { passed: false, reason: "protected-source-changed" };
      if (!(await runTest(root, ["--test", "test/slug.test.mjs"])))
        return { passed: false, reason: "tests-fail" };
      const mutants = [
        "export const slug=s=>s.trim().replace(/\\s+/g,'-');",
        "export const slug=s=>s.toLowerCase();",
        "export const slug=s=>s.trim().toLowerCase().replace(/\\s+/g,'-')||'empty';",
      ];
      for (const source of mutants) {
        await writeFiles(root, { "src/slug.mjs": source });
        if (await runTest(root, ["--test", "test/slug.test.mjs"]))
          return { passed: false, reason: "surviving-mutant" };
      }
      return { passed: true };
    }
    await writeFiles(root, {
      "verify.mjs": `import assert from 'node:assert/strict';const load=p=>import('./'+p);\n${task.checks}`,
    });
    const passed = await runTest(root, ["verify.mjs"]);
    return { passed, reason: passed ? undefined : "assertions-failed" };
  } catch {
    return { passed: false, reason: "missing-or-unreadable-file" };
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

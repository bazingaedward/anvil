import { Agent } from "../../desktop/main/agent";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
mkdirSync(".anvil/integration-probes", { recursive: true });
const root = mkdtempSync(path.resolve(".anvil/integration-probes/run-"));
execFileSync("git", ["init", "-q", root], { windowsHide: true });
writeFileSync(path.join(root, "proof.txt"), "ANVIL_TOOL_OK");
const other = mkdtempSync(path.resolve(".anvil/integration-probes/folder-"));
writeFileSync(path.join(other, "second.txt"), "ANVIL_SECOND_FOLDER_OK");
let approvalCount = 0;
const replied = new Set<string>();
const agent = new Agent(
  root,
  path.join(root, "state"),
  path.resolve("runtime/opencode/dist/anvil-runtime.exe"),
  (task) => {
    for (const permission of task.permissions) {
      if (replied.has(permission.id)) continue;
      replied.add(permission.id);
      console.log(
        JSON.stringify({
          approval: permission.action,
          resources: permission.resources,
        }),
      );
      approvalCount++;
      agent.reply(
        task.id,
        permission.id,
        ["read", "external_directory"].includes(permission.action) &&
          permission.resources.every((resource) => {
            const resolved = path.resolve(
              root,
              resource.replace(/[\\/]\*$/, ""),
            );
            return [root, other].some((folder) => {
              const relative = path.relative(folder, resolved);
              return (
                !path.isAbsolute(relative) &&
                relative !== ".." &&
                !relative.startsWith(`..${path.sep}`)
              );
            });
          }),
      );
    }
  },
  {
    BYTEPLUS_ARK_API_KEY: process.env.BYTEPLUS_ARK_API_KEY,
    BYTEPLUS_ARK_RESPONSES_URL: process.env.BYTEPLUS_ARK_RESPONSES_URL,
  },
);
try {
  for (const prompt of [
    "Remember the marker ANVIL_CONTEXT_OK. Reply with exactly ANVIL_MODEL_OK. Do not use tools.",
    `Read proof.txt and ${JSON.stringify(path.join(other, "second.txt"))} with tools. Report both file contents, followed by the marker I asked you to remember.`,
  ]) {
    const task = agent.start(
      "probe",
      prompt,
      [root, other],
      prompt.startsWith("Read") ? other : root,
    );
    const start = Date.now();
    while (
      agent.list().find((t) => t.id === task.id)?.status === "running" &&
      Date.now() - start < 90000
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    const result = agent.list().find((t) => t.id === task.id)!;
    console.log(
      JSON.stringify({
        status: result.status,
        text: result.text,
        error: result.error,
      }),
    );
    assert.equal(result.status, "unverified");
    if (prompt.startsWith("Read")) {
      assert.ok(result.text.includes("ANVIL_TOOL_OK"));
      assert.ok(result.text.includes("ANVIL_CONTEXT_OK"));
      assert.ok(result.text.includes("ANVIL_SECOND_FOLDER_OK"));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(approvalCount > 0, "Expected a real tool permission request");
  function check(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) check(file);
      else
        assert.ok(
          !readFileSync(file).includes(
            Buffer.from(process.env.BYTEPLUS_ARK_API_KEY!),
          ),
          "Credential must not be persisted",
        );
    }
  }
  check(root);
  console.log(JSON.stringify({ result: "passed", approvalCount }));
} finally {
  agent.stop();
}

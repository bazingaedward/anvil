import { mkdtemp, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { startRuntime } from "../desktop/main/runtime.ts";
import { discoverCopilotModels } from "../desktop/main/model-probe.ts";
const key = process.env.ANVIL_COPILOT_OAUTH;
delete process.env.ANVIL_COPILOT_OAUTH;
if (!key) throw new Error("Run through Keygrant with ANVIL_COPILOT_OAUTH.");
const executable = path.resolve(
  `runtime/opencode/dist/anvil-runtime${process.platform === "win32" ? ".exe" : ""}`,
);
const models = await discoverCopilotModels(executable, key);
console.log(
  JSON.stringify({ stage: "models", models: models.map((m) => m.model) }),
);
for (const id of process.argv.slice(2)) {
  const model = models.find((m) => m.model === id);
  if (!model) {
    console.log(JSON.stringify({ model: id, status: "unavailable" }));
    continue;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-copilot-smoke-"));
  const started = Date.now();
  const tools = [];
  let firstText;
  let text = "";
  try {
    await writeFile(
      path.join(root, "sum.cjs"),
      "module.exports = (a, b) => a - b;\n",
    );
    await writeFile(
      path.join(root, "check.cjs"),
      "require('node:assert/strict').equal(require('./sum.cjs')(2, 3), 5);\n",
    );
    const run = startRuntime(
      {
        repo: root,
        state: path.join(root, "state"),
        directories: [root],
        model,
        text: "Fix sum.cjs so it adds its two arguments. Read the file, modify only sum.cjs, and run node check.cjs. Do not change check.cjs. Finish with a short result.",
      },
      {
        executable,
        key,
        endpoint: model.endpoint,
        signal: AbortSignal.timeout(120000),
        onEvent(event, reply) {
          if (event.type === "permission")
            reply(
              event.permission.id,
              ["read", "edit", "write", "shell", "glob", "grep"].includes(
                event.permission.action,
              ),
            );
          if (event.type === "tool")
            tools.push({ name: event.name, status: event.status });
          if (event.type === "text") {
            firstText ??= Date.now() - started;
            text += event.text;
          }
        },
      },
    );
    const result = await run.done;
    const check = spawnSync(process.execPath, ["check.cjs"], {
      cwd: root,
      stdio: "ignore",
    });
    // Scan binary and text artifacts for the OAuth credential without printing any value.
    const values = [
      key,
      JSON.parse(key).access,
      JSON.parse(key).refresh,
    ].filter(Boolean);
    let leaked = false;
    for (const file of await readdir(root, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!file.isFile()) continue;
      const bytes = await readFile(path.join(file.parentPath, file.name));
      if (values.some((value) => bytes.includes(Buffer.from(value))))
        leaked = true;
    }
    console.log(
      JSON.stringify({
        model: id,
        status: result.status,
        error: result.error,
        elapsedMs: Date.now() - started,
        firstTextMs: firstText,
        answerChars: text.length,
        tools,
        checkPassed: check.status === 0,
        credentialPersisted: leaked,
      }),
    );
    if (result.status !== "completed" || check.status !== 0 || leaked)
      process.exitCode = 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

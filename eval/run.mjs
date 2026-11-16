import { tasks as calibrationTasks } from "./tasks.mjs";
import { repoTasks } from "./repo-tasks.mjs";
import { verify, writeFiles } from "./verify.mjs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  copyFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { startRuntime } from "../desktop/main/runtime.ts";
import { defaultModel } from "../desktop/main/composer.ts";
import { discoverCopilotModels } from "../desktop/main/model-probe.ts";
const args = process.argv.slice(2);
const suite =
  args.find((x) => x.startsWith("--suite="))?.slice(8) || "calibration";
if (!["calibration", "repository"].includes(suite))
  throw Error("Unknown suite");
const tasks = suite === "repository" ? repoTasks : calibrationTasks;
const selected = args.find((x) => x.startsWith("--task="))?.slice(7);
const copilotID = args.find((x) => x.startsWith("--copilot="))?.slice(10);
if (args.includes("--list")) {
  console.log(tasks.map((t) => `${t.id}\t${t.category}`).join("\n"));
  process.exit(0);
}
const chosen = selected ? tasks.filter((t) => t.id === selected) : tasks;
if (!chosen.length) throw Error("Unknown task");
const key = copilotID
  ? process.env.ANVIL_COPILOT_OAUTH
  : process.env.BYTEPLUS_ARK_API_KEY;
let endpoint = copilotID
  ? "https://api.githubcopilot.com"
  : process.env.BYTEPLUS_ARK_RESPONSES_URL;
if (!key || !endpoint)
  throw Error(
    copilotID
      ? "Run through Keygrant with ANVIL_COPILOT_OAUTH."
      : "Run through Keygrant with the BytePlus key and URL.",
  );
delete process.env.BYTEPLUS_ARK_API_KEY;
delete process.env.BYTEPLUS_ARK_RESPONSES_URL;
delete process.env.ANVIL_COPILOT_OAUTH;
const executable = path.resolve(
  "runtime/opencode/dist",
  process.platform === "win32" ? "anvil-runtime.exe" : "anvil-runtime",
);
const model = copilotID
  ? (await discoverCopilotModels(executable, key)).find(
      (item) => item.model === copilotID,
    )
  : defaultModel;
if (!model) throw Error(`Requested Copilot model is unavailable: ${copilotID}`);
if (copilotID) endpoint = model.endpoint;
const root = await mkdtemp(path.join(os.tmpdir(), "anvil-eval-"));
const output = path.resolve(
  ".anvil/evaluations",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(output, { recursive: true });
const summary = {
  schemaVersion: 1,
  suite,
  state: "running",
  evaluatorHash: createHash("sha256")
    .update(await readFile(new URL("./verify.mjs", import.meta.url)))
    .digest("hex"),
  runnerHash: createHash("sha256")
    .update(await readFile(new URL("./run.mjs", import.meta.url)))
    .digest("hex"),
  startedAt: new Date().toISOString(),
  model: model.model,
  protocol: copilotID ? "copilot-native" : "responses",
  revision: execFileSync(
    "git",
    [
      "-c",
      "safe.directory=" + process.cwd().replaceAll("\\", "/"),
      "rev-parse",
      "HEAD",
    ],
    { encoding: "utf8" },
  ).trim(),
  suiteHash: createHash("sha256").update(JSON.stringify(tasks)).digest("hex"),
  runtimeHash: createHash("sha256")
    .update(await readFile(executable))
    .digest("hex"),
  platform: process.platform,
  timeoutMs: 180000,
  permissions: "allow-all; trusted evaluation fixtures only; not sandboxed",
  tokens: null,
  cost: null,
  workspace: root,
  results: [],
};
const save = () =>
  writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
for (const task of chosen) {
  const repo = path.join(root, task.id, "repo"),
    state = path.join(root, task.id, "state");
  await writeFiles(repo, task.files);
  await writeFiles(repo, {
    "README.md":
      task.files["README.md"] ||
      "This is a small coding evaluation fixture. Use Node.js built-ins; do not install dependencies. Modify only files required by the task. No network operations are needed.",
  });
  let sessionID,
    toolActivities = 0,
    permissionRequests = 0,
    textChars = 0,
    status = "completed",
    timedOut = false;
  let firstTextMs, firstToolMs, runtimeError;
  const toolCalls = new Map();
  const start = Date.now(),
    abort = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, summary.timeoutMs);
  try {
    for (const text of task.prompts) {
      const run = startRuntime(
        {
          repo,
          state,
          directories:
            task.id === "multi-directory"
              ? [path.join(repo, "apps"), path.join(repo, "packages")]
              : [repo],
          text,
          sessionID,
          model,
        },
        {
          executable,
          key,
          endpoint,
          signal: abort.signal,
          onEvent(event, reply) {
            if (event.type === "session") sessionID = event.id;
            if (event.type === "activity") toolActivities++;
            if (event.type === "text") {
              firstTextMs ??= Date.now() - start;
              textChars += event.text.length;
            }
            if (event.type === "tool") {
              firstToolMs ??= Date.now() - start;
              const tool = toolCalls.get(event.id) || { name: event.name };
              tool.status = event.status;
              if (event.status === "running")
                tool.startedMs ??= Date.now() - start;
              else tool.endedMs = Date.now() - start;
              toolCalls.set(event.id, tool);
            }
            if (event.type === "permission") {
              permissionRequests++;
              reply(event.permission.id, true);
            }
          },
        },
      );
      const result = await run.done;
      status = result.status;
      runtimeError = result.error;
      if (status !== "completed") break;
      if (task.prompts.length > 1 && !sessionID) {
        status = "failed";
        break;
      }
    }
  } catch {
    status = "failed";
  } finally {
    clearTimeout(timer);
  }
  const checked = await verify(task, repo);
  const result = {
    id: task.id,
    category: task.category,
    status: timedOut ? "timeout" : status,
    passed: status === "completed" && !timedOut && checked.passed,
    verification: checked,
    elapsedMs: Date.now() - start,
    toolActivities,
    permissionRequests,
    textChars,
    turns: task.prompts.length,
    firstTextMs,
    firstToolMs,
    toolCalls: [...toolCalls.values()],
    error: runtimeError,
    tokens: null,
    cost: null,
  };
  summary.results.push(result);
  await save();
  const artifacts = path.join(output, task.id);
  await mkdir(artifacts, { recursive: true });
  for (const name of Object.keys(task.solution)) {
    try {
      const target = path.join(artifacts, name);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(repo, name), target);
    } catch {}
  }
  console.log(
    `${task.id}: ${result.passed ? "PASS" : "FAIL"} (${result.status}, ${result.elapsedMs}ms)`,
  );
}
summary.state = "completed";
summary.finishedAt = new Date().toISOString();
await save();
console.log(`Results: ${output}`);
console.log(
  `Passed ${summary.results.filter((x) => x.passed).length}/${summary.results.length}`,
);

if (summary.results.some((result) => !result.passed)) process.exitCode = 1;

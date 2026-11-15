import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { startRuntime } from "../desktop/main/runtime.ts";
import { defaultModel } from "../desktop/main/composer.ts";
import { allowsFolderOperation } from "../desktop/main/folder-access.ts";
const key = process.env.BYTEPLUS_ARK_API_KEY,
  endpoint = process.env.BYTEPLUS_ARK_RESPONSES_URL;
if (!key || !endpoint) throw Error("通过 Keygrant 注入测试凭据后运行。");
delete process.env.BYTEPLUS_ARK_API_KEY;
delete process.env.BYTEPLUS_ARK_RESPONSES_URL;
const root = await mkdtemp(path.join(os.tmpdir(), "anvil-context-eval-"));
const output = path.resolve(
  ".anvil/evaluations/context-" +
    new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(output, { recursive: true });
await writeFile(path.join(root, "protected.txt"), "DO NOT CHANGE\n");
const model = { ...defaultModel, contextLimit: 65536, outputLimit: 8192 };
const report = {
  schemaVersion: 1,
  model: model.model,
  contextLimit: 65536,
  outputLimit: 8192,
  memory: false,
  root,
  turns: [],
  compactions: [],
  checks: {},
  passed: false,
};
let sessionID;
async function turn(text) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 180000);
  const record = {
    number: report.turns.length + 1,
    characters: text.length,
    tools: 0,
    denied: 0,
    status: "running",
  };
  report.turns.push(record);
  let answer = "";
  try {
    const run = startRuntime(
      {
        repo: root,
        state: path.join(root, ".runtime"),
        directories: [root],
        sessionID,
        model,
        text,
      },
      {
        executable: path.resolve(
          "runtime/opencode/dist/anvil-runtime" +
            (process.platform === "win32" ? ".exe" : ""),
        ),
        key,
        endpoint,
        signal: abort.signal,
        onEvent(event, reply) {
          if (event.type === "session") {
            if (sessionID && sessionID !== event.id)
              throw Error("Session changed");
            sessionID = event.id;
          }
          if (event.type === "text") answer += event.text;
          if (event.type === "activity") record.tools++;
          if (event.type === "compaction")
            report.compactions.push({ ...event, turn: record.number });
          if (event.type === "permission") {
            const allow = allowsFolderOperation(
              event.permission.action,
              event.permission.resources,
              root,
              [root],
            );
            if (!allow) record.denied++;
            reply(event.permission.id, allow);
          }
        },
      },
    );
    const result = await run.done;
    record.status = result.status;
    if (result.status !== "completed")
      throw Error(result.error || result.status);
    return answer;
  } finally {
    clearTimeout(timer);
    await writeFile(
      path.join(output, "summary.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
try {
  await turn(
    "本次隔离测试任务代号 CTX-583。长期约束：不能增加第三方依赖，不得修改 protected.txt，不得提交 Git。最终任务是写 result.json，记录任务代号、禁止增加依赖、禁止提交，并把下一步设为实现 CSV 双引号转义。现在不要写文件，只回复已理解。不要记录长期记忆或创建任何笔记文件，所有信息只留在本次聊天中。",
  );
  for (
    let i = 0;
    i < 6 && !report.compactions.some((e) => e.status === "completed");
    i++
  ) {
    const noise = Array.from({ length: 1200 }, (_, j) =>
      createHash("sha256").update(`fixture:${i}:${j}`).digest("hex"),
    ).join("\n");
    await turn(
      "以下是没有业务含义的合成校验和，作为临时工具输出替身。无需总结或保存，只回复已收到。保留此前任务目标和约束。\n" +
        noise,
    );
  }
  const answer = await turn(
    "现在执行此前约定的最终文件任务。使用文件工具，不使用 shell。字段为 taskCode、allowDependencies、allowCommit、nextStep。完成后简短说明。",
  );
  let result;
  try {
    result = JSON.parse(await readFile(path.join(root, "result.json"), "utf8"));
  } catch {}
  report.checks = {
    automaticCompaction: report.compactions.some(
      (e) => e.status === "completed" && e.reason === "auto",
    ),
    noCompactionFailure: !report.compactions.some((e) => e.status === "failed"),
    taskCode: result?.taskCode === "CTX-583",
    dependencyConstraint: result?.allowDependencies === false,
    commitConstraint: result?.allowCommit === false,
    nextStep:
      /CSV/i.test(result?.nextStep || "") &&
      /引号|quot/i.test(result?.nextStep || ""),
    protectedFile:
      (await readFile(path.join(root, "protected.txt"), "utf8")) ===
      "DO NOT CHANGE\n",
    postCompactionTools: report.turns.at(-1).tools > 0,
  };
  report.passed = Object.values(report.checks).every(Boolean);
} catch (e) {
  report.error = String(e)
    .split(key)
    .join("[REDACTED]")
    .split(endpoint)
    .join("[REDACTED]");
} finally {
  await writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      checks: report.checks,
      compactions: report.compactions,
      report: path.join(output, "summary.json"),
      error: report.error,
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;

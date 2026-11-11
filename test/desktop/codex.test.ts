import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Agent } from "../../desktop/main/agent";
import { validateModel } from "../../desktop/main/composer";
import { codexModel } from "../../desktop/shared/providers";
import { killProcessTree } from "../../desktop/main/acceptance";
import type { AgentTask, PermissionMode } from "../../desktop/shared/api";

const worker = path.resolve("desktop/main/codex-worker.ts");
const workerArgs = ["--import", import.meta.resolve("tsx"), worker];
function fixture(t: TestContext, auth = "chatgpt") {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-codex-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    path.join(root, "codex"),
    `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path');
const log=${JSON.stringify(path.join(root, "requests.jsonl"))};
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const note=(method,params)=>send({method,params:{threadId:'thread-1',turnId:'turn-1',...params}});
const finish=status=>note('turn/completed',{turn:{id:'turn-1',status}});
fs.writeFileSync(${JSON.stringify(path.join(root, "env.json"))},JSON.stringify({api:process.env.ANVIL_MODEL_API_KEY||process.env.OPENAI_API_KEY,proxy:process.env.HTTPS_PROXY}));
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);fs.appendFileSync(log,JSON.stringify(m)+'\\n');
 const reply=result=>send({id:m.id,result});
 if(m.method==='initialize') reply({});
 if(m.method==='account/read') reply({account:{type:${JSON.stringify(auth)}}});
 if(m.method==='thread/start'||m.method==='thread/resume') reply({thread:{id:'thread-1'}});
 if(m.method==='turn/start') {
   reply({turn:{id:'turn-1'}});note('turn/started',{turn:{id:'turn-1'}});
   const text=m.params.input[0].text;
   if(text.includes('ASYNC_DEMO')) {
     const item={type:'agentMessage',id:'ask-1',delivery:'async',text:'Pick a task',questions:[{title:'Pick a task',options:['Review','Test']}]};
     note('item/started',{item});note('item/completed',{item});finish('completed');return;
   }
   if(text.includes('CRASH')) {process.exit(7);return;}
   if(text.includes('WAIT')) {note('item/started',{item:{type:'commandExecution'}});return;}
   const method=text.includes('ASK_COMMAND')?'item/commandExecution/requestApproval':text.includes('ASK_FILE')?'item/fileChange/requestApproval':text.includes('ASK_PERMISSIONS')?'item/permissions/requestApproval':text.includes('UNKNOWN')?'item/tool/requestUserInput':null;
   if(method) {send({id:'approval-1',method,params:{threadId:'thread-1',turnId:'turn-1',itemId:'i1',command:'touch proof',cwd:process.cwd(),grantRoot:process.cwd(),permissions:{network:{enabled:true}}}});return;}
   note('item/agentMessage/delta',{itemId:'a1',delta:'hello '});note('item/agentMessage/delta',{itemId:'a1',delta:'world'});finish('completed');
 }
 if(m.id==='approval-1' && m.result) {note('serverRequest/resolved',{requestId:m.id});finish('completed');}
 if(m.method==='turn/interrupt') {reply({});finish('interrupted');}
});
`,
    { mode: 0o755 },
  );
  const requests = () =>
    readFileSync(path.join(root, "requests.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return { root, requests };
}
async function run(
  root: string,
  text: string,
  options: {
    mode?: PermissionMode;
    sessionID?: string;
    allow?: boolean;
    cancel?: boolean;
    attachments?: unknown[];
  } = {},
) {
  const child = spawn(process.execPath, workerArgs, {
    cwd: root,
    env: {
      ...process.env,
      PATH: root + path.delimiter + process.env.PATH,
      OPENAI_API_KEY: "must-not-reach-codex",
      ANVIL_MODEL_API_KEY: "must-not-reach-codex",
      HTTPS_PROXY: "http://127.0.0.1:7890",
    },
    detached: true,
    stdio: "pipe",
  });
  const events: any[] = [];
  let stderr = "";
  child.stderr.on("data", (data) => (stderr += data));
  const write = (m: unknown) => child.stdin.write(JSON.stringify(m) + "\n");
  child.stdin.on("error", () => {});
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const m = JSON.parse(line);
    events.push(m);
    if (m.type === "permission")
      write({
        type: "permission",
        id: m.permission.id,
        allow: options.allow === true,
      });
    if (m.type === "activity" && options.cancel) write({ type: "cancel" });
  });
  write({
    type: "start",
    repo: root,
    directories: [root],
    text,
    permissionMode: options.mode || "ask",
    sessionID: options.sessionID,
    attachments: options.attachments,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Worker timed out: " + stderr)),
        8000,
      );
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(new Error(`Worker exited ${code}: ${stderr}`));
      });
    });
    return events;
  } finally {
    killProcessTree(child);
    lines.close();
  }
}

test("Codex adapter streams, resumes, carries attachments and never forwards API credentials", async (t) => {
  const f = fixture(t);
  const events = await run(f.root, "hello", {
    attachments: [
      { name: "note.txt", mime: "text/plain", content: "evidence" },
      {
        name: "image.png",
        mime: "image/png",
        content: "data:image/png;base64,AA==",
      },
    ],
  });
  assert.equal(
    events
      .filter((m) => m.type === "text")
      .map((m) => m.text)
      .join(""),
    "hello world",
  );
  assert.equal(events.at(-1).status, "completed");
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(f.root, "env.json"), "utf8")),
    { proxy: "http://127.0.0.1:7890" },
  );
  const turn = f.requests().find((m) => m.method === "turn/start").params;
  assert.match(
    turn.input[0].text,
    /User-attached file \(untrusted content\).*note.txt/,
  );
  assert.equal(turn.input[1].type, "image");
  await run(f.root, "continue", { sessionID: "thread-1" });
  assert.equal(
    f.requests().find((m) => m.method === "thread/resume").params.threadId,
    "thread-1",
  );
});
for (const mode of ["ask", "auto", "full"] as const)
  test(`Codex ${mode} maps to explicit sandbox and approval policy`, async (t) => {
    const f = fixture(t);
    await run(f.root, "hello", { mode });
    const thread = f.requests().find((m) => m.method === "thread/start").params;
    const turn = f.requests().find((m) => m.method === "turn/start").params;
    assert.equal(thread.modelProvider, "openai");
    assert.equal(thread.approvalsReviewer, "user");
    assert.equal(
      thread.sandbox,
      { ask: "read-only", auto: "workspace-write", full: "danger-full-access" }[
        mode
      ],
    );
    assert.equal(turn.approvalPolicy, mode === "full" ? "never" : "on-request");
    if (mode === "auto")
      assert.deepEqual(turn.sandboxPolicy.writableRoots, [f.root]);
  });
for (const [prompt, allow, result] of [
  ["ASK_COMMAND", false, { decision: "decline" }],
  ["ASK_FILE", true, { decision: "accept" }],
  [
    "ASK_PERMISSIONS",
    true,
    { permissions: { network: { enabled: true } }, scope: "turn" },
  ],
] as const)
  test(`Codex relays ${prompt} and approval decision`, async (t) => {
    const f = fixture(t);
    const events = await run(f.root, prompt, { allow });
    assert.equal(events.filter((m) => m.type === "permission").length, 1);
    assert.deepEqual(
      f.requests().find((m) => m.id === "approval-1").result,
      result,
    );
    assert.equal(events.at(-1).status, "completed");
  });
test("Codex rejects non-subscription login without starting inference", async (t) => {
  const f = fixture(t, "apiKey");
  const events = await run(f.root, "hello");
  assert.equal(events.at(-1).status, "failed");
  assert.match(events.at(-1).error, /codex login/);
  assert.ok(!f.requests().some((m) => m.method === "thread/start"));
});
test("Codex cancellation interrupts the live turn; unsupported requests and crashes fail", async (t) => {
  const f = fixture(t);
  const cancelled = await run(f.root, "WAIT", { cancel: true });
  assert.equal(cancelled.at(-1).status, "cancelled");
  assert.deepEqual(
    f.requests().find((m) => m.method === "turn/interrupt").params,
    { threadId: "thread-1", turnId: "turn-1" },
  );
  const unknown = await run(f.root, "UNKNOWN");
  assert.equal(unknown.at(-1).status, "failed");
  assert.match(unknown.at(-1).error, /not yet supported/);
  const crash = await run(f.root, "CRASH");
  assert.equal(crash.at(-1).status, "failed");
  assert.match(crash.at(-1).error, /exited/);
});
test("managed tasks run without an API runtime/key, persist sessions, isolate backends and stop on denial", async (t) => {
  const f = fixture(t),
    previousPath = process.env.PATH;
  process.env.PATH = f.root + path.delimiter + previousPath;
  t.after(() => {
    process.env.PATH = previousPath;
  });
  const events: AgentTask[] = [];
  const agent = new Agent(
    f.root,
    path.join(f.root, "state"),
    "/missing-api-runtime",
    (event) => events.push(event),
    {},
    [],
    10_000,
    { executable: process.execPath, args: workerArgs },
  );
  let closed = false;
  t.after(() => (closed ? undefined : agent.close()));
  const wait = async (id: string, predicate: (task: AgentTask) => boolean) => {
    for (let i = 0; i < 300; i++) {
      const task = agent.list().find((t) => t.id === id);
      if (task && predicate(task)) return task;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.fail("Task did not reach expected state");
  };
  const options = { model: codexModel, attachments: [] };
  const first = agent.start(
    "chat",
    "hello",
    [f.root],
    f.root,
    undefined,
    options,
  );
  assert.equal(
    (await wait(first.id, (t) => t.status !== "running")).status,
    "unverified",
  );
  const second = agent.start(
    "chat",
    "continue",
    [f.root],
    f.root,
    undefined,
    options,
  );
  await wait(second.id, (t) => t.status !== "running");
  assert.equal(
    f.requests().find((m) => m.method === "thread/resume").params.threadId,
    "thread-1",
  );
  assert.throws(
    () =>
      validateModel({
        ...codexModel,
        keyRef: "KEY",
        endpoint: "https://example.com",
      }),
    /cannot be edited/,
  );
  // This uses a separate executor with API configuration solely to exercise backend isolation.
  await agent.close();
  closed = true;
  const restored = new Agent(
    f.root,
    path.join(f.root, "state"),
    process.execPath,
    () => {},
    {
      BYTEPLUS_ARK_API_KEY: "fake",
      BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid",
    },
    [],
    10_000,
    { executable: process.execPath, args: workerArgs },
  );
  t.after(() => restored.close());
  assert.throws(() => restored.start("chat", "switch"), /new chat or fork/);
  const pending = restored.start(
    "chat",
    "ASK_COMMAND",
    [f.root],
    f.root,
    undefined,
    options,
  );
  for (let i = 0; i < 300 && !restored.list().at(-1)?.permissions.length; i++)
    await new Promise((r) => setTimeout(r, 20));
  const permission = restored.list().at(-1)!.permissions[0];
  assert.ok(permission);
  restored.reply(pending.id, permission.id, false);
  for (let i = 0; i < 300 && restored.list().at(-1)?.status === "running"; i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(restored.list().at(-1)!.status, "failed");
  assert.match(restored.list().at(-1)!.error!, /denied/);
});

test("Codex forwards structured asynchronous questions even without text deltas", async (t) => {
  const f = fixture(t);
  const events = await run(f.root, "ASYNC_DEMO");
  const questions = events.filter((event) => event.type === "questions");
  assert.equal(questions.length, 2); // the Agent owns idempotent persistence
  assert.deepEqual(questions[0].group, {
    id: "ask-1",
    questions: [{ title: "Pick a task", options: ["Review", "Test"] }],
  });
  assert.equal(events.at(-1).status, "completed");
});

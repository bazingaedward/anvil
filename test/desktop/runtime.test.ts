import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startRuntime, type RuntimeEvent } from "../../desktop/main/runtime";

async function fixture(
  source: string,
  inspect?: (
    event: RuntimeEvent,
    reply: (id: string, allow: boolean) => void,
  ) => void,
  managed = false,
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-runtime-test-"));
  const script = path.join(root, "worker.cjs");
  writeFileSync(script, source);
  const events: RuntimeEvent[] = [];
  try {
    const run = startRuntime(
      {
        repo: root,
        state: root,
        directories: [],
        text: "hello",
        sessionID: "existing",
        permissionMode: "auto",
      },
      {
        executable: process.execPath,
        args: [script],
        managed,
        managedProxy: managed ? "http://127.0.0.1:7890" : undefined,
        key: "private-key",
        endpoint: "https://example.invalid",
        signal: AbortSignal.timeout(10000),
        onEvent(event, reply) {
          events.push(event);
          inspect?.(event, reply);
        },
      },
    );
    return { result: await run.done, events };
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

test("runtime resumes the supplied session, assembles split frames and accepts only pending permission replies", async () => {
  const { result, events } = await fixture(
    `
const send = x => process.stdout.write(JSON.stringify(x)+'\u005cn');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.type === 'start') {
    process.stdout.write('{"type":"session",');
    setTimeout(() => {
      process.stdout.write('"id":'+JSON.stringify(m.sessionID)+'}\u005cn');
      send({type:'permission',permission:{id:'p',action:'read',resources:['file']}});
    }, 5);
  } else if (m.type === 'permission') {
    if(m.id !== 'p' || !m.allow) process.exit(2);
    send({type:'permission-resolved',id:m.id});
    send({type:'done',status:'completed'});
  }
});`,
    (event, reply) => {
      if (event.type === "permission") {
        reply("unknown", true);
        reply("p", true);
        reply("p", false);
      }
    },
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(
    events.map((e) => e.type),
    ["session", "permission", "permission-resolved"],
  );
  assert.deepEqual(events[0], { type: "session", id: "existing" });
});

test("runtime fails on malformed permission resources instead of approving coerced values", async () => {
  const { result, events } = await fixture(
    `console.log(JSON.stringify({type:'permission',permission:{id:'p',action:'read',resources:[null]}}));process.stdin.resume();`,
  );
  assert.equal(result.status, "failed");
  assert.deepEqual(events, []);
});

test("model timing stays in diagnostics and malformed timing fails validation", async () => {
  const good = await fixture(
    `console.log(JSON.stringify({type:'model-timing',id:'1',phase:'headers',elapsedMs:25,status:200,body:'private'})); console.log(JSON.stringify({type:'done',status:'completed'}));`,
  );
  assert.equal(good.result.status, "completed");
  assert.deepEqual(good.events, []);
  const bad = await fixture(
    `console.log(JSON.stringify({type:'model-timing',id:'1',phase:'headers',elapsedMs:-1})); process.stdin.resume();`,
  );
  assert.equal(bad.result.status, "failed");
});

test("runtime bounds unterminated output and detects exit without a terminal event", async () => {
  const oversized = await fixture(
    `process.stdout.write('x'.repeat(1024*1024+1));process.stdin.resume();`,
  );
  assert.match(oversized.result.error!, /Invalid response/);
  const exited = await fixture(`process.exit(0);`);
  assert.match(exited.result.error!, /before completing/);
});

test("runtime redacts terminal errors and ignores trailing events after completion", async () => {
  const { result, events } = await fixture(
    `console.log(JSON.stringify({type:'done',status:'failed',error:'private-key https://example.invalid'}));console.log(JSON.stringify({type:'text',text:'late'}));`,
  );
  assert.equal(result.error, "[REDACTED] [REDACTED]");
  assert.deepEqual(events, []);
});

test("an already cancelled run never launches a process", async () => {
  const run = startRuntime(
    { repo: "missing", state: "missing", directories: [], text: "test" },
    {
      executable: "missing",
      key: "",
      endpoint: "",
      signal: AbortSignal.abort(),
      onEvent() {
        assert.fail("No events expected");
      },
    },
  );
  assert.equal((await run.done).status, "cancelled");
});

test("managed runtime carries permissions and questions without API credentials", async () => {
  const { result, events } = await fixture(
    `
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if(m.type !== 'start') return;
  if(m.permissionMode !== 'auto' || process.env.ANVIL_MODEL_API_KEY || process.env.ANVIL_MODEL_ENDPOINT || process.env.ELECTRON_RUN_AS_NODE !== '1' || process.env.HTTPS_PROXY !== 'http://127.0.0.1:7890') process.exit(2);
  console.log(JSON.stringify({type:'questions',group:{id:'q1',questions:[{title:'Continue?',options:['Yes']}]}}));
  console.log(JSON.stringify({type:'activity',text:'Checking files'}));
  console.log(JSON.stringify({type:'done',status:'completed'}));
});`,
    undefined,
    true,
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(
    events.map((event) => event.type),
    ["questions", "activity"],
  );
});

test("runtime forwards explicit compaction lifecycle without turning it into answer text", async () => {
  const { result, events } = await fixture(`
const send = x => console.log(JSON.stringify(x));
require('node:readline').createInterface({input:process.stdin}).once('line', () => {
 send({type:'compaction',status:'started',reason:'auto'});
 send({type:'compaction',status:'completed',reason:'auto'});
 send({type:'text',text:'Continued'});
 send({type:'done',status:'completed'});
});`);
  assert.equal(result.status, "completed");
  assert.deepEqual(
    events.filter((e) => e.type === "compaction").map((e) => e.status),
    ["started", "completed"],
  );
  assert.deepEqual(
    events.filter((e) => e.type === "text").map((e) => e.text),
    ["Continued"],
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Agent } from "../../desktop/main/agent";
import { defaultModel } from "../../desktop/main/composer";

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Task did not reach expected state");
}
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-steering-"));
  const script = path.join(root, "worker.cjs");
  writeFileSync(
    script,
    `
const send = m => console.log(JSON.stringify(m));
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.type === 'start') {
    send({ type:'session', id:m.sessionID || 'session-first' });
    send({ type:'text', text:m.sessionID ? 'resumed:' + m.sessionID : 'initial' });
    send({ type:'permission', permission:{ id:'p', action:'read', resources:['proof.txt'] } });
  }
  if (m.type === 'steer') {
    if(m.text.includes('reject')) send({type:'steering',id:m.id,status:'failed',error:'rejected'});
    else if(m.text.includes('exit')) {send({type:'done',status:'completed'});process.exit(0);}
    else {
      send({type:'steering',id:m.id,status:'delivered'});
      send({type:'steering',id:m.id,status:'accepted'});
      send({type:'text',text:' steered:' + m.text + ':' + (m.attachments[0]?.content || '')});
    }
  }
  if(m.type === 'permission') {send({type:'done',status:'completed'});process.exit(0);}
  if(m.type === 'cancel') {send({type:'done',status:'cancelled'});process.exit(0);}
});`,
  );
  const create = () =>
    new Agent(
      root,
      path.join(root, "state"),
      process.execPath,
      () => {},
      {
        BYTEPLUS_ARK_API_KEY: "test-key",
        BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid/responses",
      },
      [script],
    );
  const agent = create();
  return {
    agent,
    create,
    root,
    async close() {
      await agent.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const options = {
  model: defaultModel,
  attachments: [],
  delivery: "queue" as const,
};

test("steering reaches the active runtime without a second task, with receipt, attachments and persistent history", async () => {
  const f = fixture();
  try {
    const first = f.agent.start("chat", "initial");
    await until(() => f.agent.list()[0].permissions.length === 1);
    await f.agent.steer(first.id, "change direction", [
      {
        id: "f",
        name: "note.txt",
        mime: "text/plain",
        size: 4,
        content: "NOTE",
      },
    ]);
    await until(() => f.agent.list()[0].text.includes("NOTE"));
    assert.equal(f.agent.list().length, 1);
    const message = f.agent.list()[0].steering![0];
    assert.equal(
      message.status,
      "delivered",
      "late acceptance must not downgrade delivery",
    );
    assert.equal(message.offset, "initial".length);
    assert.equal("content" in message.attachments![0], false);
    await assert.rejects(f.agent.steer(first.id, "reject"), /rejected/);
    assert.equal(
      f.agent.list()[0].status,
      "running",
      "a rejected steer must not kill the task",
    );
    f.agent.reply(first.id, "p", true);
    await until(() => f.agent.list()[0].status === "unverified");
    const restored = f.create();
    assert.equal(restored.list()[0].steering![0].status, "delivered");
    await restored.close();
  } finally {
    await f.close();
  }
});

test("queue waits, resumes the latest session, and can cancel individual entries or all on stop", async () => {
  const f = fixture();
  try {
    const first = f.agent.start("chat", "initial");
    const second = f.agent.start(
      "chat",
      "second",
      [],
      undefined,
      undefined,
      options,
    );
    const third = f.agent.start(
      "chat",
      "third",
      [],
      undefined,
      undefined,
      options,
    );
    assert.equal(second.status, "queued");
    assert.equal(second.startedAt, undefined);
    f.agent.cancel(third.id);
    await until(() => f.agent.list()[0].permissions.length === 1);
    f.agent.reply(first.id, "p", true);
    await until(() => f.agent.list()[1].permissions.length === 1);
    assert.equal(f.agent.list()[1].text, "resumed:session-first");
    assert.equal(f.agent.list()[2].status, "cancelled");
    const fourth = f.agent.start(
      "chat",
      "fourth",
      [],
      undefined,
      undefined,
      options,
    );
    f.agent.cancel(second.id);
    await until(() => f.agent.list()[1].status === "cancelled");
    assert.equal(
      f.agent.list().find((task) => task.id === fourth.id)?.status,
      "cancelled",
    );
  } finally {
    await f.close();
  }
});

test("unacknowledged steering rejects on exit and queued work is cancelled on restart", async () => {
  const f = fixture();
  try {
    const first = f.agent.start("chat", "initial");
    const queued = f.agent.start(
      "chat",
      "queued",
      [],
      undefined,
      undefined,
      options,
    );
    const restored = f.create();
    assert.equal(
      restored.list().find((task) => task.id === queued.id)?.status,
      "cancelled",
    );
    await restored.close();
    f.agent.cancel(queued.id);
    await assert.rejects(f.agent.steer(first.id, "exit"), /无法确认/);
    await until(() => f.agent.list()[0].status === "unverified");
    assert.equal(f.agent.list()[0].steering![0].status, "failed");
  } finally {
    await f.close();
  }
});

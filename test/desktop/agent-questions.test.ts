import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Agent } from "../../desktop/main/agent";
import { codexModel } from "../../desktop/shared/providers";
import {
  parseQuestionGroup,
  validateQuestionAnswers,
} from "../../desktop/main/agent-questions";

const questions = [
  { title: "What next?", options: ["Review", "Test"] },
  { title: "Any details?" },
];
const wait = async (agent: Agent) => {
  for (let i = 0; i < 300; i++) {
    const last = agent.list().at(-1);
    if (last && last.status !== "running") return last;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("Task timed out");
};
test("question validation rejects malformed content and incomplete replies; custom answers are supported", () => {
  const group = parseQuestionGroup("q1", questions);
  assert.deepEqual(
    validateQuestionAnswers(group, ["Something else", " details "]),
    ["Something else", "details"],
  );
  for (const value of [
    null,
    [],
    [{ title: "" }],
    [{ title: "x", options: [{}] }],
    Array(11).fill({ title: "x" }),
  ])
    assert.throws(() => parseQuestionGroup("q1", value), /Invalid agent/);
  for (const value of [
    null,
    [],
    ["Review"],
    ["Review", " "],
    ["Review", "x".repeat(4001)],
  ])
    assert.throws(
      () => validateQuestionAnswers(group, value),
      /Answer every question/,
    );
  assert.equal("answer" in parseQuestionGroup("q1", questions), false);
});
test("async questions survive completion/restart, deduplicate events, resume the same thread and reject stale replies", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-questions-"));
  const script = path.join(root, "worker.cjs");
  writeFileSync(
    script,
    `const fs=require('node:fs');const send=m=>console.log(JSON.stringify(m));
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.type==='cancel')process.exit(0);if(m.type!=='start')return;
 fs.appendFileSync(${JSON.stringify(path.join(root, "requests.jsonl"))},JSON.stringify(m)+'\\n');
 send({type:'session',id:m.sessionID||'native-thread'});
 if(m.text==='demo'||m.text==='waiting'){
  const message={type:'questions',group:{id:'ask-1',questions:${JSON.stringify(questions)}}};send(message);send(message);
  send({type:'text',text:'Please answer these questions.'});
 }else send({type:'text',text:'Thanks for the answer.'});
 if(m.text!=='waiting'){send({type:'done',status:'completed'});process.exit(0);}
});`,
  );
  const make = () =>
    new Agent(
      root,
      path.join(root, "state"),
      "/unused",
      () => {},
      {},
      [],
      10000,
      { executable: process.execPath, args: [script] },
    );
  let agent = make();
  t.after(async () => {
    await agent.close();
    rmSync(root, { recursive: true, force: true });
  });
  const start = (chat: string, text: string) =>
    agent.start(chat, text, [], root, undefined, {
      model: codexModel,
      attachments: [],
    });
  const first = start("chat", "demo");
  await wait(agent);
  assert.equal(agent.list()[0].questions?.length, 1);
  assert.equal(agent.list()[0].questions?.[0].answer, undefined);
  await agent.close();
  agent = make();
  assert.equal(agent.list()[0].questions?.[0].questions.length, 2);
  assert.throws(
    () => agent.answerQuestions(first.id, "wrong", ["Review", "Details"]),
    /no longer available/,
  );
  assert.throws(
    () => agent.answerQuestions(first.id, "ask-1", ["Review", ""]),
    /Answer every/,
  );
  agent.updateConversation("chat", { archived: true });
  assert.throws(
    () => agent.answerQuestions(first.id, "ask-1", ["Review", "Details"]),
    /archived/,
  );
  agent.updateConversation("chat", { archived: false });
  const reply = agent.answerQuestions(first.id, "ask-1", [
    "Something else",
    "Details",
  ]);
  assert.throws(
    () => agent.answerQuestions(first.id, "ask-1", ["Test", "Again"]),
    /already been answered/,
  );
  await wait(agent);
  const requests = readFileSync(path.join(root, "requests.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(requests[1].sessionID, "native-thread");
  assert.match(requests[1].text, /What next\?\nSomething else/);
  assert.match(requests[1].text, /asynchronous question/);
  assert.equal(agent.list()[0].questions?.[0].answer?.taskID, reply.id);
  await agent.close();
  agent = make();
  assert.deepEqual(agent.list()[0].questions?.[0].answer?.values, [
    "Something else",
    "Details",
  ]);
  assert.throws(
    () => agent.answerQuestions(first.id, "ask-1", ["Review", "Again"]),
    /already been answered/,
  );
  const fork = agent.forkConversation(first.id);
  const copied = agent.list().find((task) => task.conversationID === fork.id)!;
  assert.equal(copied.questions?.[0].readOnly, true);
  assert.throws(
    () => agent.answerQuestions(copied.id, "ask-1", ["Review", "Details"]),
    /no longer available/,
  );
  const pending = start("live", "waiting");
  for (let i = 0; i < 300 && !agent.list().at(-1)?.questions?.length; i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.throws(
    () => agent.answerQuestions(pending.id, "ask-1", ["Review", "Details"]),
    /current task/,
  );
  agent.cancel(pending.id);
  await wait(agent);
  await agent.deleteConversation("live");
  assert.throws(
    () => agent.answerQuestions(pending.id, "ask-1", ["Review", "Details"]),
    /no longer available/,
  );
});

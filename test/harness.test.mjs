import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgent } from "../src/agent.mjs";
import { createTools } from "../src/tools.mjs";
import { commandPassed, runProcess } from "../src/process.mjs";
import { createOpenAIProvider } from "../src/openai.mjs";

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "anvil-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "sum.mjs"), "// existing user note\nexport const sum = (a, b) => a - b;\n");
  return { root, tools: await createTools({ root, approve: async () => true, ...options }) };
}
const reply = (text = "", calls = []) => ({ text, calls });
const call = (name, args) => ({ id: name, name, arguments: args });

test("A real failing check feeds back into file repair and a passing check", async (t) => {
  const { root, tools } = await fixture(t);
  await writeFile(path.join(root, "sum.test.mjs"), "import assert from 'node:assert/strict';\nimport { sum } from './sum.mjs';\nassert.equal(sum(2, 3), 5);\n");
  let step = 0;
  const provider = { async next({ messages }) {
    step++;
    if (step === 1) return reply("", [call("read_file", { path: "sum.mjs" })]);
    if (step === 2) return reply("Ready for validation.");
    if (step === 3) {
      assert.match(messages.at(-1).content, /acceptance check failed/);
      assert.match(messages.at(-1).content, /AssertionError/);
      return reply("", [call("edit_file", { path: "sum.mjs", old_text: "a - b", new_text: "a + b" })]);
    }
    return reply("Fixed addition; preserved the existing note.");
  } };
  const result = await runAgent({ task: "Fix sum", provider, tools,
    verify: (signal) => runProcess(process.execPath, ["--test", "sum.test.mjs"], { cwd: root, signal }),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.turns, 4);
  assert.deepEqual(result.files, ["sum.mjs"]);
  assert.equal(result.check.exitCode, 0);
  assert.equal(await readFile(path.join(root, "sum.mjs"), "utf8"), "// existing user note\nexport const sum = (a, b) => a + b;\n");
});

test("File tools reject unread, ambiguous, stale, and concurrent edits", async (t) => {
  const { root, tools } = await fixture(t);
  const edit = { path: "sum.mjs", old_text: "a - b", new_text: "a + b" };
  assert.match((await tools.execute("edit_file", edit)).error, /Read the current file/);
  await tools.execute("read_file", { path: "sum.mjs" });
  assert.match((await tools.execute("edit_file", { ...edit, old_text: " " })).error, /exactly once/);
  await writeFile(path.join(root, "sum.mjs"), "external change");
  assert.match((await tools.execute("edit_file", edit)).error, /Read the current file/);
  const concurrent = await createTools({ root, approve: async () => {
    await writeFile(path.join(root, "sum.mjs"), "changed during approval");
    return true;
  } });
  await concurrent.execute("read_file", { path: "sum.mjs" });
  assert.match((await concurrent.execute("edit_file", { ...edit, old_text: "external change" })).error, /changed during approval/);
  assert.equal(await readFile(path.join(root, "sum.mjs"), "utf8"), "changed during approval");
});

test("File tools reject traversal, symlinks, secrets, and invalid tool arguments", async (t) => {
  const { root, tools } = await fixture(t);
  await symlink(path.join(root, "sum.mjs"), path.join(root, "link.mjs"));
  for (const file of ["../outside", "/etc/passwd", "link.mjs", ".git/config", ".env", ".anvil/host.json"]) {
    assert.ok((await tools.execute("read_file", { path: file })).error, file);
  }
  assert.ok((await tools.execute("read_file", { path: "sum.mjs", extra: "invalid" })).error);
  assert.ok((await tools.execute("read_file", null)).error);
  assert.ok((await tools.execute("missing", {})).error);
});

test("Creation is exclusive and denied edits do not run", async (t) => {
  const { root, tools } = await fixture(t);
  assert.ok((await tools.execute("create_file", { path: "sum.mjs", content: "overwrite" })).error);
  assert.deepEqual(await tools.execute("create_file", { path: "new.txt", content: "new" }), { edited: "new.txt" });
  const denied = await createTools({ root });
  await denied.execute("read_file", { path: "sum.mjs" });
  assert.deepEqual(await denied.execute("edit_file", { path: "sum.mjs", old_text: "a - b", new_text: "a + b" }), { denied: true });
  assert.match(await readFile(path.join(root, "sum.mjs"), "utf8"), /a - b/);
  assert.deepEqual(await denied.execute("run_command", { command: "touch should-not-exist" }), { denied: true });
  await assert.rejects(readFile(path.join(root, "should-not-exist")), { code: "ENOENT" });
});

test("Completion is unverified without a check, bounded on failure, and stopped on denial", async (t) => {
  const { tools } = await fixture(t, { approve: async () => false });
  const provider = { next: async () => reply("Done") };
  assert.equal((await runAgent({ task: "Review", provider, tools })).status, "unverified");
  const exhausted = await runAgent({ task: "Fix", provider, tools, maxTurns: 2,
    verify: async () => ({ exitCode: 1, output: "still failing" }) });
  assert.equal(exhausted.status, "limit");
  assert.equal(exhausted.turns, 2);
  const denied = await runAgent({ task: "Create", tools, provider: {
    next: async () => reply("", [call("create_file", { path: "new.txt", content: "no" })]),
  } });
  assert.equal(denied.status, "blocked");
  assert.equal(denied.turns, 1);
  assert.equal((await runAgent({ task: "Long", tools, provider, maxContext: 1 })).status, "limit");
});

test("Commands bound output and time, support cancellation, and do not inherit credentials", async (t) => {
  const { root } = await fixture(t);
  const timeout = await runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: root, timeoutMs: 100 });
  assert.equal(timeout.timedOut, true);
  assert.equal(commandPassed(timeout), false);
  const large = await runProcess(process.execPath, ["-e", "console.log('x'.repeat(10000))"], { cwd: root, maxOutput: 100 });
  assert.equal(large.truncated, true);
  assert.equal(large.output.length, 100);
  assert.equal(commandPassed(large), false);
  const controller = new AbortController();
  const pending = runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: root, signal: controller.signal });
  controller.abort();
  assert.equal((await pending).cancelled, true);
  process.env.ANVIL_TEST_CREDENTIAL = "test-only-value";
  try {
    const clean = await runProcess(process.execPath, ["-e", "console.log(process.env.ANVIL_TEST_CREDENTIAL === undefined)"], { cwd: root });
    assert.equal(clean.output.trim(), "true");
  } finally { delete process.env.ANVIL_TEST_CREDENTIAL; }
});

test("Search respects ignores and finds source text", async (t) => {
  const { root, tools } = await fixture(t);
  await writeFile(path.join(root, ".env"), "HIDDEN_SENTINEL=yes");
  const files = await tools.execute("list_files", {});
  assert.equal(files.exitCode, 0);
  assert.match(files.output, /sum.mjs/);
  assert.doesNotMatch(files.output, /\.env/);
  assert.match((await tools.execute("search", { query: "existing user note" })).output, /sum.mjs:1:/);
  assert.equal((await tools.execute("search", { query: "HIDDEN_SENTINEL" })).exitCode, 1);
});

test("OpenAI adapter preserves reasoning and tool-call IDs across turns", async () => {
  const reasoning = { type: "reasoning", id: "rs_test", summary: [], encrypted_content: "opaque-fixture" };
  const item = { type: "function_call", id: "fc_test", call_id: "call_test", name: "list_files", arguments: "{}", status: "completed" };
  let count = 0;
  const provider = createOpenAIProvider({ apiKey: "test-only", model: "fixture-model", fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
    if (count++ === 0) return Response.json({ status: "completed", output: [reasoning, item] });
    assert.deepEqual(body.input.slice(1, 3), [reasoning, item]);
    assert.deepEqual(body.input.at(-1), { type: "function_call_output", call_id: "call_test", output: "files" });
    return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Finished" }] }] });
  } });
  const messages = [{ role: "user", content: "Test" }];
  const first = await provider.next({ instructions: "Test", messages, tools: [] });
  assert.deepEqual(first.calls, [{ id: "call_test", name: "list_files", arguments: {} }]);
  messages.push({ role: "assistant", ...first }, { role: "tool", callId: "call_test", content: "files" });
  assert.equal((await provider.next({ instructions: "Test", messages, tools: [] })).text, "Finished");
});

test("Incomplete API responses and network errors never count as success", async (t) => {
  const { tools } = await fixture(t);
  const provider = createOpenAIProvider({ apiKey: "test-only", model: "fixture-model", fetchImpl: async () => Response.json({ status: "incomplete", output: [] }) });
  assert.equal((await runAgent({ task: "Test", provider, tools })).status, "failed");
  const result = await runAgent({ task: "Test", tools, provider: { next: async () => { throw new Error("private-value-must-not-appear"); } } });
  assert.equal(result.status, "failed");
  assert.doesNotMatch(JSON.stringify(result), /private-value-must-not-appear/);
});

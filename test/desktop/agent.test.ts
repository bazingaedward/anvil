import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Agent } from "../../desktop/main/agent";
import type { AgentTask } from "../../desktop/shared/api";

test("agent owns task state, validates permission replies, and persists only public history", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-agent-"));
  const script = path.join(root, "child.cjs");
  writeFileSync(
    script,
    `const readline=require('node:readline');const send=x=>console.log(JSON.stringify(x));readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='start'){send({type:'session',id:'ses-test'});send({type:'text',text:'hello'});send({type:'permission',permission:{id:'p1',action:'read',resources:['proof.txt']}});}if(m.type==='permission'){send({type:'permission-resolved',id:m.id});send({type:'done',status:'completed'});process.exit(0);}if(m.type==='cancel')process.exit(0);});`,
  );
  const events: AgentTask[] = [];
  const credentials = {
    BYTEPLUS_ARK_API_KEY: "test-secret",
    BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid/responses",
  };
  const agent = new Agent(
    root,
    path.join(root, "state"),
    process.execPath,
    (t) => events.push(t),
    credentials,
    [script],
  );
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("Timed out");
  };
  try {
    const task = agent.start("chat", "Read proof");
    assert.throws(() => agent.start("chat", "other"), /current task/);
    await until(() => events.some((t) => t.permissions.length === 1));
    assert.throws(
      () => agent.reply(task.id, "wrong", true),
      /no longer pending/,
    );
    agent.reply(task.id, "p1", true);
    await until(() => events.some((t) => t.status === "unverified"));
    assert.equal(agent.list()[0].text, "hello");
    assert.equal("sessionID" in agent.list()[0], false);
    assert.equal(agent.list()[0].permissions.length, 0);
    const restored = new Agent(
      path.join(root, "another-directory"),
      path.join(root, "state"),
      process.execPath,
      () => {},
      credentials,
      [script],
    );
    assert.equal(restored.list()[0].status, "unverified");
    assert.ok(!JSON.stringify(restored.list()).includes("test-secret"));
    await restored.close();
  } finally {
    await agent.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing credentials do not create a misleading running task", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-agent-"));
  try {
    const agent = new Agent(root, root, process.execPath, () => {}, {});
    assert.throws(() => agent.start("chat", "hello"), /keygrant/);
    assert.deepEqual(agent.list(), []);
    await agent.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("folderless conversations keep their own cwd and resume across folder changes and restarts", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-folderless-"));
  const script = path.join(root, "child.cjs");
  writeFileSync(
    script,
    `const send=x=>console.log(JSON.stringify(x));
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);
  if(m.type==='start'){
    send({type:'session',id:m.sessionID||'folderless-session'});
    send({type:'text',text:JSON.stringify({cwd:process.cwd(),folders:m.directories,previous:m.sessionID||null})});
    if(m.text==='read') send({type:'permission',permission:{id:'read',action:'read',resources:['file.txt']}});
    else {send({type:'done',status:'completed'});process.exit(0);}
  }
  if(m.type==='permission'){send({type:'done',status:'completed'});process.exit(0);}
});`,
  );
  const storage = path.join(root, "state");
  const create = () =>
    new Agent(
      root,
      storage,
      process.execPath,
      () => {},
      {
        BYTEPLUS_ARK_API_KEY: "test-key",
        BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid/responses",
      },
      [script],
    );
  let agent = create();
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("Timed out waiting for folderless task");
  };
  const run = async (id: string, folders: string[]) => {
    const task = agent.start(id, "hello", folders, folders[0]);
    await until(
      () =>
        agent.list().find((item) => item.id === task.id)?.status !== "running",
    );
    const finished = agent.list().find((item) => item.id === task.id)!;
    assert.equal(finished.status, "unverified");
    return JSON.parse(finished.text);
  };
  try {
    const chat = agent.createConversation();
    const first = await run(chat.id, []);
    assert.deepEqual(first.folders, []);
    assert.equal(first.previous, null);
    assert.notEqual(first.cwd, root);
    assert.equal(path.basename(path.dirname(first.cwd)), "workspaces");
    assert.deepEqual(
      agent.conversations().conversations.find((item) => item.id === chat.id)
        ?.folders,
      [],
    );

    // Even reads in the internal cwd are not implicitly authorized.
    agent.setPermissionMode(chat.id, "auto");
    const read = agent.start(chat.id, "read", []);
    await until(
      () =>
        agent.list().find((item) => item.id === read.id)?.permissions.length ===
        1,
    );
    agent.reply(read.id, "read", true);
    await until(
      () =>
        agent.list().find((item) => item.id === read.id)?.status ===
        "unverified",
    );

    agent.grantFolders(chat.id, [root]);
    const attached = await run(chat.id, [root]);
    assert.equal(attached.previous, "folderless-session");
    assert.deepEqual(attached.folders, [root]);
    assert.notEqual(attached.cwd, first.cwd);
    assert.throws(
      () => agent.start(chat.id, "hello", [root], storage),
      /authorized working directory/,
    );

    await agent.revokeFolder(chat.id, root);
    const detached = await run(chat.id, []);
    assert.equal(detached.cwd, first.cwd);
    assert.equal(detached.previous, "folderless-session");
    assert.deepEqual(detached.folders, []);
    await agent.close();
    agent = create();
    const restored = await run(chat.id, []);
    assert.equal(restored.cwd, first.cwd);
    assert.equal(restored.previous, "folderless-session");
    const other = await run(agent.createConversation().id, []);
    assert.notEqual(other.cwd, first.cwd);
    assert.equal(other.previous, null);
  } finally {
    await agent.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unresponsive runtime is cancelled and cannot overwrite the final state on exit", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-agent-cancel-"));
  const script = path.join(root, "hang.cjs");
  writeFileSync(script, "process.stdin.resume();setInterval(()=>{},1000);");
  const agent = new Agent(
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
  try {
    const task = agent.start("chat", "Wait");
    agent.cancel(task.id);
    await new Promise((resolve) => setTimeout(resolve, 5500));
    assert.equal(agent.list()[0].status, "cancelled");
    assert.equal(agent.list()[0].permissions.length, 0);
  } finally {
    await agent.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(root, { recursive: true, force: true });
  }
});

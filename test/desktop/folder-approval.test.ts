import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Agent } from "../../desktop/main/agent";

test("runtime requests use conversation grants and revocation stops the active task", async () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "anvil-approval-")),
  );
  const script = path.join(root, "worker.cjs");
  writeFileSync(
    script,
    `const send=x=>console.log(JSON.stringify(x));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='start')send({type:'permission',permission:{id:'read',action:'read',resources:['file.txt']}});if(m.type==='permission'&&m.id==='read'){if(!m.allow)process.exit(1);send({type:'text',text:'auto-approved'});send({type:'permission',permission:{id:'outside',action:'edit',resources:['../outside.txt']}});}if(m.type==='cancel')process.exit(0);});`,
  );
  const agent = new Agent(
    root,
    path.join(root, "state"),
    process.execPath,
    () => {},
    {
      BYTEPLUS_ARK_API_KEY: "fixture",
      BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid",
    },
    [script],
  );
  try {
    const chat = agent.createConversation();
    agent.grantFolders(chat.id, [root]);
    agent.start(chat.id, "Read");
    for (let i = 0; i < 150 && !agent.list()[0].permissions.length; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(agent.list()[0].text, "auto-approved");
    assert.equal(agent.list()[0].permissions[0]?.id, "outside");
    await agent.revokeFolder(chat.id, root);
    assert.equal(agent.list()[0].status, "cancelled");
    assert.deepEqual(agent.conversations().conversations[0].folders, []);
    agent.start(chat.id, "Read again");
    for (let i = 0; i < 150 && !agent.list()[1].permissions.length; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(agent.list()[1].permissions[0]?.id, "read");
  } finally {
    await agent.close();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const mode of ["ask", "auto", "full"] as const)
  test(`runtime enforces ${mode} mode`, async () => {
    const root = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "anvil-mode-worker-")),
    );
    const script = path.join(root, "worker.cjs");
    writeFileSync(
      script,
      `const send=x=>console.log(JSON.stringify(x));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='start')send({type:'permission',permission:{id:'edit',action:'edit',resources:['file.txt']}});if(m.type==='permission'&&m.id==='edit')send({type:'permission',permission:{id:'shell',action:'shell',resources:['echo test']}});if(m.type==='permission'&&m.id==='shell'){send({type:'text',text:'all-approved'});send({type:'done',status:'completed'});process.exit(0);}if(m.type==='cancel')process.exit(0);});`,
    );
    const agent = new Agent(
      root,
      path.join(root, "state"),
      process.execPath,
      () => {},
      {
        BYTEPLUS_ARK_API_KEY: "fixture",
        BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid",
      },
      [script],
    );
    try {
      const chat = agent.createConversation();
      agent.grantFolders(chat.id, [root]);
      agent.setPermissionMode(chat.id, mode);
      agent.start(chat.id, "Test");
      assert.throws(() => agent.setPermissionMode(chat.id, "ask"), /Stop/);
      for (
        let i = 0;
        i < 150 &&
        !agent.list()[0].permissions.length &&
        agent.list()[0].status === "running";
        i++
      )
        await new Promise((r) => setTimeout(r, 20));
      const result = agent.list()[0];
      if (mode === "full") {
        assert.equal(result.text, "all-approved");
        assert.equal(result.status, "unverified");
      } else
        assert.equal(
          result.permissions[0]?.id,
          mode === "ask" ? "edit" : "shell",
        );
    } finally {
      await agent.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

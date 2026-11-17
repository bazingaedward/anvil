import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ComposerStore,
  defaultModel,
  validateModel,
} from "../../desktop/main/composer";
import { Agent } from "../../desktop/main/agent";
import { ConversationStore } from "../../desktop/main/conversations";
test("model profiles and attachment snapshots persist; reject unsafe endpoints, paths and unsupported content", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-composer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ComposerStore(root);
  const profile = {
    ...defaultModel,
    id: "custom",
    model: "custom-model",
    endpoint: "https://example.invalid/v1/responses",
    keyRef: "CUSTOM_KEY",
    vision: true,
  };
  store.put(profile);
  assert.deepEqual(new ComposerStore(root).model("custom"), profile);
  const file = store.attach("example.ts", Buffer.from("const answer = 42;"));
  assert.equal(
    new ComposerStore(root).attachments([file.id])[0].content,
    "const answer = 42;",
  );
  assert.equal("content" in file, false);
  const image = store.attach(
    "image.png",
    Buffer.from("89504e470d0a1a0a", "hex"),
  );
  assert.equal(image.mime, "image/png");
  assert.match(
    store.attachments([image.id])[0].content,
    /^data:image\/png;base64,/,
  );
  assert.equal(store.imagePreview(image.id), store.attachments([image.id])[0].content);
  assert.throws(() => store.imagePreview(file.id), /not a previewable image/);
  assert.throws(() => store.imagePreview("../../secret"), /valid attachments/);
  assert.throws(() => new ComposerStore(path.join(root, "other-account")).imagePreview(image.id), /ENOENT/);
  assert.throws(() => store.attachments(["../../secret"]), /valid attachments/);
  assert.throws(() => store.attach("x", Buffer.from([0, 1])), /UTF-8/);
  assert.throws(() => store.attach("x", Buffer.from([255, 255])), /UTF-8/);
  assert.throws(
    () => store.attach("file.pdf", Buffer.from("%PDF-1.4")),
    /not supported/,
  );
  assert.throws(
    () => store.attach("x", Buffer.alloc(5 * 1024 * 1024 + 1)),
    /5 MB/,
  );
  assert.throws(() => store.attachments(Array(9).fill(file.id)), /eight/);
  for (const endpoint of [
    "http://example.invalid/responses",
    "https://user:key@example.invalid/responses",
    "https://example.invalid/responses?key=x",
  ])
    assert.throws(() => validateModel({ ...profile, endpoint }));
  assert.throws(() => validateModel({ ...profile, keyRef: "plaintext-key" }));
});
test("agent sends chosen model and snapshots, resumes session, records metadata without secrets or attachment bodies", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-model-"));
  const script = path.join(root, "worker.cjs");
  writeFileSync(
    script,
    `require('node:readline').createInterface({input:process.stdin}).on('line', line => { const m=JSON.parse(line); if(m.type==='start') { console.log(JSON.stringify({type:'session',id:m.sessionID||'same-session'})); console.log(JSON.stringify({type:'text',text:JSON.stringify({folders:m.directories,model:m.model.model,content:m.attachments?.[0]?.content,previous:m.sessionID,leaked:!!process.env.OTHER_KEY})})); console.log(JSON.stringify({type:'done',status:'completed'})); process.exit(0); }});`,
  );
  const agent = new Agent(
    root,
    path.join(root, "state"),
    process.execPath,
    () => {},
    {
      CUSTOM_KEY: "secret-test",
      OTHER_KEY: "other-test",
      BYTEPLUS_ARK_RESPONSES_URL: "https://example.invalid/responses",
    },
    [script],
  );
  t.after(async () => {
    await agent.close();
    rmSync(root, { recursive: true, force: true });
  });
  const model = {
    ...defaultModel,
    id: "custom",
    model: "selected-model",
    keyRef: "CUSTOM_KEY",
  };
  const attachment = {
    id: "file",
    name: "file.txt",
    mime: "text/plain",
    size: 5,
    content: "hello",
  };
  async function finished() {
    for (let i = 0; i < 100; i++) {
      if (agent.list().every((task) => task.status !== "running")) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.fail("Task timed out");
  }
  agent.start("chat", "", [], root, undefined, {
    model,
    attachments: [attachment],
  });
  await finished();
  assert.deepEqual(JSON.parse(agent.list()[0].text), {
    model: "selected-model",
    folders: [],
    content: "hello",
    leaked: false,
  });
  assert.equal(agent.list()[0].model?.model, "selected-model");
  assert.equal("content" in agent.list()[0].attachments![0], false);
  assert.deepEqual(agent.list()[0].folders, []);
  const folders = [root, path.dirname(root)];
  agent.grantFolders("chat", folders);
  agent.start("chat", "continue", folders, root, undefined, {
    model: { ...model, model: "another-model" },
    attachments: [],
  });
  folders.length = 0;
  await finished();
  agent.revokeFolder("chat", root);
  const expectedFolders = [root, path.dirname(root)];
  assert.deepEqual(JSON.parse(agent.list()[1].text).folders, expectedFolders);
  assert.deepEqual(agent.list()[1].folders, expectedFolders);
  assert.deepEqual(agent.list()[0].folders, []);
  const persisted = new ConversationStore(path.join(root, "state"));
  try { assert.deepEqual(persisted.tasks()[1].folders, expectedFolders); }
  finally { persisted.close(); }
  assert.equal(JSON.parse(agent.list()[1].text).previous, "same-session");
  assert.equal(JSON.parse(agent.list()[1].text).model, "another-model");
  assert.ok(!JSON.stringify(agent.list()).includes("secret-test"));
  assert.throws(
    () =>
      agent.start("image", "look", [], root, undefined, {
        model,
        attachments: [{ ...attachment, mime: "image/png" }],
      }),
    /does not support images/,
  );
});

test("Copilot OAuth profiles cannot route credentials through custom API endpoints", () => {
  const model = {
    ...defaultModel,
    id: "copilot-test",
    connection: "copilot" as const,
    endpoint: "https://api.githubcopilot.com",
    keyRef: "ANVIL_COPILOT_OAUTH",
  };
  assert.equal(validateModel(model).connection, "copilot");
  assert.throws(
    () => validateModel({ ...model, endpoint: "https://example.invalid" }),
    /Copilot/,
  );
  assert.throws(
    () => validateModel({ ...model, connection: undefined }),
    /Copilot/,
  );
  assert.throws(
    () => validateModel({ ...model, keyRef: "OTHER_KEY" }),
    /Copilot/,
  );
});

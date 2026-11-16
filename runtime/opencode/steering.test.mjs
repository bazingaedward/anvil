import { test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
test("OpenCode 2.0 delivers steering into the current session model context", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "anvil-native-steer-"));
  const preload = path.join(root, "preload.mjs");
  writeFileSync(
    preload,
    `const original=globalThis.fetch;globalThis.fetch=async (input,init)=>{
const url=typeof input==='string'?input:input.url||String(input);
if(!url.startsWith('https://steering.invalid/')) return original(input,init);
const body=typeof init?.body==='string'?init.body:init?.body?new TextDecoder().decode(init.body):await input.text();
const steered=body.includes('STEERING_EVIDENCE');
const encoder=new TextEncoder();
return new Response(new ReadableStream({start(controller){
const send=(delta,finish_reason=null)=>controller.enqueue(encoder.encode('data: '+JSON.stringify({id:'chatcmpl-1',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta,finish_reason}]})+'\\n\\n'));
send({role:'assistant',content:steered?'STEERED_SUCCESS':'INITIAL_REPLY'});
setTimeout(()=>{send({},'stop');controller.enqueue(encoder.encode('data: [DONE]\\n\\n'));controller.close();},300);
}}),{headers:{'Content-Type':'text/event-stream'}});
};`,
  );
  const child = spawn(
    process.execPath,
    [
      "--preload",
      preload,
      fileURLToPath(new URL("./worker.mjs", import.meta.url)),
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: root,
        TMPDIR: root,
        ANVIL_MODEL_API_KEY: "fake",
        ANVIL_MODEL_ENDPOINT: "https://steering.invalid/v1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let steered = false,
    delivered = false,
    text = "",
    done;
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
  }, 15000);
  const write = (x) => child.stdin.write(JSON.stringify(x) + "\n");
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const event = JSON.parse(line);
      if (
        event.type === "model-timing" &&
        event.phase === "started" &&
        !steered
      ) {
        steered = true;
        write({
          type: "steer",
          id: "msg_test_steering",
          text: "STEERING_EVIDENCE",
          attachments: [],
        });
      }
      if (event.type === "steering") {
        if (event.status === "delivered") delivered = true;
      }
      if (event.type === "text") text += event.text;
      if (event.type === "done") {
        done = event;
        child.stdin.end();
      }
    } catch {}
  });
  child.stderr.resume();
  write({
    type: "start",
    repo: root,
    state: path.join(root, "state"),
    directories: [],
    text: "Reply briefly",
    model: {
      id: "test",
      model: "test-model",
      protocol: "chat-completions",
      endpoint: "https://steering.invalid/v1",
      keyRef: "TEST_KEY",
      name: "test",
      vision: false,
    },
  });
  await new Promise((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  rmSync(root, { recursive: true, force: true });
  expect(done?.status).toBe("completed");
  expect(delivered).toBe(true);
  expect(text).toContain("STEERED_SUCCESS");
}, 20000);

// macOS: npm run runtime:build && node test/extensions/cold-start.mjs
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:https";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
const root = mkdtempSync(path.join(tmpdir(), "anvil-mcp-loop-"));
const key = path.join(root, "k"),
  cert = path.join(root, "c");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=IP:127.0.0.1,DNS:localhost",
  ],
  { stdio: "ignore" },
);
// A local GitHub CLI fixture keeps this cold-start regression independent of logins.
const fixture = {
  data: {
    viewer: { login: "alice" },
    repository: {
      pullRequest: { url: "https://github.com/example/project/pull/42" },
    },
  },
};
writeFileSync(
  path.join(root, "gh"),
  `#!/bin/sh\nprintf '%s' '${JSON.stringify(fixture)}'\n`,
  { mode: 0o700 },
);
let returned = false,
  discovered = false,
  lastReply = "";
const server = createServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const tool = input.tools?.find((t) =>
      t.function?.name.includes("read_pull_request"),
    );
    const got =
      input.messages
        ?.filter((m) => m.role === "tool")
        .map((m) => JSON.stringify(m.content))
        .join("") || "";
    returned ||= got.includes("/pull/42") && got.includes("alice");
    const call = !!tool && !got;
    discovered ||= !!tool;
    const msg = call
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_review",
              type: "function",
              function: {
                name: tool.function.name,
                arguments: '{"number":42}',
              },
            },
          ],
        }
      : { role: "assistant", content: returned ? "PR received" : "missing PR" };
    const frame = (delta, reason) =>
      "data: " +
      JSON.stringify({
        id: "chatcmpl-check",
        model: "test",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta, finish_reason: reason }],
      }) +
      "\n\n";
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      frame(msg, null) +
        frame({}, call ? "tool_calls" : "stop") +
        "data: [DONE]\n\n",
    );
  },
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const endpoint = "https://127.0.0.1:" + server.address().port + "/v1";
const worker = spawn(path.resolve("runtime/opencode/dist/anvil-runtime"), [], {
  env: {
    HOME: process.env.HOME,
    PATH: root + path.delimiter + process.env.PATH,
    TMPDIR: root,
    NODE_EXTRA_CA_CERTS: cert,
    ANVIL_MODEL_API_KEY: "fixture",
    ANVIL_MODEL_ENDPOINT: endpoint,
  },
  stdio: "pipe",
});
const send = (m) => worker.stdin.write(JSON.stringify(m) + "\n");
createInterface({ input: worker.stdout }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.type === "permission")
    send({
      type: "permission",
      id: m.permission.id,
      allow: JSON.stringify(m.permission).includes("anvil_github"),
    });
  if (m.type === "text") lastReply += m.text;
  if (m.type === "done") {
    console.log(m.status, m.error || "");
    worker.stdin.end();
  }
});
worker.stderr.resume();
send({
  type: "start",
  repo: root,
  state: path.join(root, "state"),
  directories: [],
  github: { repo: "example/project", login: "alice", auth: "cli" },
  model: {
    id: "fixture",
    model: "test",
    name: "test",
    keyRef: "TEST",
    protocol: "chat-completions",
    endpoint,
    vision: false,
  },
  text: "Read pull request 42.",
});
const timeout = setTimeout(() => worker.kill("SIGKILL"), 35000);
await new Promise((r) => worker.once("close", r));
clearTimeout(timeout);
server.close();
rmSync(root, { recursive: true, force: true });
console.log({ discovered, returned, lastReply });
if (!(discovered && returned && lastReply.includes("PR received")))
  process.exitCode = 1;

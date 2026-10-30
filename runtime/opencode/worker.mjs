import path from "node:path";
import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";

// The only upstream-specific adapter. stdout is Anvil's JSONL protocol.
const key = process.env.BYTEPLUS_ARK_API_KEY;
const endpoint = process.env.BYTEPLUS_ARK_RESPONSES_URL;
delete process.env.BYTEPLUS_ARK_API_KEY;
delete process.env.BYTEPLUS_ARK_RESPONSES_URL;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const lines = createInterface({ input: process.stdin });
let host,
  sessionID,
  closing = false,
  started = false;
const abort = new AbortController();
async function close() {
  if (closing) return;
  closing = true;
  abort.abort();
  await host?.close();
  process.exit(0);
}
async function run(input) {
  if (!key || !endpoint) throw new Error("Provider credentials are missing.");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || !url.pathname.endsWith("/responses"))
    throw new Error("Expected an HTTPS Responses endpoint.");
  await mkdir(input.state, { recursive: true });
  for (const kind of ["DATA", "CONFIG", "CACHE", "STATE"])
    process.env[`XDG_${kind}_HOME`] = path.join(
      input.state,
      kind.toLowerCase(),
    );
  process.env.OPENCODE_TEST_HOME = input.state;
  const { OpenCode } = await import("@opencode/sdk");
  const model = "deepseek-v4-1-flash-261017";
  host = await OpenCode.create({
    app: { name: "anvil", version: "0.0.0" },
    database: { path: path.join(input.state, "sessions.db") },
    models: { fetch: false },
    config: {
      directory: path.join(input.state, "config"),
      project: false,
      content: JSON.stringify({
        share: "disabled",
        update: "disable",
        snapshots: false,
        providers: {
          ark: {
            name: "BytePlus Ark",
            package: "@opencode/ai/providers/openai/responses",
            settings: {
              apiKey: key,
              baseURL: endpoint.replace(/\/responses$/, ""),
            },
            models: {
              [model]: {
                name: "DeepSeek",
                limit: { context: 65536, output: 4096 },
              },
            },
          },
        },
      }),
    },
    fs: { filewatcher: false, fff: false },
  });
  const stream = host.events.subscribe({ signal: abort.signal });
  const consume = (async () => {
    for await (const event of stream) {
      if (!sessionID || event.data?.sessionID !== sessionID) continue;
      const d = event.data;
      switch (event.type) {
        case "session.text.delta":
          send({ type: "text", text: d.delta });
          break;
        case "permission.asked":
          send({
            type: "permission",
            permission: {
              id: d.id,
              action: d.action,
              resources: d.resources,
              message: d.message,
            },
          });
          break;
        case "permission.replied":
          send({ type: "permission-resolved", id: d.requestID });
          break;
        case "session.tool.called":
          send({ type: "activity", text: "Running an approved tool" });
          break;
        case "session.execution.succeeded":
          send({ type: "done", status: "completed" });
          return;
        case "session.execution.interrupted":
          send({ type: "done", status: "cancelled" });
          return;
        case "session.execution.failed":
          send({
            type: "done",
            status: "failed",
            error:
              "Model execution failed. Check the provider configuration and retry.",
          });
          return;
      }
    }
  })();
  if (input.sessionID) {
    const session = await host.sessions.get({ sessionID: input.sessionID });
    if (path.resolve(session.location.directory) !== path.resolve(input.repo))
      throw new Error("Session repository mismatch.");
    sessionID = session.id;
  } else {
    const session = await host.sessions.create({
      location: { directory: input.repo },
      model: { providerID: "ark", id: model },
      permissions: [{ action: "*", resource: "*", effect: "ask" }],
    });
    sessionID = session.id;
  }
  send({ type: "session", id: sessionID });
  const folders = Array.isArray(input.directories)
    ? input.directories
    : [input.repo];
  await host.sessions.prompt({
    sessionID,
    text: `Working directories selected by the user (JSON paths): ${JSON.stringify(folders)}\nThis conversation may span multiple directories and repositories. Use absolute paths when crossing directories. Ask before accessing other directories.\n\n${input.text}`,
  });
  await consume;
  await close();
}
lines.on("line", (line) => {
  void (async () => {
    const input = JSON.parse(line);
    if (input.type === "start" && !started) {
      started = true;
      await run(input);
    } else if (input.type === "cancel") {
      if (host && sessionID) await host.sessions.interrupt({ sessionID });
      else await close();
    } else if (input.type === "permission" && host && sessionID) {
      await host.permission.reply({
        sessionID,
        requestID: input.id,
        reply: input.allow === true ? "once" : "reject",
      });
    }
  })().catch(async () => {
    send({
      type: "done",
      status: "failed",
      error:
        "Agent runtime failed. Check the runtime installation and provider configuration.",
    });
    await close();
  });
});
lines.on("close", () => void close());

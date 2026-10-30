import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const key = process.env.BYTEPLUS_ARK_API_KEY;
const endpoint = process.env.BYTEPLUS_ARK_RESPONSES_URL;
assert.ok(key && endpoint, "Inject BytePlus credentials through keygrant.");
delete process.env.BYTEPLUS_ARK_API_KEY;
delete process.env.BYTEPLUS_ARK_RESPONSES_URL;
const base = path.resolve(".anvil/model-probes");
await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, "run-"));
for (const kind of ["DATA", "CONFIG", "CACHE", "STATE"])
  process.env[`XDG_${kind}_HOME`] = path.join(root, kind.toLowerCase());
process.env.OPENCODE_TEST_HOME = root;
const { OpenCode } = await import("@opencode/sdk");
const model = "deepseek-v4-1-flash-261017";
const host = await OpenCode.create({
  app: { name: "anvil-model-probe", version: "0.0.0" },
  database: { path: path.join(root, "sessions.db") },
  models: { fetch: false },
  config: {
    directory: path.join(root, "config"),
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
            baseURL: endpoint.replace(/\/responses\/?$/, ""),
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
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), 90000);
let id,
  result = "",
  done = false;
try {
  const events = host.events.subscribe({ signal: abort.signal });
  const consume = (async () => {
    for await (const event of events) {
      if (event.data?.sessionID !== id) continue;
      if (event.type === "session.text.delta") result += event.data.delta;
      if (event.type === "permission.asked")
        await host.permission.reply({
          sessionID: id,
          requestID: event.data.id,
          reply: "reject",
        });
      if (event.type === "session.execution.failed")
        throw new Error(JSON.stringify(event.data.error));
      if (event.type === "session.execution.succeeded") {
        done = true;
        break;
      }
      console.log(JSON.stringify({ event: event.type }));
    }
  })();
  const session = await host.sessions.create({
    location: { directory: root },
    model: { providerID: "ark", id: model },
    permissions: [{ action: "*", resource: "*", effect: "deny" }],
  });
  id = session.id;
  await host.sessions.prompt({
    sessionID: id,
    text: "Reply with exactly ANVIL_MODEL_OK. Do not use tools.",
  });
  await consume;
  assert.ok(done, "Model execution timed out");
  assert.ok(result.includes("ANVIL_MODEL_OK"), "Expected model response");
  console.log(JSON.stringify({ result: "passed", model, text: result }));
} finally {
  clearTimeout(timer);
  abort.abort();
  await host.close();
}

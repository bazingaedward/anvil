import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import electron from "electron";
import { startRuntime } from "../desktop/main/runtime";

const key = process.env.ANVIL_COPILOT_OAUTH;
if (!key) throw new Error("Run through Keygrant with ANVIL_COPILOT_OAUTH.");
delete process.env.ANVIL_COPILOT_OAUTH;
const root = await mkdtemp(path.join(tmpdir(), "anvil-browser-model-"));
let verified = false;
const server = createServer((req, res) => {
  if (req.url === "/verified") {
    verified = true;
    res.end("Verified");
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    "<title>Anvil acceptance</title><button onclick=\"fetch('/verified').then(()=>this.textContent='Verified')\">Verify</button>",
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
const completed: string[] = [];
try {
  const run = startRuntime(
    {
      repo: root,
      state: root,
      directories: [],
      browser: {
        command: [
          electron as unknown as string,
          path.resolve("out/main/browser-worker.js"),
        ],
        outputDir: path.join(root, "browser"),
      },
      model: {
        id: "copilot-browser-test",
        model: "claude-sonnet-5.5",
        name: "Claude Sonnet 5.5",
        provider: "GitHub Copilot",
        connection: "copilot",
        endpoint: "https://api.githubcopilot.com",
        keyRef: "ANVIL_COPILOT_OAUTH",
        vision: true,
      },
      text: `Use only the anvil_browser tools to open http://127.0.0.1:${port}, call browser_snapshot to read the actual snapshot (automatic snapshots may be file links), click Verify, check the new label, and take a screenshot. Do not use shell, filesystem or network request tools. Reply in one sentence with the observed result.`,
    },
    {
      executable: path.resolve("runtime/opencode/dist/anvil-runtime"),
      key,
      endpoint: "https://api.githubcopilot.com",
      signal: AbortSignal.timeout(120000),
      onEvent(event, reply) {
        if (event.type === "permission") {
          const browser =
            event.permission.action.includes("anvil_browser") ||
            event.permission.resources.some((resource) =>
              resource.includes("anvil_browser"),
            );
          console.log(
            "permission",
            event.permission.action,
            browser ? "allowed" : "denied",
          );
          reply(event.permission.id, browser);
        }
        if (event.type === "tool") {
          console.log("tool", event.name, event.status);
          if (event.status === "completed") completed.push(event.name);
        }
        if (event.type === "text") process.stdout.write(event.text);
      },
    },
  );
  const result = await run.done;
  console.log("\n", JSON.stringify({ result, verified, completed }));
  if (
    result.status !== "completed" ||
    !verified ||
    !completed.some((name) => name.includes("screenshot"))
  )
    process.exitCode = 1;
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
}

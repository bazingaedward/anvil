import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electron from "electron";
import { PromiseSdk as OpenCode } from "../../runtime/opencode/node_modules/@opencode/sdk/dist/promise.js";
import { browserConfig } from "../../runtime/opencode/browser.ts";

// Run with the pinned Bun in runtime/opencode/node_modules/@oven after build.
const root = await mkdtemp(path.join(tmpdir(), "anvil-browser-sdk-"));
const host = await OpenCode.create({
  database: { path: path.join(root, "sessions.db") },
  models: { fetch: false },
  config: {
    directory: path.join(root, "config"),
    project: false,
    content: JSON.stringify({
      share: "disabled",
      update: "disable",
      snapshots: false,
      ...browserConfig({
        command: [electron, path.resolve("out/main/browser-worker.js")],
        outputDir: path.join(root, "browser"),
      }),
    }),
  },
  fs: { filewatcher: false, fff: false },
});
try {
  const location = { directory: root };
  await host.plugin.awaitActivation({ location });
  await host.mcp.connect({ location, server: "anvil_browser" });
  const { data } = await host.mcp.list({ location });
  assert.equal(
    data.find((server) => server.name === "anvil_browser")?.status.status,
    "connected",
    JSON.stringify(data),
  );
  console.log("OpenCode 2.0: anvil_browser connected");
} finally {
  await host.close();
  await rm(root, { recursive: true, force: true });
}

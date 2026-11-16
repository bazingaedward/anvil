import { test, expect } from "bun:test";
import { copilotCredential, copilotModels } from "./copilot.mjs";
const value = {
  type: "oauth",
  methodID: "device",
  access: "fixture-access",
  refresh: "fixture-refresh",
  expires: 0,
};
test("OAuth rejects invalid credentials and foreign endpoints", () => {
  expect(copilotCredential(JSON.stringify(value)).endpoint).toBe(
    "https://api.githubcopilot.com",
  );
  for (const apiEndpoint of [
    "http://api.githubcopilot.com",
    "https://evil.example",
    "https://api.githubcopilot.com.evil.example",
    "https://user@api.githubcopilot.com",
    "https://api.githubcopilot.com?key=fixture",
  ])
    expect(() =>
      copilotCredential(
        JSON.stringify({ ...value, metadata: { apiEndpoint } }),
      ),
    ).toThrow();
  expect(() => copilotCredential("invalid-json")).toThrow();
});
test("model discovery excludes disabled, hidden and non-tool models", async () => {
  const original = globalThis.fetch;
  const base = {
    id: "test.1",
    model_picker_enabled: true,
    capabilities: {
      supports: { tool_calls: true },
      limits: { max_context_window_tokens: 32000 },
    },
  };
  globalThis.fetch = async () =>
    Response.json({
      data: [
        base,
        { ...base, id: "disabled", policy: { state: "disabled" } },
        { ...base, id: "hidden", model_picker_enabled: false },
        { ...base, id: "no-tools", capabilities: { supports: {} } },
      ],
    });
  try {
    const models = await copilotModels(
      copilotCredential(JSON.stringify(value)),
    );
    expect(models.map((m) => m.model)).toEqual(["test.1"]);
    expect(models[0].keyRef).toBe("ANVIL_COPILOT_OAUTH");
    expect(models[0].connection).toBe("copilot");
  } finally {
    globalThis.fetch = original;
  }
});

test("embedded host resolves Keygrant credentials without storing them in SQLite", async () => {
  const { PromiseSdk } =
    await import("./node_modules/@opencode/sdk/dist/promise.js");
  const { copilotCredentials } = await import("./copilot.mjs");
  const { mkdtemp, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const root = await mkdtemp(path.join(tmpdir(), "copilot-store-test-"));
  let host;
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [] });
  try {
    host = await PromiseSdk.create(
      {
        database: { path: path.join(root, "sessions.db") },
        models: { fetch: false },
        config: { project: false, directory: root },
        fs: { filewatcher: false, fff: false },
      },
      copilotCredentials(value),
    );
    const location = { location: { directory: root } };
    await host.integration.get({
      ...location,
      integrationID: "github-copilot",
    });
    await host.plugin.awaitActivation(location);
    const { data } = await host.integration.get({
      ...location,
      integrationID: "github-copilot",
    });
    expect(data.connections.length).toBe(1);
    await host.close();
    host = undefined;
    const bytes = await readFile(path.join(root, "sessions.db"));
    expect(bytes.includes(Buffer.from(value.access))).toBe(false);
    expect(bytes.includes(Buffer.from(value.refresh))).toBe(false);
  } finally {
    await host?.close();
    globalThis.fetch = original;
    await rm(root, { recursive: true, force: true });
  }
});

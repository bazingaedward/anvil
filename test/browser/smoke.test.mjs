import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electron from "electron";

// Opt-in integration check: build first, then node --test test/browser/*.test.mjs.
// Uses an isolated visible Chrome and a local fixture, with no model credentials.
test(
  "packaged helper exposes browser tools, clicks a page, returns an image and closes",
  { timeout: 45000 },
  async () => {
    const output = await mkdtemp(path.join(tmpdir(), "anvil-browser-"));
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        "<title>Anvil browser check</title><button onclick=\"this.textContent='Verified'\">Verify</button>",
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const child = spawn(
      electron,
      [path.resolve("out/main/browser-worker.js"), output],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: "pipe",
      },
    );
    let sequence = 0;
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const pending = new Map();
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { roots: [] },
          }) + "\n",
        );
      } else if (pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
    const exited = new Promise((resolve) =>
      child.on("exit", (code) => {
        for (const request of pending.values())
          request.reject(new Error(`Helper exited ${code}: ${stderr}`));
        resolve(code);
      }),
    );
    const rpc = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        );
      });
    const call = async (name, args = {}) => {
      const result = await rpc("tools/call", { name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result;
    };
    try {
      await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "anvil-test", version: "1" },
      });
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }) + "\n",
      );
      const catalog = await rpc("tools/list");
      for (const name of [
        "browser_navigate",
        "browser_click",
        "browser_snapshot",
        "browser_take_screenshot",
        "browser_console_messages",
        "browser_network_requests",
      ])
        assert.ok(
          catalog.tools.some((tool) => tool.name === name),
          name,
        );
      await call("browser_navigate", {
        url: `http://127.0.0.1:${server.address().port}`,
      });
      const page = await call("browser_snapshot");
      const text = page.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const ref = text.match(/button "Verify" \[ref=([^\]]+)\]/)?.[1];
      assert.ok(ref, text);
      const clickSchema = catalog.tools.find(
        (tool) => tool.name === "browser_click",
      ).inputSchema.properties;
      await call("browser_click", {
        element: "Verify",
        [clickSchema.target ? "target" : "ref"]: ref,
      });
      const snapshot = await call("browser_snapshot");
      assert.match(JSON.stringify(snapshot), /Verified/);
      const image = await call("browser_take_screenshot", { type: "png" });
      assert.ok(
        image.content.some(
          (part) =>
            part.type === "image" &&
            part.mimeType === "image/png" &&
            part.data.length > 100,
        ),
      );
      await call("browser_close");
      child.stdin.end();
      assert.equal(await exited, 0);
    } finally {
      child.kill();
      server.close();
      lines.close();
      await rm(output, { recursive: true, force: true });
    }
  },
);

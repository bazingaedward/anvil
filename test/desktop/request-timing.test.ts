import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  timedModelFetch,
  type RequestTiming,
} from "../../runtime/opencode/request-timing";

test("model timing preserves streamed bytes and separates headers from delayed body", async () => {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.flushHeaders();
      setTimeout(() => {
        response.write("data: private-response\n\n");
        response.end("data: [DONE]\n\n");
      }, 30);
    }, 20);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/v1`;
  const events: RequestTiming[] = [];
  try {
    const response = await timedModelFetch(fetch, base, (e) => events.push(e))(
      `${base}/responses`,
      {
        method: "POST",
        body: "private-prompt",
        headers: { Authorization: "Bearer private-key" },
      },
    );
    assert.deepEqual(
      events.map((e) => e.phase),
      ["started", "headers"],
    );
    assert.equal(response.url, `${base}/responses`);
    assert.equal(
      await response.text(),
      "data: private-response\n\ndata: [DONE]\n\n",
    );
    assert.deepEqual(
      events.map((e) => e.phase),
      ["started", "headers", "first-byte", "completed"],
    );
    assert.ok(events[2].elapsedMs - events[1].elapsedMs >= 15);
    assert.ok(!JSON.stringify(events).includes("private-"));
    assert.ok(events.every((e) => e.id === "1"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("unrelated fetch is unchanged and telemetry failures do not fail a model call", async () => {
  const untouched = new Response("original");
  const events: RequestTiming[] = [];
  const timed = timedModelFetch(
    async () => untouched,
    "https://api.test/v1",
    (e) => events.push(e),
  );
  assert.equal(
    await timed("https://api.test/v10/responses", { method: "POST" }),
    untouched,
  );
  assert.equal(
    await timed("https://other.test/v1/responses", { method: "POST" }),
    untouched,
  );
  assert.equal(await timed("https://api.test/v1/models"), untouched);
  assert.deepEqual(events, []);
  const failingLog = timedModelFetch(
    async () => new Response("ok"),
    "https://api.test/v1",
    () => {
      throw new Error("disk full");
    },
  );
  assert.equal(
    await (
      await failingLog("https://api.test/v1/responses", { method: "POST" })
    ).text(),
    "ok",
  );
});

test("model timing preserves HTTP failures, stream failures and cancellation", async () => {
  const events: RequestTiming[] = [];
  const report = (e: RequestTiming) => events.push(e);
  const request = new Request("https://api.test/v1/responses", {
    method: "POST",
  });
  const failed = await timedModelFetch(
    async () => new Response("limited", { status: 429 }),
    "https://api.test/v1",
    report,
  )(request);
  assert.equal(await failed.text(), "limited");
  assert.equal(events.at(-1)?.phase, "failed");
  assert.equal(events.at(-1)?.status, 429);
  let cancelled = false;
  const response = await timedModelFetch(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
    "https://api.test/v1",
    report,
  )(request);
  await response.body!.cancel();
  assert.equal(cancelled, true);
  assert.equal(events.at(-1)?.phase, "cancelled");
  const failure = new Error("private-server-error");
  const broken = await timedModelFetch(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(failure);
          },
        }),
      ),
    "https://api.test/v1",
    report,
  )(request);
  await assert.rejects(broken.text(), (error) => error === failure);
  assert.equal(events.at(-1)?.phase, "failed");
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    timedModelFetch(
      async () => {
        throw failure;
      },
      "https://api.test/v1",
      report,
    )(request, { signal: abort.signal }),
    (error) => error === failure,
  );
  assert.equal(events.at(-1)?.phase, "cancelled");
  assert.ok(!JSON.stringify(events).includes("private-server-error"));
});

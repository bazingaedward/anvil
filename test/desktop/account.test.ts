import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Account, CLOUD_URL } from "../../desktop/main/account";
import { defaultModel } from "../../desktop/main/composer";
test("account login keeps token out of renderer state, serializes revisions, preserves conflicts and clears revoked sessions", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-account-"));
  const original = globalThis.fetch;
  const token = "T".repeat(43);
  let revision = 1,
    conflict = false,
    revoked = false;
  const config = {
    models: [defaultModel],
    groups: [],
    preferences: { defaultModelID: defaultModel.id },
  };
  const puts: number[] = [];
  globalThis.fetch = async () => {
    throw new Error("Node fetch must not bypass the injected account transport");
  };
  const fetchAccount: typeof fetch = async (input, options) => {
    const url = String(input);
    assert.ok(url.startsWith(CLOUD_URL + "/"));
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal instanceof AbortSignal);
    const route = url.slice(CLOUD_URL.length);
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (route === "/auth/start") {
      assert.equal(body.challenge.length, 43);
      return Response.json({
        id: "login",
        url: CLOUD_URL + "/auth/authorize?id=login",
        expires: Date.now() + 60000,
      });
    }
    if (route === "/auth/exchange") {
      assert.equal(body.verifier.length, 43);
      return Response.json({ token });
    }
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      "Bearer " + token,
    );
    if (revoked) return Response.json({}, { status: 401 });
    if (route === "/me")
      return Response.json({
        id: "google:test",
        name: "Test",
        email: "test@example.com",
        expires: Date.now() + 60000,
      });
    if (route === "/config" && options?.method === "PUT") {
      puts.push(body.revision);
      if (conflict) return Response.json({}, { status: 409 });
      assert.equal(body.revision, revision);
      revision++;
      return Response.json({ revision, config: body.config });
    }
    if (route === "/config") return Response.json({ revision, config });
    return Response.json({ ok: true });
  };
  try {
    const account = new Account(
      root,
      (v) => Buffer.from(v),
      (b) => b.toString(),
      fetchAccount,
    );
    await assert.rejects(account.require(), /Sign in/);
    await account.begin();
    assert.equal(account.state().pending, true);
    await account.poll();
    await account.refresh();
    assert.ok(!JSON.stringify(account.state()).includes(token));
    await Promise.all([account.mutate((c) => c), account.mutate((c) => c)]);
    assert.deepEqual(puts, [1, 2]);
    conflict = true;
    await assert.rejects(
      account.mutate((c) => c),
      /Refresh settings/,
    );
    assert.equal(account.state().revision, 3);
    revoked = true;
    await assert.rejects(account.refresh(), /expired/);
    assert.equal(account.state().user, null);
    assert.equal(account.hasSession, false);
    assert.equal(existsSync(path.join(root, "account.session")), false);
  } finally {
    globalThis.fetch = original;
    rmSync(root, { recursive: true, force: true });
  }
});

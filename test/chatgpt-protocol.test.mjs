import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { ISSUER, parseCallback, verifyIdentity, verifyCompletion, safeCode } from "../scripts/chatgpt-protocol.mjs";

test("OAuth accepts an issued client and rejects missing or changed registration", () => {
  const url = new URL("http://127.0.0.1/auth/callback?state=expected&code=one-time&client_id=oaiapp_test");
  assert.deepEqual(parseCallback(url, "expected"), { clientId: "oaiapp_test", code: "one-time" });
  assert.throws(() => parseCallback(url, "different"), /state mismatch/);
  assert.throws(() => parseCallback(url, "expected", "oaiapp_original"), /changed/);
  url.searchParams.delete("client_id");
  assert.throws(() => parseCallback(url, "expected"), /missing/);
  assert.equal(parseCallback(url, "expected", "oaiapp_test").clientId, "oaiapp_test");
  url.searchParams.set("client_id", "dynamic_agent_client");
  assert.throws(() => parseCallback(url, "expected"), /missing/);
});

test("OAuth denial is handled only after state verification", () => {
  const url = new URL("http://127.0.0.1/auth/callback?state=expected&error=access_denied");
  assert.throws(() => parseCallback(url, "wrong"), /state mismatch/);
  assert.throws(() => parseCallback(url, "expected"), /access_denied/);
});

test("ID token requires a valid signature, issuer, audience, expiry, and nonce", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: ISSUER, aud: "oaiapp_test", sub: "test-subject", iat: now, exp: now + 60, nonce: "expected" };
  const sign = (overrides = {}, key = privateKey) => new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg: "RS256" }).sign(key);
  assert.equal(await verifyIdentity(await sign(), publicKey, "oaiapp_test", "expected"), "test-subject");
  for (const overrides of [{ iss: "https://wrong.invalid" }, { aud: "oaiapp_other" }, { exp: now - 60 }, { nonce: "wrong" }, { sub: "" }]) {
    await assert.rejects(verifyIdentity(await sign(overrides), publicKey, "oaiapp_test", "expected"), /validation failed/);
  }
  await assert.rejects(verifyIdentity(await sign({}, other.privateKey), publicKey, "oaiapp_test", "expected"), /validation failed/);
});

function stream(events, newline = "\n") {
  const text = events.map((event) => `data: ${JSON.stringify(event)}${newline}${newline}`).join("");
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3));
    controller.close();
  } });
}

const delta = { type: "response.output_text.delta", delta: "ANVIL_OK" };
const completed = { type: "response.completed", response: { status: "completed" } };

test("SSE handles fragmented frames with LF and CRLF", async () => {
  await verifyCompletion(stream([delta, completed]));
  await verifyCompletion(stream([delta, completed], "\r\n"));
});

test("Partial output and premature EOF cannot pass", async () => {
  await assert.rejects(verifyCompletion(stream([delta])), /without response.completed/);
  await assert.rejects(verifyCompletion(stream([completed])), /expected ANVIL_OK/);
  await assert.rejects(verifyCompletion(stream([delta, { type: "response.incomplete" }])), /Inference failed/);
});

test("A usage-limit failure after output is still a failed inference", async () => {
  await assert.rejects(verifyCompletion(stream([delta, {
    type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } },
  }])), /subscription_sharing_usage_limit_exceeded/);
});

test("Unknown server errors cannot echo arbitrary values into logs", () => {
  assert.equal(safeCode("an-arbitrary-private-response"), "unrecognized_error");
  assert.equal(safeCode("invalid_grant"), "invalid_grant");
});

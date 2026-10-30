import { jwtVerify } from "jose";

export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const SECRET_NAME = "ANVIL_CHATGPT_ACCESS_TOKEN";

export class SmokeError extends Error {}

const errorCodes = new Set([
  "access_denied", "invalid_client", "invalid_grant", "invalid_scope",
  "invalid_token", "unauthorized_client", "unsupported_grant_type",
  "subscription_sharing_user_not_eligible",
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_usage_unavailable",
  "subscription_sharing_unsupported_capability",
  "subscription_sharing_route_not_supported",
  "subscription_sharing_invalid_user", "subscription_sharing_user_unavailable",
  "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context",
]);

export function safeCode(value) {
  return errorCodes.has(value) ? value : "unrecognized_error";
}

export function parseCallback(url, expectedState, savedClientId) {
  if (url.searchParams.get("state") !== expectedState) {
    throw new SmokeError("OAuth callback state mismatch.");
  }
  if (url.searchParams.has("error")) {
    throw new SmokeError(`OAuth authorization failed: ${safeCode(url.searchParams.get("error"))}`);
  }
  const clientId = url.searchParams.get("client_id") ?? savedClientId;
  const code = url.searchParams.get("code");
  if (!clientId || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) || !code) {
    throw new SmokeError("OAuth callback is missing a valid issued client ID or code.");
  }
  if (savedClientId && clientId !== savedClientId) {
    throw new SmokeError("OAuth callback changed the registered client ID.");
  }
  return { clientId, code };
}

export async function verifyIdentity(idToken, key, clientId, nonce) {
  try {
    const { payload } = await jwtVerify(idToken, key, {
      issuer: ISSUER,
      audience: clientId,
      requiredClaims: ["sub", "exp", "iat", "nonce"],
      clockTolerance: 5,
    });
    if (payload.nonce !== nonce || typeof payload.sub !== "string" || !payload.sub) {
      throw new Error("Invalid identity");
    }
    return payload.sub;
  } catch {
    throw new SmokeError("ID token validation failed (signature, identity, expiry, or nonce).");
  }
}

export async function* readEvents(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let data = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        if (line === "" && data.length) {
          const raw = data.join("\n");
          data = [];
          if (raw !== "[DONE]") yield JSON.parse(raw);
        }
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function verifyCompletion(body) {
  let text = "";
  for await (const event of readEvents(body)) {
    if (event.type === "response.output_text.delta") text += event.delta;
    if (["response.failed", "response.incomplete", "error"].includes(event.type)) {
      throw new SmokeError(`Inference failed: ${safeCode(event.response?.error?.code ?? event.code ?? event.error?.code)}`);
    }
    if (event.type === "response.completed") {
      if (event.response?.status !== "completed" || text.trim() !== "ANVIL_OK") {
        throw new SmokeError("Response completed without the expected ANVIL_OK output.");
      }
      return;
    }
  }
  throw new SmokeError("Stream ended without response.completed.");
}

export function reportFailure(error) {
  // Never print raw network errors, OAuth bodies, credentials, or stack traces.
  console.error(error instanceof SmokeError ? error.message : "Test failed unexpectedly; no credentials or response body were logged.");
  process.exitCode = 1;
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { createRemoteJWKSet } from "jose";
import { ISSUER, RESOURCE, SECRET_NAME, SmokeError, parseCallback, verifyIdentity, safeCode, reportFailure } from "./chatgpt-protocol.mjs";

const local = new URL("../.anvil/", import.meta.url);
const hash = (value) => createHash("sha256").update(value).digest("base64url");
const random = () => randomBytes(32).toString("base64url");

async function load(name) {
  try {
    return JSON.parse(await readFile(new URL(name, local), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function save(name, value) {
  await writeFile(new URL(name, local), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function storeToken(value) {
  await new Promise((resolve, reject) => {
    const child = spawn("keygrant", ["set", SECRET_NAME, "--desc", "Anvil ChatGPT OAuth smoke test access token; injected into chatgpt:probe"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => reject(new SmokeError("Could not start keygrant; token was not saved.")));
    child.stdin.on("error", () => reject(new SmokeError("Could not send token to keygrant.")));
    child.on("close", (code) => code === 0 ? resolve() : reject(new SmokeError("keygrant did not save the token.")));
    child.stdin.end(value);
  });
}

async function login() {
  await mkdir(local, { recursive: true, mode: 0o700 });
  const host = await load("host.json") ?? { ext_agent_host_id: `urn:uuid:${randomUUID()}` };
  await save("host.json", host);
  const registration = await load("registration.json");
  const state = random();
  const nonce = random();
  const verifier = random();
  let settle;
  let consumed = false;
  const callback = new Promise((resolve) => { settle = resolve; });
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/auth/callback" || consumed) {
      res.writeHead(404).end("Not found");
      return;
    }
    if (url.searchParams.get("state") !== state) {
      res.writeHead(400).end("Invalid authorization state.");
      return;
    }
    consumed = true;
    try {
      const result = parseCallback(url, state, registration?.client_id);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("Anvil received the callback. Return to the terminal for the verification result.");
      settle(result);
    } catch (error) {
      res.writeHead(400).end("Authorization failed. Return to the terminal.");
      settle({ error });
    }
  });
  const timer = setTimeout(() => settle({ error: new SmokeError("Browser authorization timed out after 10 minutes.") }), 600_000);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
    const authorize = new URL(`${ISSUER}/api/accounts/authorize`);
    authorize.search = new URLSearchParams({
      client_id: registration?.client_id ?? "dynamic_agent_client",
      ...(!registration && { agent_name_hint: "Anvil" }),
      ext_agent_host_id: host.ext_agent_host_id,
      response_type: "code", redirect_uri: redirectUri,
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource: RESOURCE, state, nonce,
      code_challenge_method: "S256", code_challenge: hash(verifier),
    }).toString();
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    await promisify(execFile)(opener, [authorize.toString()]);
    console.log("Continue with ChatGPT: browser opened. Waiting for authorization (up to 10 minutes).");
    const result = await callback;
    if (result.error) throw result.error;
    const { clientId, code } = result;
    // Preserve the issued registration if code exchange fails; it is not a secret.
    await save("registration.json", { ...registration, client_id: clientId });
    console.log("OAuth callback accepted; exchanging code and validating identity.");
    const response = await fetch(`${ISSUER}/api/accounts/oauth/token`, {
      method: "POST", signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code,
        code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE }),
    });
    const tokens = await response.json().catch(() => ({}));
    if (!response.ok) throw new SmokeError(`Token exchange failed: HTTP ${response.status}, ${safeCode(tokens.error)}`);
    const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
    const subject = await verifyIdentity(tokens.id_token, jwks, clientId, nonce);
    if (registration?.subject_hash && registration.subject_hash !== hash(subject)) {
      throw new SmokeError("The signed-in account differs from this saved registration.");
    }
    if (!tokens.scope?.split(" ").includes("chatgpt.tokens.use.direct")) {
      throw new SmokeError("ChatGPT plan usage was not granted; inference will not run.");
    }
    if (typeof tokens.access_token !== "string" || !tokens.access_token || tokens.token_type?.toLowerCase() !== "bearer") {
      throw new SmokeError("The token response did not contain a usable bearer token.");
    }
    await storeToken(tokens.access_token);
    await save("registration.json", { client_id: clientId, subject_hash: hash(subject) });
    console.log(`Login verified. Access token saved to keygrant as ${SECRET_NAME}.`);
    console.log("Next: keygrant exec --redact ANVIL_CHATGPT_ACCESS_TOKEN -- npm run chatgpt:probe");
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

login().catch(reportFailure);

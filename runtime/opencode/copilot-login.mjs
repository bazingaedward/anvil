import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const expectedLogin = process.argv[2];
if (!expectedLogin) throw new Error("Usage: copilot-login.mjs <github-login>");
// Keep Keygrant on the user's vault when isolating OpenCode's XDG directories.
const keygrantEnv = { ...process.env };
const root = await mkdtemp(path.join(os.tmpdir(), "anvil-copilot-login-"));
for (const kind of ["DATA", "CONFIG", "CACHE", "STATE"])
  process.env[`XDG_${kind}_HOME`] = path.join(root, kind.toLowerCase());
process.env.OPENCODE_TEST_HOME = root;
const { OpenCode } = await import("@opencode/sdk");
let context;
let host;
let stage = "host";
try {
  host = await OpenCode.create({
    app: { name: "anvil", version: "0.0.0" },
    database: { path: ":memory:" },
    models: { fetch: false },
    config: {
      directory: path.join(root, "config"),
      project: false,
      content: JSON.stringify({
        share: "disabled",
        update: "disable",
        snapshots: false,
      }),
    },
    fs: { filewatcher: false, fff: false },
    plugins: [
      {
        id: "anvil.copilot.login",
        setup(ctx) {
          context = ctx;
        },
      },
    ],
  });
  const location = { location: { directory: root } };
  stage = "device-authorization";
  await host.integration.get({
    ...location,
    integrationID: "github-copilot",
  });
  await host.plugin.awaitActivation(location);
  const { data: attempt } = await host.integration.oauth.connect({
    ...location,
    integrationID: "github-copilot",
    methodID: "device",
    answer: { deploymentType: "github.com" },
  });
  console.log(
    JSON.stringify({
      url: attempt.url,
      instructions: attempt.instructions,
      expectedLogin,
    }),
  );
  stage = "browser-authorization";
  for (;;) {
    const { data: status } = await host.integration.oauth.status({
      ...location,
      integrationID: "github-copilot",
      attemptID: attempt.attemptID,
    });
    if (status.status === "complete") break;
    if (status.status !== "pending")
      throw new Error(`Authorization ${status.status}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const connection =
    await context.integration.connection.active("github-copilot");
  stage = "identity-check";
  const credential =
    connection && (await context.integration.connection.resolve(connection));
  if (credential?.type !== "oauth")
    throw new Error("Copilot credential unavailable");
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${credential.access}`,
      "User-Agent": "anvil",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Identity check failed (${response.status})`);
  const user = await response.json();
  if (user.login?.toLowerCase() !== expectedLogin.toLowerCase())
    throw new Error(
      "Authorized GitHub account does not match the requested account; credential was not saved.",
    );
  stage = "keygrant-store";
  await new Promise((resolve, reject) => {
    const child = spawn(
      "keygrant",
      [
        "set",
        "ANVIL_COPILOT_OAUTH",
        "--desc",
        `Anvil Copilot OAuth for ${expectedLogin}; OpenCode 2.0 model provider; inject only via Keygrant`,
      ],
      { env: keygrantEnv, stdio: ["pipe", "ignore", "ignore"] },
    );
    child.on("error", () => reject(new Error("Could not start Keygrant")));
    child.stdin.on("error", () =>
      reject(new Error("Could not store credential in Keygrant")),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Keygrant did not save credential")),
    );
    child.stdin.end(JSON.stringify(credential));
  });
  console.log(
    JSON.stringify({
      status: "saved",
      login: user.login,
      secretName: "ANVIL_COPILOT_OAUTH",
    }),
  );
} catch (error) {
  // Never serialize SDK errors: they can contain request/response credentials.
  console.error(
    JSON.stringify({
      stage,
      name: error?.name,
      status: error?.status,
      message:
        stage === "device-authorization"
          ? String(error?.message || "Request failed")
              .replace(/\b(?:gh[oupsr]_|sk-)[\w-]+/g, "[REDACTED]")
              .slice(0, 500)
          : "Copilot authorization did not complete",
    }),
  );
  process.exitCode = 1;
} finally {
  await host?.close();
  await rm(root, { recursive: true, force: true });
}

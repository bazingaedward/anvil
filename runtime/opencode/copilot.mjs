import { Credential } from "@opencode/core/credential";
import { Effect, Layer } from "effect";

export function copilotCredential(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {}
  if (
    value?.type !== "oauth" ||
    !value.refresh ||
    !value.access ||
    value.methodID !== "device"
  )
    throw new Error(
      "Copilot OAuth is missing. Run copilot-login.mjs and restart through Keygrant.",
    );
  const url = new URL(
    value.metadata?.apiEndpoint || "https://api.githubcopilot.com",
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.hostname === "api.githubcopilot.com" ||
      url.hostname.endsWith(".githubcopilot.com")
    )
  )
    throw new Error("Unsupported Copilot API endpoint.");
  return { value, endpoint: url.href.replace(/\/$/, "") };
}

// Replace only the upstream credential store. Conversation data may persist;
// OAuth credentials remain in memory and are owned by Keygrant.
export function copilotCredentials(value) {
  const record = new Credential.Info({
    id: Credential.ID.create(),
    integrationID: "github-copilot",
    label: "Keygrant",
    value,
  });
  const records = new Map([[record.id, record]]);
  const service = Credential.Service.of({
    all: () => Effect.succeed([...records.values()]),
    list: (integrationID) =>
      Effect.succeed(
        [...records.values()].filter((r) => r.integrationID === integrationID),
      ),
    get: (id) => Effect.succeed(records.get(id)),
    create: (input) =>
      Effect.sync(() => {
        const r = new Credential.Info({
          ...input,
          id: Credential.ID.create(),
          label: input.label || "Keygrant",
        });
        records.set(r.id, r);
        return r;
      }),
    activate: () => Effect.void,
    update: (id, updates) =>
      Effect.sync(() => {
        const r = records.get(id);
        if (r) records.set(id, new Credential.Info({ ...r, ...updates }));
      }),
    remove: (id) =>
      Effect.sync(() => {
        records.delete(id);
      }),
  });
  return {
    overrides: [
      Credential.node.replace(Layer.succeed(Credential.Service, service)),
    ],
  };
}

export async function copilotModels({ value, endpoint }) {
  const response = await fetch(`${endpoint}/models`, {
    headers: {
      Authorization: `Bearer ${value.refresh}`,
      "User-Agent": "anvil/0.0.0",
      "X-GitHub-Api-Version": "2026-08-01",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      `Copilot model discovery failed (HTTP ${response.status}). Check subscription and organization access.`,
    );
  const body = await response.json();
  if (!Array.isArray(body.data)) throw new Error("Invalid Copilot model list.");
  return body.data
    .filter(
      (m) =>
        m.model_picker_enabled &&
        m.policy?.state !== "disabled" &&
        m.capabilities?.supports?.tool_calls &&
        /^[\w.-]{1,120}$/.test(m.id),
    )
    .map((m) => ({
      id: `copilot-${m.id.replaceAll(".", "-")}`,
      model: m.id,
      name: String(m.name || m.id).slice(0, 160),
      provider: "GitHub Copilot",
      connection: "copilot",
      protocol: "responses",
      endpoint: "https://api.githubcopilot.com",
      keyRef: "ANVIL_COPILOT_OAUTH",
      vision: !!m.capabilities.supports.vision,
      tools: true,
      contextLimit:
        m.capabilities.limits?.max_context_window_tokens ||
        m.capabilities.limits?.max_prompt_tokens,
      outputLimit: m.capabilities.limits?.max_output_tokens,
    }));
}

import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { startRuntime } from "./runtime";
import type { ModelProfile } from "../shared/api";

export async function discoverCopilotModels(executable: string, key: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-copilot-models-"));
  let models: ModelProfile[] | undefined;
  try {
    const run = startRuntime(
      {
        listModels: true,
        repo: root,
        state: root,
        directories: [],
        text: "",
        model: {
          id: "copilot-discovery",
          model: "discovery",
          name: "Copilot",
          provider: "GitHub Copilot",
          connection: "copilot",
          endpoint: "https://api.githubcopilot.com",
          keyRef: "ANVIL_COPILOT_OAUTH",
          vision: false,
        },
      },
      {
        executable,
        key,
        endpoint: "https://api.githubcopilot.com",
        signal: AbortSignal.timeout(30000),
        onEvent(event) {
          if (event.type === "models") models = event.models;
        },
      },
    );
    const result = await run.done;
    if (result.status !== "completed" || !models?.length)
      throw new Error(
        result.error ||
          "Copilot 没有返回可用模型，请检查套餐、组织权限和网络。",
      );
    return models;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function probeModel(
  executable: string,
  model: ModelProfile,
  key: string,
  endpoint: string,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-model-probe-"));
  const abort = new AbortController();
  let failure =
    "Model connection failed. Check the protocol, model ID and credentials.";
  const timer = setTimeout(() => {
    failure = "Model connection test timed out.";
    abort.abort();
  }, 60000);
  try {
    const run = startRuntime(
      {
        probe: true,
        repo: root,
        state: path.join(root, "state"),
        directories: [],
        model,
        text: "Reply with OK only. Do not use tools.",
      },
      {
        executable,
        key,
        endpoint,
        signal: abort.signal,
        onEvent(event, reply) {
          if (event.type === "permission") {
            failure = "Connection test requested tools; no tool was allowed.";
            reply(event.permission.id, false);
            abort.abort();
          }
        },
      },
    );
    const result = await run.done;
    if (result.status !== "completed") throw new Error(failure);
  } finally {
    clearTimeout(timer);
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

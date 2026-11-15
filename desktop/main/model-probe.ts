import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { startRuntime } from "./runtime";
import type { ModelProfile } from "../shared/api";

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

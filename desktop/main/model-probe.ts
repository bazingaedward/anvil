import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import { executionEnvironment, killProcessTree } from "./acceptance";
import type { ModelProfile } from "../shared/api";
export async function probeModel(
  executable: string,
  model: ModelProfile,
  key: string,
  endpoint: string,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-model-probe-"));
  try {
    await new Promise<void>((resolve, reject) => {
      const env = executionEnvironment();
      for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"])
        if (process.env[name]) env[name] = process.env[name]!;
      env.ANVIL_MODEL_API_KEY = key;
      env.ANVIL_MODEL_ENDPOINT = endpoint;
      const child = spawn(executable, [], {
        cwd: root,
        env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "ignore"],
      });
      let result = false,
        failure =
          "Model connection failed. Check the protocol, model ID and credentials.";
      const timer = setTimeout(() => {
        failure = "Model connection test timed out.";
        killProcessTree(child);
      }, 60000);
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          const event = JSON.parse(line);
          if (event.type === "done") {
            result = event.status === "completed";
            child.stdin.end();
          }
          if (event.type === "permission") {
            failure = "Connection test requested tools; no tool was allowed.";
            killProcessTree(child);
          }
        } catch {}
      });
      child.once("error", () => {
        clearTimeout(timer);
        lines.close();
        reject(new Error("Could not launch the model runtime."));
      });
      child.once("close", () => {
        clearTimeout(timer);
        lines.close();
        if (result) resolve();
        else reject(new Error(failure));
      });
      child.stdin.on("error", () => {});
      child.stdin.write(
        JSON.stringify({
          type: "start",
          probe: true,
          repo: root,
          state: path.join(root, "state"),
          directories: [],
          model,
          text: "Reply with OK only. Do not use tools.",
        }) + "\n",
      );
    });
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

import { spawn } from "node:child_process";

export function runProcess(command, args, { cwd, signal, timeoutMs = 30_000, maxOutput = 16_000 } = {}) {
  if (signal?.aborted) return Promise.resolve({ exitCode: null, output: "", cancelled: true });
  return new Promise((resolve) => {
    const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT"]
      .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    let truncated = false;
    let cancelled = false;
    let spawnError = false;
    const stop = () => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* Process already exited. */ }
    };
    const capture = (chunk) => {
      const text = chunk.toString();
      const remaining = maxOutput - output.length;
      output += text.slice(0, remaining);
      if (text.length > remaining) { truncated = true; stop(); }
    };
    child.stdout.setEncoding("utf8").on("data", capture);
    child.stderr.setEncoding("utf8").on("data", capture);
    const abort = () => { cancelled = true; stop(); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.on("error", () => { spawnError = true; });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ exitCode, output, timedOut, truncated, cancelled, spawnError });
    });
  });
}

export const commandPassed = (result) => result.exitCode === 0
  && !result.timedOut && !result.truncated && !result.cancelled && !result.spawnError;

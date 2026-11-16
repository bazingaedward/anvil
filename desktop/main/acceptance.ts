import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { AcceptanceOptions, AcceptanceRun } from "../shared/api";

export function executionEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LC_ALL",
  ])
    if (process.env[key]) env[key] = process.env[key]!;
  return env;
}

// Kill the process group/tree, not just the shell that launched npm or a test runner.
export function killProcessTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      ["/pid", String(child.pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    killer.on("error", () => child.kill());
    killer.unref();
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

export function validateAcceptance(
  value: AcceptanceOptions | undefined,
  directories: string[],
): AcceptanceOptions | undefined {
  if (value === undefined) return;
  if (
    !value ||
    typeof value.command !== "string" ||
    !value.command.trim() ||
    value.command.length > 2000 ||
    value.command.includes("\0") ||
    typeof value.directory !== "string" ||
    !directories.includes(value.directory) ||
    !Number.isSafeInteger(value.maxRepairs ?? -1) ||
    (value.maxRepairs ?? -1) < -1 ||
    !Number.isSafeInteger(value.timeoutMs ?? 0) ||
    (value.timeoutMs ?? 0) < 0 ||
    (value.timeoutMs ?? 0) > 2147483647
  )
    throw new Error(
      "Invalid acceptance check. Choose an added directory, repairs >= -1 (-1 means unlimited), and timeout >= 0 (0 means unlimited).",
    );
  return {
    command: value.command.trim(),
    directory: value.directory,
    maxRepairs: value.maxRepairs ?? -1,
    timeoutMs: value.timeoutMs ?? 0,
  };
}

export function runAcceptance(
  options: AcceptanceOptions,
  round: number,
  signal: AbortSignal,
): Promise<AcceptanceRun> {
  return new Promise((resolve) => {
    const started = Date.now();
    const result: AcceptanceRun = {
      round,
      exitCode: null,
      output: "",
      timedOut: false,
      cancelled: signal.aborted,
      truncated: false,
      durationMs: 0,
    };
    if (signal.aborted) {
      resolve(result);
      return;
    }
    const child = spawn(options.command, {
      cwd: options.directory,
      shell:
        process.platform === "win32"
          ? process.env.COMSPEC || "cmd.exe"
          : "/bin/sh",
      windowsHide: true,
      detached: process.platform !== "win32",
      env: executionEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0,
      settled = false,
      stopping = false,
      fallback: NodeJS.Timeout | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fallback) clearTimeout(fallback);
      signal.removeEventListener("abort", cancel);
      result.output = Buffer.concat(chunks).toString("utf8");
      result.durationMs = Date.now() - started;
      resolve(result);
    };
    const capture = (data: Buffer) => {
      const remaining = 64 * 1024 - bytes;
      const part = data.subarray(0, Math.max(0, remaining));
      if (part.length) chunks.push(part);
      bytes += part.length;
      if (data.length > remaining) result.truncated = true;
    };
    const terminate = () => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      killProcessTree(child);
      fallback = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish();
      }, 3000);
    };
    const cancel = () => {
      result.cancelled = true;
      terminate();
    };
    const timer =
      (options.timeoutMs ?? 0) > 0
        ? setTimeout(() => {
            result.timedOut = true;
            terminate();
          }, options.timeoutMs)
        : undefined;
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", () => {
      result.error = "Could not start the acceptance command.";
      finish();
    });
    child.on("close", (code) => {
      result.exitCode = code;
      finish();
    });
  });
}

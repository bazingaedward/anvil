import {
  mkdirSync,
  appendFileSync,
  writeFileSync,
  renameSync,
  statSync,
} from "node:fs";
import path from "node:path";
let directory = "";
let secrets: string[] = [];
const state: Record<string, unknown> = {};
let timer: NodeJS.Timeout | undefined;
export function scrubDiagnostic(value: string) {
  for (const secret of secrets)
    if (secret) value = value.split(secret).join("[REDACTED]");
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-|gh[pousr]_)[\w-]+/g, "[REDACTED]")
    .replace(/(https?:\/\/)[^\s/]+@/g, "$1[REDACTED]@")
    .replace(
      /([?&](?:key|token|api_key|access_token)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 1000);
}
function snapshot() {
  if (!directory) return;
  try {
    writeFileSync(
      path.join(directory, "status.tmp"),
      JSON.stringify(
        { pid: process.pid, heartbeat: new Date().toISOString(), ...state },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    renameSync(
      path.join(directory, "status.tmp"),
      path.join(directory, "status.json"),
    );
  } catch {
    /* Diagnostics must never stop a task. */
  }
}
export function initDiagnostics(root: string, credentials: string[] = []) {
  directory = path.join(root, "diagnostics");
  secrets = credentials;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  clearInterval(timer);
  timer = setInterval(snapshot, 5000);
  timer.unref();
  diagnostic("app.started");
  snapshot();
}
export function diagnostic(
  type: string,
  fields: Record<string, string | number | boolean | undefined> = {},
) {
  if (!directory) return;
  try {
    const file = path.join(directory, "events.jsonl");
    try {
      if (statSync(file).size > 1024 * 1024) renameSync(file, file + ".1");
    } catch {}
    const safe = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [
        k,
        typeof v === "string" ? scrubDiagnostic(v) : v,
      ]),
    );
    appendFileSync(
      file,
      JSON.stringify({ time: new Date().toISOString(), type, ...safe }) + "\n",
      { mode: 0o600 },
    );
  } catch {}
}
export function diagnosticState(
  key: string,
  fields: Record<string, string | number | boolean | undefined>,
) {
  state[key] = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [
      k,
      typeof v === "string" ? scrubDiagnostic(v) : v,
    ]),
  );
  snapshot();
}

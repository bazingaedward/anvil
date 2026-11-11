import { accessSync, constants } from "node:fs";
import path from "node:path";
import os from "node:os";
export function findCodex() {
  const binary = process.platform === "win32" ? "codex.exe" : "codex";
  const candidates = [
    ...(process.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, binary)),
    path.join(os.homedir(), ".local", "bin", binary),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(
    "Codex is not installed. Install Codex CLI and run codex login with your ChatGPT account.",
  );
}

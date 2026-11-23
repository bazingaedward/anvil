import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Finder-launched Electron often has only the system PATH.
export function extensionCommand(name: "gh" | "keygrant") {
  const file = process.platform === "win32" ? name + ".exe" : name;
  const dirs = (process.env.PATH || "")
    .split(path.delimiter)
    .filter((dir) => path.isAbsolute(dir));
  if (process.platform === "darwin")
    dirs.push(
      path.join(os.homedir(), ".local/bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
    );
  return (
    dirs.map((dir) => path.join(dir, file)).find((p) => existsSync(p)) || name
  );
}

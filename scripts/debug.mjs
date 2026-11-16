import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const base =
  process.platform === "darwin"
    ? path.join(os.homedir(), "Library/Application Support/anvil")
    : process.platform === "win32"
      ? path.join(process.env.APPDATA || os.homedir(), "Anvil")
      : path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
          "anvil",
        );
const root = process.env.ANVIL_TEST_USER_DATA || base;
const directory = path.join(root, "diagnostics");
try {
  const status = JSON.parse(
    fs.readFileSync(path.join(directory, "status.json"), "utf8"),
  );
  const stale = Date.now() - Date.parse(status.heartbeat) > 15000;
  console.log(JSON.stringify({ directory, stale, status }, null, 2));
  console.log("\nRecent events:");
  console.log(
    fs
      .readFileSync(path.join(directory, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .slice(-30)
      .join("\n"),
  );
} catch (error) {
  console.error(
    "Diagnostics unavailable. Start the updated Anvil app first.",
    error.code || "",
  );
  process.exitCode = 1;
}

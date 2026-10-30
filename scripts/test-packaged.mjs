import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
const executable =
  process.platform === "win32"
    ? path.resolve("release/win-unpacked/Anvil.exe")
    : path.resolve(
        `release/${process.arch === "arm64" ? "mac-arm64" : "mac"}/Anvil.app/Contents/MacOS/Anvil`,
      );
if (!existsSync(executable))
  throw new Error("Build the local package first with npm run package:dir.");
const result = spawnSync(
  process.execPath,
  [path.resolve("node_modules/@playwright/test/cli.js"), "test"],
  {
    stdio: "inherit",
    env: { ...process.env, ANVIL_ELECTRON_PATH: executable },
  },
);
process.exit(result.status ?? 1);

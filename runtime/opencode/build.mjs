import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Agent runtime build currently supports Windows x64.");
const dist = path.join(root, "dist");
mkdirSync(dist, { recursive: true });
const compiler = path.join(dist, "bun.exe");
copyFileSync(
  path.join(root, "node_modules/@oven/bun-windows-x64/bin/bun.exe"),
  compiler,
);
try {
  const result = spawnSync(
    compiler,
    [
      "build",
      "--compile",
      `--compile-executable-path=${compiler}`,
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      path.join(root, "worker.mjs"),
      "--outfile",
      path.join(dist, "anvil-runtime.exe"),
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = 1;
} finally {
  rmSync(compiler, { force: true });
}

import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, rmSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const platform = `${process.platform}-${process.arch}`;
const packages = {
  "win32-x64": "bun-windows-x64",
  "darwin-arm64": "bun-darwin-aarch64",
  "darwin-x64": "bun-darwin-x64",
};
const compilerPackage = packages[platform];
if (!compilerPackage)
  throw new Error(`Agent runtime build does not support ${platform}.`);
const suffix = process.platform === "win32" ? ".exe" : "";
const dist = path.join(root, "dist");
mkdirSync(dist, { recursive: true });
const compiler = path.join(dist, `bun${suffix}`);
copyFileSync(
  path.join(root, `node_modules/@oven/${compilerPackage}/bin/bun${suffix}`),
  compiler,
);
try {
  if (process.platform !== "win32") chmodSync(compiler, 0o755);
  if (process.platform === "darwin") {
    const pty = path.join(dist, "opencode-pty");
    copyFileSync(
      path.join(
        root,
        `node_modules/@opencode-ai/pty-darwin-${process.arch}/bin/opencode-pty`,
      ),
      pty,
    );
    chmodSync(pty, 0o755);
  }
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
      path.join(dist, `anvil-runtime${suffix}`),
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = 1;
} finally {
  rmSync(compiler, { force: true });
}

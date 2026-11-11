import { execFile } from "node:child_process";
import { promisify } from "node:util";
export async function openRepositoryTerminal(root: string) {
  if (process.platform !== "darwin")
    throw new Error("System terminal is currently supported on macOS only.");
  await promisify(execFile)("/usr/bin/open", ["-a", "Terminal", root], {
    timeout: 10_000,
  });
}

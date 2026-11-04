import path from "node:path";

// Bun cannot statically resolve the upstream package's platform-dependent require.
// The macOS helper ships alongside our compiled runtime instead.
export const binaryPath =
  process.platform === "darwin"
    ? path.join(path.dirname(process.execPath), "opencode-pty")
    : undefined;

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { executionEnvironment } from "./acceptance";

// MCP inherits the runtime environment. Remove provider credentials before
// importing Playwright or launching a browser process.
const environment = executionEnvironment();
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, environment, { ELECTRON_RUN_AS_NODE: "1" });

const outputDir = process.argv[2];
if (!outputDir || !path.isAbsolute(outputDir))
  throw new Error("Browser output directory must be an absolute path.");
mkdirSync(outputDir, { recursive: true });
const browserRequire = createRequire(import.meta.url);
const cli = path.join(
  path.dirname(browserRequire.resolve("@playwright/mcp/package.json")),
  "cli.js",
);
process.argv = [
  process.execPath,
  cli,
  "--browser",
  "chrome",
  "--isolated",
  "--output-dir",
  outputDir,
  "--caps",
  "vision",
];
await import(pathToFileURL(cli).href);

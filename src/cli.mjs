import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { runAgent } from "./agent.mjs";
import { createTools } from "./tools.mjs";
import { runProcess } from "./process.mjs";
import { createOpenAIProvider } from "./openai.mjs";

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    repo: { type: "string" }, model: { type: "string" }, check: { type: "string" },
    "max-turns": { type: "string", default: "20" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log('Usage: npm run anvil -- --repo PATH --model MODEL [--check "npm test"] [--max-turns 20] "Task"\nRequires Node.js 22+, ripgrep, and OPENAI_API_KEY injected through keygrant.\nFile edits and model-requested commands require interactive approval.');
    return;
  }
  const maxTurns = Number(values["max-turns"]);
  if (!values.repo || !values.model || positionals.length !== 1 || !positionals[0].trim()
    || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100
    || (values.check !== undefined && !values.check.trim())) throw new Error("Invalid arguments; use --help.");
  const provider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY, model: values.model });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const terminal = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  terminal?.on("SIGINT", stop);
  try {
    const tools = await createTools({ root: values.repo, signal: controller.signal,
      approve: async (action) => {
        if (!terminal) return false;
        console.log(JSON.stringify(action, null, 2));
        const answer = await terminal.question("Allow this operation? [y/N] ", { signal: controller.signal });
        return answer.trim().toLowerCase() === "y";
      },
    });
    const rg = await runProcess("rg", ["--version"], { cwd: tools.root, signal: controller.signal });
    if (rg.exitCode !== 0) throw new Error("ripgrep (rg) is required.");
    const result = await runAgent({ task: positionals[0], provider, tools, maxTurns, signal: controller.signal,
      verify: values.check ? (signal) => runProcess("/bin/sh", ["-c", values.check], { cwd: tools.root, signal }) : undefined,
      onEvent: (event) => console.log(JSON.stringify(event)),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "completed" ? 0 : result.status === "unverified" ? 2 : 1;
  } finally {
    terminal?.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch(() => {
  console.error("Anvil could not start or was interrupted. Check --help, the repository, ripgrep, and keygrant injection of OPENAI_API_KEY.");
  process.exitCode = 1;
});

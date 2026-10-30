import { parseArgs } from "node:util";
import { RESOURCE, SECRET_NAME, SmokeError, safeCode, verifyCompletion, reportFailure } from "./chatgpt-protocol.mjs";

async function probe() {
  const { values } = parseArgs({ options: { model: { type: "string" } } });
  const token = process.env[SECRET_NAME];
  if (!token) throw new SmokeError("Run this command through keygrant with ANVIL_CHATGPT_ACCESS_TOKEN.");
  const headers = { Authorization: `Bearer ${token}` };
  console.log("Checking the signed-in account's model catalog.");
  const response = await fetch(`${RESOURCE}/models`, { headers, signal: AbortSignal.timeout(30_000) });
  const catalog = await response.json().catch(() => ({}));
  if (!response.ok) throw new SmokeError(`Model discovery failed: HTTP ${response.status}, ${safeCode(catalog.error?.code)}`);
  const models = catalog.models?.filter((model) => model.visibility === "list" && typeof model.slug === "string") ?? [];
  if (!models.length) throw new SmokeError("No visible models returned for this ChatGPT account.");
  for (const model of models) console.log(`- ${model.slug}`);
  const selected = values.model ?? models[0].slug;
  if (!models.some((model) => model.slug === selected)) throw new SmokeError("Requested model is not in this account's visible catalog.");
  console.log(`Testing ${selected} with one fixed prompt (no repository content).`);
  const inference = await fetch(`${RESOURCE}/responses`, {
    method: "POST", signal: AbortSignal.timeout(120_000),
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ model: selected,
      input: [{ role: "user", content: "Reply with exactly ANVIL_OK and nothing else." }],
      store: false, stream: true }),
  });
  if (!inference.ok) {
    const failure = await inference.json().catch(() => ({}));
    throw new SmokeError(`Inference failed: HTTP ${inference.status}, ${safeCode(failure.error?.code)}`);
  }
  await verifyCompletion(inference.body);
  console.log("PASS: response.completed received with ANVIL_OK.");
}

probe().catch(reportFailure);

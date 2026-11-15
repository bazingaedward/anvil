import type { ModelProfile } from "./api";
// Local executor: never saved as an API model or synced to account configuration.
export const codexModel: ModelProfile = {
  id: "managed-codex",
  name: "Codex（本地）",
  model: "codex-default",
  provider: "ChatGPT 订阅",
  endpoint: "",
  keyRef: "",
  vision: true,
};
export const protocols = [
  "responses",
  "chat-completions",
  "anthropic",
  "google",
] as const;
export type ModelProtocol = (typeof protocols)[number];
export const providerPackages: Record<ModelProtocol, string> = {
  responses: "@opencode/ai/providers/openai/responses",
  "chat-completions": "@opencode/ai/providers/openai-compatible",
  anthropic: "@opencode/ai/providers/anthropic",
  google: "@opencode/ai/providers/google",
};
export const providerPresets: {
  id: string;
  name: string;
  protocol: ModelProtocol;
  endpoint: string;
  keyRef: string;
}[] = [
  {
    id: "openai",
    name: "OpenAI",
    protocol: "responses",
    endpoint: "https://api.openai.com/v1",
    keyRef: "OPENAI_API_KEY",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    endpoint: "https://api.anthropic.com/v1",
    keyRef: "ANTHROPIC_API_KEY",
  },
  {
    id: "google",
    name: "Google Gemini",
    protocol: "google",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    keyRef: "GOOGLE_API_KEY",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "chat-completions",
    endpoint: "https://api.deepseek.com/v1",
    keyRef: "DEEPSEEK_API_KEY",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "chat-completions",
    endpoint: "https://openrouter.ai/api/v1",
    keyRef: "OPENROUTER_API_KEY",
  },
  {
    id: "ark",
    name: "BytePlus Ark",
    protocol: "responses",
    endpoint: "https://ark.ap-southeast.bytepluses.com/api/v3",
    keyRef: "BYTEPLUS_ARK_API_KEY",
  },
];
export function modelBaseURL(
  endpoint: string,
  protocol: ModelProtocol = "responses",
) {
  if (!protocols.includes(protocol))
    throw new Error("Unsupported model protocol.");
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTPS API URL without credentials, query parameters or fragments.",
    );
  let pathname = url.pathname.replace(/\/+$/, "");
  const suffix: Record<ModelProtocol, string> = {
    responses: "/responses",
    "chat-completions": "/chat/completions",
    anthropic: "/messages",
    google: "",
  };
  const ending = suffix[protocol];
  if (ending && pathname.endsWith(ending))
    pathname = pathname.slice(0, -ending.length);
  else if (
    /\/(responses|chat\/completions|messages)$/.test(pathname) ||
    /:streamGenerateContent$|:generateContent$/.test(pathname)
  )
    throw new Error(
      "The endpoint does not match the selected protocol. Enter the API base URL.",
    );
  url.pathname = pathname;
  return url.toString().replace(/\/$/, "");
}
// Verified BytePlus deployment defaults; explicit profile overrides always win.
// Output is the documented service default budget, not a claim about its hard maximum.
export function modelTokenLimits(
  model: ModelProfile,
  endpoint = model.endpoint,
) {
  let ark = false;
  try {
    ark = new URL(endpoint).hostname === "ark.ap-southeast.bytepluses.com";
  } catch {}
  const known =
    ark &&
    ["deepseek-v4-1-flash-261017", "deepseek-v4-1-flash-260910"].includes(
      model.model,
    );
  const context = model.contextLimit ?? (known ? 1048576 : 65536);
  const output = model.outputLimit ?? Math.min(known ? 131072 : 4096, context);
  if (
    !Number.isSafeInteger(context) ||
    !Number.isSafeInteger(output) ||
    context < 256 ||
    output < 256 ||
    output > context
  )
    throw new Error(
      "输出预算不能超过上下文窗口，Token 上限必须为至少 256 的整数。",
    );
  return { context, output };
}
export function runtimeProvider(
  model: ModelProfile,
  endpoint: string,
  key: string,
) {
  const protocol = model.protocol || "responses";
  return {
    name: model.provider,
    package: providerPackages[protocol],
    settings: { apiKey: key, baseURL: modelBaseURL(endpoint, protocol) },
    models: {
      [model.model]: {
        name: model.name,
        capabilities: {
          tools: model.tools !== false,
          input: model.vision ? ["text", "image"] : ["text"],
          output: ["text"],
        },
        limit: modelTokenLimits(model, endpoint),
      },
    },
  };
}

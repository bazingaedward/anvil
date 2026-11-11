import type { ModelProfile } from "./api";
// Local executor: never saved as an API model or synced to account configuration.
export const codexModel: ModelProfile = {
  id: "managed-codex",
  name: "Codex (local)",
  model: "codex-default",
  provider: "ChatGPT subscription",
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
        limit: {
          context: model.contextLimit || 65536,
          output: model.outputLimit || 4096,
        },
      },
    },
  };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateModel, defaultModel } from "../../desktop/main/composer";
import {
  modelBaseURL,
  runtimeProvider,
  protocols,
  providerPackages,
} from "../../desktop/shared/providers";
test("protocol adapters preserve legacy Responses profiles and normalize matching endpoints", () => {
  assert.deepEqual(validateModel(defaultModel), defaultModel);
  const suffixes = ["/responses", "/chat/completions", "/messages", ""];
  protocols.forEach((protocol, i) => {
    const profile = validateModel({
      ...defaultModel,
      id: "test",
      protocol,
      endpoint: "https://example.invalid/v1" + suffixes[i],
      contextLimit: 128000,
      outputLimit: 8192,
    });
    const configured = runtimeProvider(profile, profile.endpoint, "test-key");
    assert.equal(configured.package, providerPackages[protocol]);
    assert.equal(configured.settings.baseURL, "https://example.invalid/v1");
    assert.equal(configured.models[profile.model].limit.context, 128000);
    assert.equal(configured.settings.apiKey, "test-key");
  });
  assert.throws(
    () => modelBaseURL("https://example.invalid/messages", "responses"),
    /protocol/,
  );
  assert.throws(() =>
    validateModel({ ...defaultModel, protocol: "arbitrary-package" } as any),
  );
  for (const endpoint of [
    "http://example.invalid/v1",
    "https://key@example.invalid/v1",
    "https://example.invalid/v1?key=secret",
    "https://example.invalid/v1#secret",
  ])
    assert.throws(() => modelBaseURL(endpoint, "google"));
  assert.throws(() =>
    validateModel({ ...defaultModel, contextLimit: 4096, outputLimit: 8192 }),
  );
  const text = runtimeProvider(
    { ...defaultModel, tools: false },
    "https://example.invalid/v1",
    "key",
  );
  assert.equal(text.models[defaultModel.model].capabilities.tools, false);
});

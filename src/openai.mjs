export function createOpenAIProvider({ apiKey, model, fetchImpl = fetch }) {
  if (!apiKey || !model) throw new Error("OPENAI_API_KEY and an explicit model are required.");
  return {
    async next({ instructions, messages, tools, signal }) {
      const input = messages.flatMap((message) => {
        if (message.role === "assistant") return message.state;
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.callId, output: message.content }];
        return [{ role: "user", content: message.content }];
      });
      const timeout = AbortSignal.timeout(120_000);
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, instructions, input, store: false, stream: false,
          include: ["reasoning.encrypted_content"], max_output_tokens: 8192,
          parallel_tool_calls: false,
          tools: tools.map((tool) => ({ type: "function", ...tool, strict: true })) }),
      });
      if (!response.ok) throw new Error(`Model request failed (HTTP ${response.status}).`);
      const data = await response.json();
      if (data.status !== "completed" || !Array.isArray(data.output)) throw new Error("Model response did not complete.");
      const calls = [];
      for (const item of data.output) {
        if (item.type === "function_call") {
          let args;
          try { args = JSON.parse(item.arguments); } catch { args = null; }
          calls.push({ id: item.call_id, name: item.name, arguments: args });
        } else if (!["message", "reasoning"].includes(item.type)) {
          throw new Error("Model returned an unsupported output item.");
        }
      }
      return { text: data.output.filter((item) => item.type === "message")
        .flatMap((item) => item.content).filter((item) => item.type === "output_text").map((item) => item.text).join("\n"),
      calls, state: data.output };
    },
  };
}

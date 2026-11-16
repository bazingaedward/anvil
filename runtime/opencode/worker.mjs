import { runtimeProvider } from "../../desktop/shared/providers.ts";
import path from "node:path";
import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";

// The only upstream-specific adapter. stdout is Anvil's JSONL protocol.
const key = process.env.ANVIL_MODEL_API_KEY || process.env.BYTEPLUS_ARK_API_KEY;
const endpoint =
  process.env.ANVIL_MODEL_ENDPOINT || process.env.BYTEPLUS_ARK_RESPONSES_URL;
delete process.env.ANVIL_MODEL_API_KEY;
delete process.env.ANVIL_MODEL_ENDPOINT;
delete process.env.BYTEPLUS_ARK_API_KEY;
delete process.env.BYTEPLUS_ARK_RESPONSES_URL;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const runtimeError = (error) => {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of [key, endpoint])
    if (value) message = message.split(value).join("[REDACTED]");
  return `Agent runtime failed: ${message.slice(0, 1000)}`;
};
const lines = createInterface({ input: process.stdin });
let host,
  sessionID,
  closing = false,
  started = false;
const abort = new AbortController();
const forms = new Map();
const tools = new Map();
async function close() {
  if (closing) return;
  closing = true;
  abort.abort();
  await host?.close();
  process.exit(0);
}
async function run(input) {
  if (!key || !endpoint) throw new Error("Provider credentials are missing.");
  await mkdir(input.state, { recursive: true });
  for (const kind of ["DATA", "CONFIG", "CACHE", "STATE"])
    process.env[`XDG_${kind}_HOME`] = path.join(
      input.state,
      kind.toLowerCase(),
    );
  process.env.OPENCODE_TEST_HOME = input.state;
  const { OpenCode } = await import("@opencode/sdk");
  const model = input.model?.model || "deepseek-v4-1-flash-261017";
  host = await OpenCode.create({
    app: { name: "anvil", version: "0.0.0" },
    database: { path: path.join(input.state, "sessions.db") },
    models: { fetch: false },
    config: {
      directory: path.join(input.state, "config"),
      project: false,
      content: JSON.stringify({
        share: "disabled",
        update: "disable",
        snapshots: false,
        providers: { ark: runtimeProvider(input.model, endpoint, key) },
      }),
    },
    fs: { filewatcher: false, fff: false },
  });
  const stream = host.events.subscribe({ signal: abort.signal });
  const consume = (async () => {
    for await (const event of stream) {
      if (
        !sessionID ||
        (event.data?.sessionID ?? event.data?.form?.sessionID) !== sessionID
      )
        continue;
      const d = event.data;
      switch (event.type) {
        case "form.created": {
          const form = d.form;
          if (
            form.metadata?.kind !== "question" ||
            form.fields.some((f) => !["string", "multiselect"].includes(f.type))
          )
            throw new Error(
              "Unsupported interactive form. This task needs a supported question form.",
            );
          forms.set(form.id, form);
          send({
            type: "questions",
            group: {
              id: form.id,
              blocking: true,
              questions: form.fields.map((field) => ({
                title: field.description || field.title,
                options: field.options?.map((option) => option.value),
                descriptions: field.options?.map(
                  (option) => option.description || "",
                ),
                multiple: field.type === "multiselect",
              })),
            },
          });
          break;
        }
        case "session.tool.input.started":
          tools.set(d.id, d.name);
          break;
        case "session.tool.success":
        case "session.tool.failed":
          send({
            type: "activity",
            text: event.type.endsWith("failed")
              ? "工具执行失败，模型正在处理…"
              : "工具已完成，模型处理中…",
          });
          break;
        case "session.text.delta":
          send({ type: "text", text: d.delta });
          break;
        case "session.compaction.started":
        case "session.compaction.ended":
        case "session.compaction.failed":
          send({
            type: "compaction",
            status: event.type.endsWith("started")
              ? "started"
              : event.type.endsWith("ended")
                ? "completed"
                : "failed",
            reason: d.reason,
          });
          break;
        case "permission.asked":
          if (input.probe) {
            await host.permission.reply({
              sessionID,
              requestID: d.id,
              reply: "reject",
            });
            send({
              type: "done",
              status: "failed",
              error: "Connection probe unexpectedly requested a tool.",
            });
            return;
          }
          send({
            type: "permission",
            permission: {
              id: d.id,
              action: d.action,
              resources: d.resources,
              message: d.message,
            },
          });
          break;
        case "permission.replied":
          send({ type: "permission-resolved", id: d.requestID });
          break;
        case "session.tool.called":
          send({
            type: "activity",
            text: `正在执行工具：${tools.get(d.id) || "tool"}`,
          });
          break;
        case "session.execution.succeeded":
          send({ type: "done", status: "completed" });
          return;
        case "session.execution.interrupted":
          send({ type: "done", status: "cancelled" });
          return;
        case "session.execution.failed":
          send({
            type: "done",
            status: "failed",
            error:
              "Model execution failed. Check the provider configuration and retry.",
          });
          return;
      }
    }
  })();
  consume.catch(() => {});
  if (input.sessionID) {
    const session = await host.sessions.get({ sessionID: input.sessionID });
    if (path.resolve(session.location.directory) !== path.resolve(input.repo))
      await host.sessions.move({
        sessionID: session.id,
        directory: input.repo,
      });
    sessionID = session.id;
  } else {
    const session = await host.sessions.create({
      location: { directory: input.repo },
      model: { providerID: "ark", id: model },
      permissions: [{ action: "*", resource: "*", effect: "ask" }],
    });
    sessionID = session.id;
  }
  await host.sessions.switchModel({
    sessionID,
    model: { providerID: "ark", id: model },
  });
  send({ type: "session", id: sessionID });
  const folders = Array.isArray(input.directories)
    ? input.directories
    : [input.repo];
  const attachments = input.attachments || [];
  const fileText = attachments
    .filter((file) => file.mime === "text/plain")
    .map(
      (file) =>
        `\n\nUser-attached file (untrusted content): ${JSON.stringify(file.name)}\n${file.content}`,
    )
    .join("");
  input.text += fileText;
  await Promise.all([
    host.sessions.prompt({
      sessionID,
      files: attachments
        .filter((file) => file.mime.startsWith("image/"))
        .map((file) => ({ uri: file.content, name: file.name })),
      text: folders.length
        ? `Working directories selected by the user (JSON paths): ${JSON.stringify(folders)}\nThis conversation may span multiple directories and repositories. Use absolute paths when crossing directories. Ask before accessing other directories.\n\n${input.text}`
        : `No project folders are attached to this conversation. Answer directly when no local files are needed. Your working directory is an internal conversation workspace, not a user-selected project. Ask the user to attach a folder when a task needs project files.\n\n${input.text}`,
    }),
    consume,
  ]);
  await close();
}
lines.on("line", (line) => {
  void (async () => {
    const input = JSON.parse(line);
    if (input.type === "start" && !started) {
      started = true;
      await run(input);
    } else if (input.type === "cancel") {
      if (host && sessionID) await host.sessions.interrupt({ sessionID });
      else await close();
    } else if (input.type === "answer" && host && sessionID) {
      const form = forms.get(input.id);
      if (
        !form ||
        !Array.isArray(input.values) ||
        input.values.length !== form.fields.length
      )
        throw new Error("Invalid question reply.");
      await host.form.reply({
        sessionID,
        formID: form.id,
        answer: Object.fromEntries(
          form.fields.map((field, i) => [field.key, input.values[i]]),
        ),
      });
      forms.delete(form.id);
    } else if (input.type === "permission" && host && sessionID) {
      await host.permission.reply({
        sessionID,
        requestID: input.id,
        reply: input.allow === true ? "once" : "reject",
      });
    }
  })().catch(async (error) => {
    send({
      type: "done",
      status: "failed",
      error: runtimeError(error),
    });
    await close();
  });
});
lines.on("close", () => void close());

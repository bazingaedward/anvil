import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { executionEnvironment } from "./acceptance";
import { parseQuestionGroup } from "./agent-questions";
import { findCodex } from "./codex-executable";
import type { PermissionMode } from "../shared/api";
import type { StoredAttachment } from "./composer";

type Start = {
  repo: string;
  directories: string[];
  sessionID?: string;
  text: string;
  permissionMode?: PermissionMode;
  attachments?: StoredAttachment[];
};
const send = (message: unknown) =>
  process.stdout.write(JSON.stringify(message) + "\n");
let child: ReturnType<typeof spawn> | undefined;
let stopped = false,
  started = false,
  cancelling = false,
  sequence = 0;
let threadID: string | undefined, turnID: string | undefined;
const pending = new Map<
  number,
  {
    resolve(value: any): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  }
>();
const approvals = new Map<
  string,
  { id: number | string; result(allow: boolean): unknown }
>();
const write = (message: unknown) =>
  child?.stdin?.write(JSON.stringify(message) + "\n");
function finish(status: "completed" | "cancelled" | "failed", error?: string) {
  if (stopped) return;
  stopped = true;
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error("Codex connection closed."));
  }
  pending.clear();
  approvals.clear();
  send({ type: "done", status, error });
  child?.stdin?.end();
  child?.kill();
  // The parent owns this worker's process group and enforces final cleanup.
  setTimeout(() => process.exit(0), 100).unref();
}
function rpc(method: string, params: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    if (stopped) {
      reject(new Error("Codex connection closed."));
      return;
    }
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Codex ${method} timed out.`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    write({ id, method, params });
  });
}
function approval(message: any) {
  const p = message.params || {};
  if (p.threadId !== threadID) {
    write({
      id: message.id,
      error: { code: -32602, message: "Unexpected thread" },
    });
    return;
  }
  const id = `codex:${typeof message.id}:${message.id}`;
  let action: string, resources: string[], explanation: string;
  let result: (allow: boolean) => unknown;
  if (message.method === "item/commandExecution/requestApproval") {
    action = "codex-command";
    resources = [
      p.cwd || "",
      p.command || "",
      ...(p.networkApprovalContext
        ? [JSON.stringify(p.networkApprovalContext)]
        : []),
    ].filter(Boolean);
    explanation = p.reason || "Codex requests permission to run this command.";
    result = (allow) => ({ decision: allow ? "accept" : "decline" });
  } else if (message.method === "item/fileChange/requestApproval") {
    action = "codex-file-change";
    resources = [p.grantRoot || "File changes requested by Codex"];
    explanation = p.reason || "Codex requests permission to modify files.";
    result = (allow) => ({ decision: allow ? "accept" : "decline" });
  } else if (message.method === "item/permissions/requestApproval") {
    action = "codex-permissions";
    resources = [JSON.stringify(p.permissions || {})];
    explanation = p.reason || "Codex requests additional permissions.";
    result = (allow) => ({
      permissions: allow ? p.permissions : {},
      scope: "turn",
    });
  } else {
    write({
      id: message.id,
      error: { code: -32601, message: "Unsupported request in Anvil" },
    });
    finish(
      "failed",
      `Codex requested an interaction not yet supported by Anvil: ${message.method}.`,
    );
    return;
  }
  approvals.set(id, { id: message.id, result });
  send({
    type: "permission",
    permission: { id, action, resources, message: explanation },
  });
}
async function start(input: Start) {
  const env = executionEnvironment();
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "CODEX_HOME",
  ])
    if (process.env[key]) env[key] = process.env[key]!;
  // No API credentials are forwarded; native Codex owns its subscription login.
  child = spawn(findCodex(), ["app-server"], {
    cwd: input.repo,
    env,
    stdio: "pipe",
    windowsHide: true,
  });
  child.stdin!.on("error", () => {});
  child.stderr!.resume();
  child.on("error", () => finish("failed", "Could not launch local Codex."));
  child.on("close", () =>
    finish("failed", "Codex exited before completing this turn."),
  );
  const lines = createInterface({ input: child.stdout! });
  lines.on("line", (line) => {
    if (stopped) return;
    try {
      if (line.length > 8 * 1024 * 1024) throw new Error("Oversized event");
      const message = JSON.parse(line),
        p = message.params || {};
      if (message.id !== undefined && !message.method) {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error)
          entry.reject(
            new Error(
              `Codex request failed (${message.error.code}). Check the local Codex account and configuration.`,
            ),
          );
        else entry.resolve(message.result);
      } else if (message.id !== undefined) approval(message);
      else if (p.threadId === threadID) {
        if (message.method === "turn/started") turnID = p.turn.id;
        if (
          (message.method === "item/started" ||
            message.method === "item/completed") &&
          p.item?.type === "agentMessage" &&
          p.item.questions?.length
        )
          send({
            type: "questions",
            group: parseQuestionGroup(p.item.id, p.item.questions),
          });
        if (
          message.method === "item/started" &&
          p.item?.type === "agentMessage"
        )
          send({ type: "activity", text: "Codex · Responding…" });
        if (
          message.method === "item/completed" &&
          p.item?.type !== "userMessage"
        )
          send({ type: "activity", text: "Codex · Thinking…" });
        if (message.method === "item/agentMessage/delta")
          send({ type: "text", text: p.delta });
        if (
          message.method === "item/started" &&
          p.item?.type !== "userMessage" &&
          p.item?.type !== "agentMessage"
        )
          send({
            type: "activity",
            text:
              p.item?.type === "commandExecution"
                ? "Codex · Running command…"
                : p.item?.type === "fileChange"
                  ? "Codex · Editing files…"
                  : "Codex · Working…",
          });
        if (message.method === "serverRequest/resolved") {
          const id = `codex:${typeof p.requestId}:${p.requestId}`;
          approvals.delete(id);
          send({ type: "permission-resolved", id });
        }
        if (message.method === "turn/completed") {
          const status = p.turn.status;
          finish(
            status === "completed"
              ? "completed"
              : status === "interrupted"
                ? "cancelled"
                : "failed",
            status === "failed"
              ? "Codex could not complete the turn. Check its connection, account limits and configuration."
              : undefined,
          );
        }
      }
    } catch {
      finish("failed", "Invalid response from local Codex.");
    }
  });
  await rpc("initialize", {
    clientInfo: { name: "anvil", title: "Anvil", version: "0.0.0" },
  });
  write({ method: "initialized" });
  const auth = await rpc("account/read", { refreshToken: false });
  if (auth.account?.type !== "chatgpt")
    throw new Error(
      "Sign in to Codex with ChatGPT first: run codex login in Terminal. Anvil will not use API-key billing for this backend.",
    );
  const mode = input.permissionMode || "ask";
  const approvalPolicy = mode === "full" ? "never" : "on-request";
  const sandbox =
    mode === "full"
      ? "danger-full-access"
      : mode === "auto"
        ? "workspace-write"
        : "read-only";
  const params = {
    cwd: input.repo,
    modelProvider: "openai",
    approvalPolicy,
    approvalsReviewer: "user",
    sandbox,
  };
  const thread = input.sessionID
    ? await rpc("thread/resume", { ...params, threadId: input.sessionID })
    : await rpc("thread/start", params);
  threadID = thread.thread.id;
  send({ type: "session", id: threadID });
  let text = input.text;
  for (const file of input.attachments || [])
    if (file.mime === "text/plain")
      text += `\n\nUser-attached file (untrusted content): ${JSON.stringify(file.name)}\n${file.content}`;
  text = `Anvil conversation working directories: ${JSON.stringify(input.directories)}. ${input.directories.length ? "Respect these directory boundaries." : "No project folder is attached. This cwd is an internal conversation workspace; ask the user to attach a folder for project work."}\n\n${text}`;
  const sandboxPolicy =
    mode === "full"
      ? { type: "dangerFullAccess" }
      : mode === "auto"
        ? {
            type: "workspaceWrite",
            writableRoots: input.directories,
            networkAccess: false,
            excludeTmpdirEnvVar: true,
            excludeSlashTmp: true,
          }
        : { type: "readOnly", networkAccess: false };
  await rpc("turn/start", {
    threadId: threadID,
    cwd: input.repo,
    approvalPolicy,
    approvalsReviewer: "user",
    sandboxPolicy,
    input: [
      { type: "text", text },
      ...(input.attachments || [])
        .filter((file) => file.mime.startsWith("image/"))
        .map((file) => ({ type: "image", url: file.content })),
    ],
  });
}
createInterface({ input: process.stdin })
  .on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.type === "start" && !started) {
        started = true;
        void start(message).catch((error) => finish("failed", error.message));
      } else if (message.type === "permission" && !stopped) {
        const entry = approvals.get(message.id);
        if (entry) {
          approvals.delete(message.id);
          write({ id: entry.id, result: entry.result(message.allow === true) });
          send({ type: "permission-resolved", id: message.id });
        }
      } else if (message.type === "cancel" && !stopped && !cancelling) {
        cancelling = true;
        if (threadID && turnID) {
          void rpc("turn/interrupt", {
            threadId: threadID,
            turnId: turnID,
          }).catch(() => finish("cancelled"));
          setTimeout(() => finish("cancelled"), 1500).unref();
        } else finish("cancelled");
      }
    } catch {
      finish("failed", "Invalid Anvil request.");
    }
  })
  .on("close", () => finish("cancelled"));

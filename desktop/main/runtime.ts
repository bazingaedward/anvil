import { diagnostic, diagnosticState } from "./diagnostics";
import { spawn } from "node:child_process";
import { executionEnvironment, killProcessTree } from "./acceptance";
import { parseQuestionGroup } from "./agent-questions";
import { validateModel } from "./composer";
import type { RequestTiming } from "../../runtime/opencode/request-timing";
import type {
  AgentQuestionGroup,
  QuestionAnswer,
  PermissionMode,
  ModelProfile,
} from "../shared/api";
import type { StoredAttachment } from "./composer";

// Application-facing contract. No SDK types, account state or permission policy.
export type RuntimeResult = {
  status: "completed" | "cancelled" | "failed";
  error?: string;
};
export type RuntimeEvent =
  | {
      type: "steering";
      id: string;
      status: "accepted" | "delivered" | "failed";
      error?: string;
    }
  | { type: "models"; models: ModelProfile[] }
  | {
      type: "compaction";
      status: "started" | "completed" | "failed";
      reason: "auto" | "manual";
    }
  | { type: "session"; id: string }
  | { type: "text"; text: string }
  | { type: "activity"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      summary?: string;
      status: "running" | "completed" | "failed";
    }
  | { type: "questions"; group: AgentQuestionGroup }
  | {
      type: "permission";
      permission: {
        id: string;
        action: string;
        resources: string[];
        message?: string;
      };
    }
  | { type: "permission-resolved"; id: string };
export type RuntimeInput = {
  repo: string;
  state: string;
  directories: string[];
  memoryDirectories?: string[];
  sessionID?: string;
  model?: ModelProfile;
  attachments?: StoredAttachment[];
  text: string;
  probe?: boolean;
  listModels?: boolean;
  permissionMode?: PermissionMode;
};
export type RuntimeRun = {
  done: Promise<RuntimeResult>;
  reply(id: string, allow: boolean): void;
  answer(id: string, values: QuestionAnswer[]): void;
  steer(
    id: string,
    text: string,
    attachments: StoredAttachment[],
  ): Promise<void>;
  stop(): void;
};
type Options = {
  taskID?: string;
  executable: string;
  args?: string[];
  key?: string;
  endpoint?: string;
  managed?: boolean;
  managedProxy?: string;
  signal: AbortSignal;
  onEvent(event: RuntimeEvent, reply: RuntimeRun["reply"]): void;
};

function decode(
  line: string,
): RuntimeEvent | RequestTiming | ({ type: "done" } & RuntimeResult) {
  const m = JSON.parse(line);
  if (!m || typeof m !== "object") throw new Error("Invalid event");
  if (
    m.type === "steering" &&
    typeof m.id === "string" &&
    m.id.length < 100 &&
    ["accepted", "delivered", "failed"].includes(m.status) &&
    (m.error === undefined || typeof m.error === "string")
  )
    return { type: "steering", id: m.id, status: m.status, error: m.error };
  if (
    m.type === "models" &&
    Array.isArray(m.models) &&
    m.models.length <= 200
  ) {
    const models = m.models.map(validateModel);
    if (models.some((model: ModelProfile) => model.connection !== "copilot"))
      throw new Error("Invalid Copilot model");
    return { type: "models", models };
  }
  if (
    m.type === "model-timing" &&
    typeof m.id === "string" &&
    /^\d{1,10}$/.test(m.id) &&
    [
      "started",
      "headers",
      "first-byte",
      "completed",
      "failed",
      "cancelled",
    ].includes(m.phase) &&
    Number.isSafeInteger(m.elapsedMs) &&
    m.elapsedMs >= 0 &&
    (m.status === undefined ||
      (Number.isInteger(m.status) && m.status >= 100 && m.status <= 599))
  )
    return {
      type: "model-timing",
      id: m.id,
      phase: m.phase,
      elapsedMs: m.elapsedMs,
      status: m.status,
    };
  if (
    m.type === "compaction" &&
    ["started", "completed", "failed"].includes(m.status) &&
    ["auto", "manual"].includes(m.reason)
  )
    return m;
  if (
    m.type === "tool" &&
    typeof m.id === "string" &&
    m.id.length > 0 &&
    m.id.length <= 200 &&
    typeof m.name === "string" &&
    m.name.length <= 100 &&
    ["running", "completed", "failed"].includes(m.status) &&
    (m.summary === undefined ||
      (typeof m.summary === "string" && m.summary.length <= 500))
  )
    return {
      type: "tool",
      id: m.id,
      name: m.name,
      status: m.status,
      summary: m.summary,
    };
  if (m.type === "questions")
    return {
      type: "questions",
      group: {
        ...parseQuestionGroup(m.group?.id, m.group?.questions),
        ...(m.group?.blocking === true ? { blocking: true } : {}),
      },
    };
  if (
    (m.type === "session" || m.type === "permission-resolved") &&
    typeof m.id === "string" &&
    m.id
  )
    return m;
  if (
    (m.type === "text" || m.type === "activity") &&
    typeof m.text === "string"
  )
    return m;
  if (
    m.type === "permission" &&
    typeof m.permission?.id === "string" &&
    m.permission.id &&
    typeof m.permission.action === "string" &&
    Array.isArray(m.permission.resources) &&
    m.permission.resources.every((r: unknown) => typeof r === "string") &&
    (m.permission.message === undefined ||
      typeof m.permission.message === "string")
  )
    return m;
  if (
    m.type === "done" &&
    ["completed", "cancelled", "failed"].includes(m.status) &&
    (m.error === undefined || typeof m.error === "string")
  )
    return m;
  throw new Error("Invalid event");
}

// One transport for chat and connection probes. Never retries a whole execution.
export function startRuntime(
  input: RuntimeInput,
  options: Options,
): RuntimeRun {
  if (options.signal.aborted)
    return {
      done: Promise.resolve({ status: "cancelled" }),
      reply() {},
      answer() {
        throw new Error("Runtime is not running.");
      },
      async steer() {
        throw new Error("Runtime is not running.");
      },
      stop() {},
    };
  const env = executionEnvironment();
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"])
    if (process.env[name]) env[name] = process.env[name]!;
  if (options.managed) {
    env.ELECTRON_RUN_AS_NODE = "1";
    if (process.env.CODEX_HOME) env.CODEX_HOME = process.env.CODEX_HOME;
    if (options.managedProxy)
      env.HTTPS_PROXY = env.HTTP_PROXY = options.managedProxy;
  } else {
    if (options.key) env.ANVIL_MODEL_API_KEY = options.key;
    if (options.endpoint) env.ANVIL_MODEL_ENDPOINT = options.endpoint;
  }
  const child = spawn(options.executable, options.args || [], {
    cwd: input.repo,
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: "pipe",
  });
  diagnostic("runtime.started", {
    pid: child.pid,
    taskID: options.taskID,
    backend: options.managed ? "codex" : "opencode",
  });
  diagnosticState("runtime", {
    pid: child.pid,
    taskID: options.taskID,
    status: "running",
    lastEventAt: Date.now(),
  });
  let result: RuntimeResult | undefined;
  let settled = false;
  let shutdown: NodeJS.Timeout | undefined;
  let hardStop: NodeJS.Timeout | undefined;
  let pending = "";
  let lastTextReport = 0;
  const permissions = new Set<string>();
  const questions = new Set<string>();
  const steering = new Map<
    string,
    { resolve(): void; reject(error: Error): void }
  >();
  let resolve!: (result: RuntimeResult) => void;
  const done = new Promise<RuntimeResult>((r) => {
    resolve = r;
  });
  const finish = () => {
    if (settled) return;
    settled = true;
    diagnostic("runtime.finished", {
      pid: child.pid,
      taskID: options.taskID,
      status: result?.status || "failed",
      error: result?.error,
    });
    diagnosticState("runtime", {
      pid: child.pid,
      taskID: options.taskID,
      status: result?.status || "failed",
      lastEventAt: Date.now(),
    });
    if (options.managed) killProcessTree(child);
    clearTimeout(shutdown);
    clearTimeout(hardStop);
    options.signal.removeEventListener("abort", cancel);
    permissions.clear();
    for (const entry of steering.values())
      entry.reject(
        new Error("任务已结束，无法确认补充消息送达。请检查后重新发送。"),
      );
    steering.clear();
    resolve(
      result || {
        status: "failed",
        error: "Agent runtime exited before completing the task.",
      },
    );
  };
  const terminate = () => {
    killProcessTree(child);
    if (!hardStop)
      hardStop = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
        finish();
      }, 3000);
  };
  const shutdownSoon = () => {
    if (!shutdown) shutdown = setTimeout(terminate, 2000);
  };
  const cancel = () => {
    if (settled) return;
    result = { status: "cancelled" };
    permissions.clear();
    child.stdin.write(JSON.stringify({ type: "cancel" }) + "\n");
    shutdownSoon();
  };
  const reply: RuntimeRun["reply"] = (id, allow) => {
    if (settled || result || !permissions.delete(id)) return;
    child.stdin.write(JSON.stringify({ type: "permission", id, allow }) + "\n");
  };
  const redact = (text: string) => {
    for (const value of [options.key, options.endpoint])
      if (value) text = text.split(value).join("[REDACTED]");
    return text;
  };
  child.stdin.on("error", () => {});
  child.stderr.on("data", (chunk: Buffer) =>
    diagnostic("runtime.stderr", {
      pid: child.pid,
      taskID: options.taskID,
      bytes: chunk.length,
    }),
  );
  child.once("error", () => {
    result = { status: "failed", error: "Could not start the agent runtime." };
    finish();
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (settled || result || options.signal.aborted) return;
    try {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        if (newline > 1024 * 1024) throw new Error("Oversized runtime event");
        const event = decode(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        if (event.type === "model-timing") {
          const fields = {
            pid: child.pid,
            taskID: options.taskID,
            requestID: event.id,
            phase: event.phase,
            elapsedMs: event.elapsedMs,
            httpStatus: event.status,
          };
          diagnostic("model.request", fields);
          diagnosticState("modelRequest", fields);
          continue;
        }
        if (event.type !== "text" || Date.now() - lastTextReport > 2000) {
          diagnosticState("runtime", {
            pid: child.pid,
            taskID: options.taskID,
            status: "running",
            lastEvent: event.type,
            lastEventAt: Date.now(),
          });
          if (event.type !== "text")
            diagnostic("runtime.event", {
              pid: child.pid,
              taskID: options.taskID,
              event: event.type,
              ...(event.type === "tool"
                ? { toolID: event.id, tool: event.name, status: event.status }
                : {}),
              ...(event.type === "questions"
                ? {
                    questionID: event.group.id,
                    blocking: !!event.group.blocking,
                  }
                : {}),
              ...(event.type === "activity" ? { activity: event.text } : {}),
            });
          lastTextReport = Date.now();
        }
        if (event.type === "done") {
          result = {
            status: event.status,
            error: event.error ? redact(event.error) : undefined,
          };
          permissions.clear();
          child.stdin.end();
          shutdownSoon();
          return;
        }
        if (event.type === "questions" && event.group.blocking)
          questions.add(event.group.id);
        if (event.type === "permission") permissions.add(event.permission.id);
        if (event.type === "permission-resolved") permissions.delete(event.id);
        options.onEvent(event, reply);
        if (event.type === "steering") {
          const entry = steering.get(event.id);
          if (entry) {
            steering.delete(event.id);
            if (event.status === "failed")
              entry.reject(new Error(redact(event.error || "转向失败。")));
            else entry.resolve();
          }
        }
        if (result || settled || options.signal.aborted) return;
      }
      if (pending.length > 1024 * 1024)
        throw new Error("Oversized runtime event");
    } catch {
      result = {
        status: "failed",
        error: "Invalid response from the agent runtime.",
      };
      terminate();
    }
  });
  child.once("close", (code, signal) => {
    diagnostic("runtime.exit", {
      pid: child.pid,
      taskID: options.taskID,
      code: code ?? undefined,
      signal: signal ?? undefined,
    });
    finish();
  });
  options.signal.addEventListener("abort", cancel, { once: true });
  if (options.signal.aborted) cancel();
  else child.stdin.write(JSON.stringify({ ...input, type: "start" }) + "\n");
  return {
    done,
    reply,
    answer(id, values) {
      if (settled || result || !questions.delete(id))
        throw new Error("Question is no longer pending.");
      child.stdin.write(JSON.stringify({ type: "answer", id, values }) + "\n");
    },
    steer(id, text, attachments) {
      if (settled || result || options.signal.aborted)
        return Promise.reject(new Error("任务已结束，请重新发送。"));
      return new Promise<void>((resolve, reject) => {
        steering.set(id, { resolve, reject });
        child.stdin.write(
          JSON.stringify({ type: "steer", id, text, attachments }) + "\n",
        );
      });
    },
    stop() {
      if (settled) return;
      result = { status: "cancelled" };
      terminate();
    },
  };
}

import { diagnostic, diagnosticState } from "./diagnostics";
import { spawn } from "node:child_process";
import { executionEnvironment, killProcessTree } from "./acceptance";
import { parseQuestionGroup } from "./agent-questions";
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
      type: "compaction";
      status: "started" | "completed" | "failed";
      reason: "auto" | "manual";
    }
  | { type: "session"; id: string }
  | { type: "text"; text: string }
  | { type: "activity"; text: string }
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
  permissionMode?: PermissionMode;
};
export type RuntimeRun = {
  done: Promise<RuntimeResult>;
  reply(id: string, allow: boolean): void;
  answer(id: string, values: QuestionAnswer[]): void;
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
): RuntimeEvent | ({ type: "done" } & RuntimeResult) {
  const m = JSON.parse(line);
  if (!m || typeof m !== "object") throw new Error("Invalid event");
  if (
    m.type === "compaction" &&
    ["started", "completed", "failed"].includes(m.status) &&
    ["auto", "manual"].includes(m.reason)
  )
    return m;
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
    stop() {
      if (settled) return;
      result = { status: "cancelled" };
      terminate();
    },
  };
}

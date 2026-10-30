import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import type { AgentTask } from "../shared/api";

type RecordTask = AgentTask & {
  sessionID?: string;
  directory?: string;
  runtimeState?: string;
};
export class Agent {
  private tasks: RecordTask[] = [];
  private child?: ChildProcessWithoutNullStreams;
  private active?: RecordTask;
  private timer?: NodeJS.Timeout;
  private file: string;
  private state: string;
  constructor(
    private repo: string,
    private storage: string,
    private executable: string,
    private notify: (task: AgentTask) => void,
    private credentials: Record<string, string | undefined>,
    private args: string[] = [],
  ) {
    this.state = path.join(storage, "conversations");
    mkdirSync(this.state, { recursive: true });
    this.file = path.join(this.state, "tasks.json");
    if (existsSync(this.file)) {
      const data = JSON.parse(readFileSync(this.file, "utf8"));
      if (!Array.isArray(data)) throw new Error("Invalid task history.");
      this.tasks = data;
      for (const task of this.tasks)
        if (task.status === "running") {
          task.status = "cancelled";
          task.error = "Execution stopped when Anvil closed.";
          task.permissions = [];
        }
      this.save();
    }
    this.includeDirectory(repo);
  }
  includeDirectory(directory: string) {
    const legacy = path.join(
      this.storage,
      createHash("sha256").update(directory).digest("hex"),
    );
    if (!existsSync(path.join(legacy, "tasks.json"))) return;
    const records = JSON.parse(
      readFileSync(path.join(legacy, "tasks.json"), "utf8"),
    );
    if (!Array.isArray(records)) return;
    for (const record of records)
      if (!this.tasks.some((task) => task.id === record.id)) {
        this.tasks.push({
          ...record,
          directory,
          runtimeState: path.join(legacy, "runtime"),
          permissions: [],
          status: record.status === "running" ? "cancelled" : record.status,
        });
      }
    this.save();
  }
  private save() {
    writeFileSync(this.file + ".tmp", JSON.stringify(this.tasks));
    renameSync(this.file + ".tmp", this.file);
  }
  private view(task: RecordTask): AgentTask {
    const { sessionID, directory, runtimeState, ...visible } = task;
    return structuredClone(visible);
  }
  list() {
    return this.tasks.map((task) => this.view(task));
  }
  private publish(task: RecordTask) {
    task.updated = Date.now();
    this.save();
    this.notify(this.view(task));
  }
  start(
    conversationID: string,
    text: string,
    directories: string[] = [this.repo],
    activeDirectory = this.repo,
  ) {
    if (
      typeof conversationID !== "string" ||
      !conversationID ||
      conversationID.length > 100 ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 100000
    )
      throw new Error("Invalid task.");
    if (this.child)
      throw new Error("Wait for the current task to finish or cancel it.");
    if (!existsSync(this.executable))
      throw new Error(
        "Agent runtime is not installed. Run npm run runtime:build.",
      );
    if (
      !this.credentials.BYTEPLUS_ARK_API_KEY ||
      !this.credentials.BYTEPLUS_ARK_RESPONSES_URL
    )
      throw new Error(
        "Start Anvil through keygrant with the BytePlus API key and Responses URL.",
      );
    const previous = [...this.tasks]
      .reverse()
      .find((task) => task.conversationID === conversationID && task.sessionID);
    if (!directories.length || !directories.includes(activeDirectory))
      throw new Error("Add a working directory first.");
    const directory = previous?.directory || activeDirectory;
    if (!directories.includes(directory))
      throw new Error(
        "Add this conversation’s original working directory before continuing.",
      );
    const task: RecordTask = {
      id: randomUUID(),
      conversationID,
      prompt: text.trim(),
      text: "",
      status: "running",
      permissions: [],
      updated: Date.now(),
      sessionID: previous?.sessionID,
      directory,
      runtimeState: previous?.runtimeState || path.join(this.state, "runtime"),
    };
    this.tasks.push(task);
    this.active = task;
    const env: Record<string, string> = {};
    for (const name of [
      "PATH",
      "SystemRoot",
      "WINDIR",
      "COMSPEC",
      "PATHEXT",
      "TEMP",
      "TMP",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
    ])
      if (process.env[name]) env[name] = process.env[name]!;
    for (const [name, value] of Object.entries(this.credentials))
      if (value) env[name] = value;
    const child = spawn(this.executable, this.args, {
      cwd: directory,
      env,
      windowsHide: true,
      stdio: "pipe",
    });
    this.child = child;
    let ended = false;
    const finish = (status: AgentTask["status"], error?: string) => {
      if (ended || task.status !== "running") return;
      ended = true;
      task.status = status;
      task.error = error;
      task.permissions = [];
      this.publish(task);
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => child.kill(), 5000);
    };
    child.on("error", () =>
      finish("failed", "Could not start the agent runtime."),
    );
    child.stdin.on("error", () => {});
    // Upstream stderr can contain request details. Never forward it to the UI or disk.
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (ended) return;
      try {
        if (line.length > 1024 * 1024)
          throw new Error("Oversized runtime event");
        const message = JSON.parse(line);
        if (message.type === "session" && typeof message.id === "string")
          task.sessionID = message.id;
        else if (message.type === "text" && typeof message.text === "string") {
          if (task.text.length + message.text.length > 1024 * 1024)
            throw new Error("Response too long");
          task.text += this.redact(message.text);
        } else if (
          message.type === "permission" &&
          typeof message.permission?.id === "string" &&
          typeof message.permission.action === "string" &&
          Array.isArray(message.permission.resources)
        ) {
          task.permissions.push({
            id: message.permission.id,
            action: this.redact(message.permission.action),
            resources: message.permission.resources.map((v: unknown) =>
              this.redact(String(v)),
            ),
            message:
              typeof message.permission.message === "string"
                ? this.redact(message.permission.message)
                : undefined,
          });
        } else if (message.type === "permission-resolved")
          task.permissions = task.permissions.filter(
            (p) => p.id !== message.id,
          );
        else if (
          message.type === "done" &&
          ["completed", "cancelled", "failed"].includes(message.status)
        ) {
          finish(
            message.status,
            typeof message.error === "string"
              ? this.redact(message.error)
              : undefined,
          );
          return;
        }
        this.publish(task);
      } catch {
        finish("failed", "Invalid response from the agent runtime.");
        child.kill();
      }
    });
    child.on("close", () => {
      finish("failed", "Agent runtime exited before completing the task.");
      if (this.timer) clearTimeout(this.timer);
      if (this.child === child) {
        this.child = undefined;
        this.active = undefined;
      }
    });
    this.publish(task);
    child.stdin.write(
      JSON.stringify({
        type: "start",
        repo: directory,
        directories,
        state: task.runtimeState,
        sessionID: task.sessionID,
        text: task.prompt,
      }) + "\n",
    );
    return this.view(task);
  }
  private redact(text: string) {
    for (const value of Object.values(this.credentials))
      if (value) text = text.split(value).join("[REDACTED]");
    return text;
  }
  reply(taskID: string, permissionID: string, allow: boolean) {
    if (
      typeof allow !== "boolean" ||
      this.active?.id !== taskID ||
      !this.active.permissions.some((p) => p.id === permissionID)
    )
      throw new Error("Permission request is no longer pending.");
    this.child?.stdin.write(
      JSON.stringify({ type: "permission", id: permissionID, allow }) + "\n",
    );
  }
  cancel(taskID: string) {
    if (this.active?.id !== taskID || !this.child)
      throw new Error("Task is not running.");
    const child = this.child,
      task = this.active;
    child.stdin.write(JSON.stringify({ type: "cancel" }) + "\n");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.child !== child) return;
      task.status = "cancelled";
      task.permissions = [];
      this.publish(task);
      child.kill();
    }, 5000);
  }
  stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.active?.status === "running") {
      this.active.status = "cancelled";
      this.active.permissions = [];
      this.publish(this.active);
    }
    this.child?.kill();
  }
}

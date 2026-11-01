import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  AgentTask,
  Conversation,
  ConversationPatch,
  LegacyDraft,
} from "../shared/api";

export type StoredTask = AgentTask & {
  sessionID?: string;
  directory?: string;
  runtimeState?: string;
};
type Row = {
  id: string;
  title: string;
  draft: string;
  acceptance: string | null;
  archived: number;
  created: number;
  updated: number;
};

function checkID(id: string) {
  if (typeof id !== "string" || !id || id.length > 100)
    throw new Error("Invalid conversation ID.");
}
function validatePatch(patch: ConversationPatch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Invalid conversation update.");
  if (
    Object.keys(patch).some(
      (key) => !["title", "text", "acceptance", "archived"].includes(key),
    )
  )
    throw new Error("Unknown conversation field.");
  if (
    patch.title !== undefined &&
    (typeof patch.title !== "string" ||
      !patch.title.trim() ||
      patch.title.length > 120)
  )
    throw new Error("Enter a title of 1–120 characters.");
  if (
    patch.text !== undefined &&
    (typeof patch.text !== "string" || patch.text.length > 100000)
  )
    throw new Error("Draft is too long.");
  if (patch.archived !== undefined && typeof patch.archived !== "boolean")
    throw new Error("Invalid archive state.");
  const a = patch.acceptance;
  if (
    a !== undefined &&
    (!a ||
      typeof a.command !== "string" ||
      a.command.length > 2000 ||
      a.command.includes("\0") ||
      typeof a.directory !== "string" ||
      a.directory.length > 32768 ||
      !Number.isInteger(a.maxRepairs) ||
      a.maxRepairs < 0 ||
      a.maxRepairs > 5 ||
      !Number.isInteger(a.timeoutMs) ||
      a.timeoutMs < 1000 ||
      a.timeoutMs > 600000)
  )
    throw new Error("Invalid acceptance settings.");
}

export class ConversationStore {
  private db: DatabaseSync;
  constructor(storage: string) {
    mkdirSync(storage, { recursive: true });
    this.db = new DatabaseSync(path.join(storage, "conversations.sqlite"));
    try {
      this.db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;",
      );
      const version = Number(
        this.db.prepare("PRAGMA user_version").get()!.user_version,
      );
      if (version > 1)
        throw new Error(
          "Conversation database belongs to a newer Anvil version.",
        );
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', draft TEXT NOT NULL DEFAULT '',
            acceptance TEXT, archived INTEGER NOT NULL DEFAULT 0,
            created INTEGER NOT NULL, updated INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS tasks (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            record TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS tasks_conversation ON tasks(conversation_id);
          CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS deleted_conversations (id TEXT PRIMARY KEY);
          PRAGMA user_version=1;
        `);
      });
      this.importTasks(path.join(storage, "conversations", "tasks.json"));
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private meta(key: string) {
    return this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key)
      ?.value as string | undefined;
  }
  private setMeta(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  private deleted(id: string) {
    return !!this.db
      .prepare("SELECT 1 FROM deleted_conversations WHERE id=?")
      .get(id);
  }
  private decode(row: Row): Conversation {
    return {
      id: row.id,
      title: row.title,
      text: row.draft,
      acceptance: row.acceptance ? JSON.parse(row.acceptance) : undefined,
      archived: !!row.archived,
      created: row.created,
      updated: row.updated,
    };
  }
  get(id: string): Conversation {
    checkID(id);
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id=?")
      .get(id) as Row | undefined;
    if (!row) throw new Error("Conversation no longer exists.");
    return this.decode(row);
  }
  list(): Conversation[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM conversations ORDER BY updated DESC, rowid DESC",
        )
        .all() as Row[]
    ).map((row) => this.decode(row));
  }
  ensure(id: string, created = Date.now()) {
    checkID(id);
    if (this.deleted(id)) throw new Error("Conversation was deleted.");
    this.db
      .prepare(
        "INSERT OR IGNORE INTO conversations(id,created,updated) VALUES(?,?,?)",
      )
      .run(id, created, created);
    return this.get(id);
  }
  create() {
    return this.transaction(() => {
      const value = this.ensure(randomUUID());
      this.setMeta("selected", value.id);
      return value;
    });
  }
  update(id: string, patch: ConversationPatch) {
    validatePatch(patch);
    const old = this.get(id);
    const next = {
      ...old,
      ...patch,
      title: patch.title?.trim() ?? old.title,
      updated: Math.max(Date.now(), old.updated + 1),
    };
    this.db
      .prepare(
        "UPDATE conversations SET title=?,draft=?,acceptance=?,archived=?,updated=? WHERE id=?",
      )
      .run(
        next.title,
        next.text,
        next.acceptance ? JSON.stringify(next.acceptance) : null,
        Number(next.archived),
        next.updated,
        id,
      );
    return next;
  }
  select(id: string) {
    this.get(id);
    this.setMeta("selected", id);
  }
  state() {
    const conversations = this.list();
    const selected = this.meta("selected");
    return {
      conversations,
      selected: conversations.some((c) => c.id === selected)
        ? selected!
        : conversations.find((c) => !c.archived)?.id ||
          conversations[0]?.id ||
          "",
      legacyDraftsImported: !!this.meta("drafts:v2"),
    };
  }
  tasks(): StoredTask[] {
    return this.db
      .prepare("SELECT record FROM tasks ORDER BY sequence")
      .all()
      .map((row) => JSON.parse(String(row.record)));
  }
  saveTask(task: StoredTask) {
    // Never recreate a deleted conversation when an old worker emits a late event.
    if (this.deleted(task.conversationID)) return;
    this.transaction(() => {
      this.ensure(task.conversationID, task.updated);
      this.db
        .prepare(
          "INSERT INTO tasks(id,conversation_id,record) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
        )
        .run(task.id, task.conversationID, JSON.stringify(task));
      this.db
        .prepare("UPDATE conversations SET updated=MAX(updated,?) WHERE id=?")
        .run(task.updated, task.conversationID);
    });
  }
  remove(id: string) {
    this.get(id);
    this.transaction(() => {
      this.db
        .prepare("INSERT OR IGNORE INTO deleted_conversations VALUES (?)")
        .run(id);
      this.db.prepare("DELETE FROM conversations WHERE id=?").run(id);
      if (this.meta("selected") === id)
        this.db.prepare("DELETE FROM metadata WHERE key='selected'").run();
    });
  }
  importTasks(file: string, directory?: string) {
    const marker = `tasks:${path.resolve(file)}`;
    if (this.meta(marker) || !existsSync(file)) return;
    const records: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(records))
      throw new Error(
        "Invalid legacy task history; original file was preserved.",
      );
    this.transaction(() => {
      for (const record of records) {
        if (
          !record ||
          typeof record.id !== "string" ||
          typeof record.conversationID !== "string" ||
          typeof record.prompt !== "string" ||
          typeof record.text !== "string" ||
          !Array.isArray(record.permissions) ||
          !Number.isFinite(record.updated)
        )
          throw new Error("Invalid legacy task; original file was preserved.");
        if (this.deleted(record.conversationID)) continue;
        const task: StoredTask = directory
          ? {
              ...record,
              directory,
              runtimeState: path.join(path.dirname(file), "runtime"),
              permissions: [],
            }
          : record;
        this.ensure(task.conversationID, task.updated);
        this.db
          .prepare(
            "INSERT OR IGNORE INTO tasks(id,conversation_id,record) VALUES(?,?,?)",
          )
          .run(task.id, task.conversationID, JSON.stringify(task));
      }
      this.setMeta(marker, "1");
    });
  }
  importDrafts(drafts: LegacyDraft[]) {
    if (this.meta("drafts:v2")) return;
    if (!Array.isArray(drafts) || drafts.length > 10000)
      throw new Error("Invalid legacy drafts.");
    this.transaction(() => {
      for (const draft of drafts) {
        checkID(draft?.id);
        validatePatch({ text: draft.text, acceptance: draft.acceptance });
        if (typeof draft.text !== "string")
          throw new Error("Invalid legacy draft.");
        if (this.deleted(draft.id)) continue;
        this.ensure(draft.id);
        this.update(draft.id, {
          text: draft.text,
          acceptance: draft.acceptance,
        });
      }
      this.setMeta("drafts:v2", "1");
    });
  }
  close() {
    this.db.close();
  }
}

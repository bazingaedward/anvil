import { FileMemory } from "./file-memory";

import type { DatabaseSync } from "node:sqlite";
import type { MemoryInput, Handoff } from "../shared/memory";
export const emptyHandoff = (): Handoff => ({
  goal: "",
  constraints: "",
  nextStep: "",
  enabled: false,
  memoryIDs: [],
  revision: 0,
});
function text(
  value: unknown,
  limit: number,
  required = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    (required && !value.trim())
  )
    throw Error("Invalid memory content or length.");
}
export class MemoryStore {
  readonly files: FileMemory;
  constructor(
    private db: DatabaseSync,
    root: string,
  ) {
    this.files = new FileMemory(root);
    const legacy = db.prepare("SELECT record FROM memory_notes").all();
    for (const row of legacy) {
      const note = JSON.parse(String(row.record));
      const { id, revision, updated, ...input } = note;
      // Deterministic migration names make interrupted migrations repeatable.
      this.files.save(input, id);
    }
    if (legacy.length) db.exec("DELETE FROM memory_notes");
  }
  notes() {
    return this.files.notes();
  }
  save(input: MemoryInput) {
    return this.files.save(input);
  }
  remove(id: string, revision: number) {
    this.files.remove(id, revision);
  }
  handoff(id: string): Handoff {
    const row = this.db
      .prepare("SELECT record FROM task_handoffs WHERE conversation_id=?")
      .get(id);
    return row ? JSON.parse(String(row.record)) : emptyHandoff();
  }
  saveHandoff(id: string, input: Handoff) {
    if (!input || typeof input !== "object") throw Error("Invalid handoff.");
    for (const field of ["goal", "constraints", "nextStep"] as const)
      text(input[field], 1000);
    if (
      typeof input.enabled !== "boolean" ||
      !Number.isInteger(input.revision) ||
      input.revision < 0 ||
      !Array.isArray(input.memoryIDs) ||
      input.memoryIDs.length > 8 ||
      input.memoryIDs.some((x) => typeof x !== "string") ||
      new Set(input.memoryIDs).size !== input.memoryIDs.length
    )
      throw Error("Select up to eight memories.");
    const next = {
      goal: input.goal,
      constraints: input.constraints,
      nextStep: input.nextStep,
      enabled: input.enabled,
      memoryIDs: input.memoryIDs,
      revision: input.revision + 1,
    };
    const result =
      input.revision === 0
        ? this.db
            .prepare(
              "INSERT OR IGNORE INTO task_handoffs (conversation_id,record,revision) VALUES (?,?,?)",
            )
            .run(id, JSON.stringify(next), next.revision)
        : this.db
            .prepare(
              "UPDATE task_handoffs SET record=?,revision=? WHERE conversation_id=? AND revision=?",
            )
            .run(JSON.stringify(next), next.revision, id, input.revision);
    if (result.changes !== 1)
      throw Error("Context changed elsewhere. Refresh and try again.");
  }
}

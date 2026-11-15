export type MemoryNote = {
  id: string;
  title: string;
  body: string;
  kind: "user" | "feedback" | "project" | "reference";
  scope: string | null;
  sourceTaskID: string | null;
  revision: number;
  updated: number;
};
export type MemoryInput = Omit<MemoryNote, "id" | "revision" | "updated"> & {
  id?: string;
  revision?: number;
};
export type Handoff = {
  goal: string;
  constraints: string;
  nextStep: string;
  enabled: boolean;
  memoryIDs: string[];
  revision: number;
};
export type ContextState = {
  enabled: boolean;
  directories: string[];
  notes: (MemoryNote & { sourceAvailable: boolean })[];
  handoff: Handoff;
  folders: string[];
  recent: {
    id: string;
    prompt: string;
    text: string;
    status: string;
    checks: { command: string; passed: boolean }[];
  } | null;
};

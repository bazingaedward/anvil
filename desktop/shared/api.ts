export type Entry = {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
};
export type Change = {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
};
export type RepoState = {
  root: string;
  name: string;
  branch: string;
  changes: Change[];
  git?: boolean;
  directories?: string[];
};
export type FileDocument = { path: string; content: string; version: string };
export type DiffDocument = {
  path: string;
  original: string;
  modified: string;
  note?: string;
};
export type DiffSide = "worktree" | "index";
export type TerminalEvent =
  { type: "data"; data: string } | { type: "exit"; code: number };
export type AgentPermission = {
  id: string;
  action: string;
  resources: string[];
  message?: string;
};
export type AgentTask = {
  id: string;
  conversationID: string;
  prompt: string;
  text: string;
  status: "running" | "completed" | "cancelled" | "failed";
  permissions: AgentPermission[];
  error?: string;
  updated: number;
};
export interface DesktopAPI {
  selectDirectory(root: string): Promise<RepoState | null>;
  tasks(): Promise<AgentTask[]>;
  startTask(conversationID: string, text: string): Promise<AgentTask>;
  cancelTask(id: string): Promise<void>;
  replyPermission(
    taskID: string,
    permissionID: string,
    allow: boolean,
  ): Promise<void>;
  onTask(listener: (task: AgentTask) => void): () => void;
  restore(): Promise<RepoState | null>;
  openRepository(): Promise<RepoState | null>;
  status(): Promise<RepoState>;
  list(path: string): Promise<Entry[]>;
  read(path: string): Promise<FileDocument>;
  save(document: FileDocument): Promise<FileDocument>;
  diff(path: string, side: DiffSide): Promise<DiffDocument>;
  setDirty(dirty: boolean): void;
  confirmDiscard(): Promise<boolean>;
  startTerminal(): Promise<void>;
  terminalInput(data: string): void;
  terminalResize(cols: number, rows: number): void;
  onTerminal(listener: (event: TerminalEvent) => void): () => void;
  onSave(listener: () => void): () => void;
}

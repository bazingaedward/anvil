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
  status:
    "running" | "completed" | "unverified" | "cancelled" | "failed" | "limit";
  phase?: "working" | "checking" | "repairing" | "stopping";
  round?: number;
  acceptance?: AcceptanceOptions;
  checks?: AcceptanceRun[];
  permissions: AgentPermission[];
  error?: string;
  updated: number;
};
export type AcceptanceOptions = {
  command: string;
  directory: string;
  maxRepairs: number;
  timeoutMs: number;
};
export type AcceptanceRun = {
  round: number;
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  durationMs: number;
  error?: string;
};
export type PermissionMode = "ask" | "auto" | "full";
export type ConversationGroup = {
  id: string;
  name: string;
  collapsed: boolean;
  created: number;
};
export type Conversation = {
  groupID?: string | null;
  pinned?: boolean;
  permissionMode?: PermissionMode;
  folders?: string[];
  id: string;
  title: string;
  text: string;
  acceptance?: AcceptanceOptions;
  archived: boolean;
  created: number;
  updated: number;
};
export type ConversationPatch = Partial<
  Pick<
    Conversation,
    "title" | "text" | "acceptance" | "archived" | "groupID" | "pinned"
  >
>;
export type LegacyDraft = {
  id: string;
  text: string;
  acceptance?: AcceptanceOptions;
};
export type ConversationState = {
  groups: ConversationGroup[];
  conversations: Conversation[];
  selected: string;
  legacyDraftsImported: boolean;
};
export interface DesktopAPI {
  createGroup(
    name: string,
    conversationID?: string,
  ): Promise<ConversationGroup>;
  updateGroup(
    id: string,
    patch: { name?: string; collapsed?: boolean },
  ): Promise<ConversationGroup>;
  deleteGroup(id: string): Promise<boolean>;
  setPermissionMode(
    id: string,
    mode: PermissionMode,
  ): Promise<Conversation | null>;
  addConversationFolders(id: string): Promise<Conversation | null>;
  revokeConversationFolder(id: string, root: string): Promise<Conversation>;
  conversations(drafts?: LegacyDraft[]): Promise<ConversationState>;
  createConversation(): Promise<Conversation>;
  updateConversation(
    id: string,
    patch: ConversationPatch,
  ): Promise<Conversation>;
  selectConversation(id: string): Promise<void>;
  deleteConversation(id: string): Promise<boolean>;
  readonly platform: string;
  showApplicationMenu(): Promise<void>;
  selectDirectory(root: string): Promise<RepoState | null>;
  tasks(): Promise<AgentTask[]>;
  startTask(
    conversationID: string,
    text: string,
    acceptance?: AcceptanceOptions,
  ): Promise<AgentTask>;
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

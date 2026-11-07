export type CloudConfig = {
  models: ModelProfile[];
  groups: { id: string; name: string }[];
  preferences: { defaultModelID: string };
};
export type AccountUser = {
  id: string;
  email: string;
  name: string;
  expires: number;
};
export type AccountState = {
  user: AccountUser | null;
  revision: number;
  config?: CloudConfig;
  pending: boolean;
};
export type AccountDevice = {
  id: string;
  device: string;
  created: number;
  expires: number;
  current: boolean;
};
export type ModelProfile = {
  id: string;
  name: string;
  model: string;
  provider: string;
  endpoint: string;
  keyRef: string;
  vision: boolean;
};
export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
};
export type MessageOptions = { modelID?: string; attachmentIDs?: string[] };
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
  model?: ModelProfile;
  attachments?: Attachment[];
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
export type ReviewCommit = {
  hash: string;
  parents: string[];
  title: string;
  author: string;
  date: string;
  refs: string[];
};
export type ReviewHistory = { commits: ReviewCommit[]; branches: string[] };
export type ReviewOptions = {
  branch?: string;
  remotes?: boolean;
  stash?: boolean;
};
export interface DesktopAPI {
  accountStatus(refresh?: boolean): Promise<AccountState>;
  accountLogin(): Promise<void>;
  accountPoll(): Promise<AccountState>;
  accountLogout(): Promise<void>;
  accountDevices(): Promise<AccountDevice[]>;
  revokeDevice(id: string): Promise<void>;
  setDefaultModel(id: string): Promise<AccountState>;
  reorderGroups(ids: string[]): Promise<AccountState>;
  onAccountChange(listener: () => void): () => void;

  models(): Promise<ModelProfile[]>;
  saveModel(profile: ModelProfile): Promise<ModelProfile[]>;
  deleteModel(id: string): Promise<ModelProfile[]>;
  testModel(id: string): Promise<void>;
  pickAttachments(): Promise<Attachment[]>;
  uploadAttachment(name: string, bytes: Uint8Array): Promise<Attachment>;

  openReviewRepository(): Promise<string | null>;
  reviewStatus(root: string): Promise<RepoState>;
  reviewHistory(
    root: string,
    limit: number,
    options?: ReviewOptions,
  ): Promise<ReviewHistory>;
  reviewPatch(root: string, head: string, base?: string): Promise<string>;
  reviewDiff(root: string, file: string, side: DiffSide): Promise<DiffDocument>;
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
  forkConversation(taskID: string): Promise<Conversation>;
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
    options?: MessageOptions,
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

import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, TerminalEvent, AgentTask } from "../shared/api";
const api: DesktopAPI = {
  accountStatus: (refresh) => ipcRenderer.invoke("account:status", refresh),
  accountLogin: () => ipcRenderer.invoke("account:login"),
  accountPoll: () => ipcRenderer.invoke("account:poll"),
  accountLogout: () => ipcRenderer.invoke("account:logout"),
  accountDevices: () => ipcRenderer.invoke("account:devices"),
  revokeDevice: (id) => ipcRenderer.invoke("account:revoke", id),
  setDefaultModel: (id) => ipcRenderer.invoke("account:default-model", id),
  reorderGroups: (ids) => ipcRenderer.invoke("account:reorder-groups", ids),
  onAccountChange: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("account:changed", handler);
    return () => {
      ipcRenderer.removeListener("account:changed", handler);
    };
  },

  models: () => ipcRenderer.invoke("composer:models"),
  saveModel: (profile) => ipcRenderer.invoke("composer:save-model", profile),
  deleteModel: (id) => ipcRenderer.invoke("composer:delete-model", id),
  testModel: (id) => ipcRenderer.invoke("composer:test-model", id),
  pickAttachments: () => ipcRenderer.invoke("composer:pick"),
  uploadAttachment: (name, bytes) =>
    ipcRenderer.invoke("composer:upload", name, bytes),
  openReviewRepository: () => ipcRenderer.invoke("review:open"),
  fetchRemotes: (root) => ipcRenderer.invoke("review:fetch", root),
  reviewStatus: (root) => ipcRenderer.invoke("review:status", root),
  reviewHistory: (root, limit, options) =>
    ipcRenderer.invoke("review:history", root, limit, options),
  reviewPatch: (root, head, base) =>
    ipcRenderer.invoke("review:patch", root, head, base),
  reviewDiff: (root, file, side) =>
    ipcRenderer.invoke("review:diff", root, file, side),
  createGroup: (name, conversationID) =>
    ipcRenderer.invoke("groups:create", name, conversationID),
  updateGroup: (id, patch) => ipcRenderer.invoke("groups:update", id, patch),
  deleteGroup: (id) => ipcRenderer.invoke("groups:delete", id),
  setPermissionMode: (id, mode) =>
    ipcRenderer.invoke("conversations:permission-mode", id, mode),
  addConversationFolders: (id) =>
    ipcRenderer.invoke("conversations:add-folders", id),
  revokeConversationFolder: (id, root) =>
    ipcRenderer.invoke("conversations:revoke-folder", id, root),
  conversations: (drafts) => ipcRenderer.invoke("conversations:list", drafts),
  forkConversation: (taskID) =>
    ipcRenderer.invoke("conversations:fork", taskID),
  createConversation: () => ipcRenderer.invoke("conversations:create"),
  updateConversation: (id, patch) =>
    ipcRenderer.invoke("conversations:update", id, patch),
  selectConversation: (id) => ipcRenderer.invoke("conversations:select", id),
  deleteConversation: (id) => ipcRenderer.invoke("conversations:delete", id),
  platform: process.platform,
  showApplicationMenu: () => ipcRenderer.invoke("window:menu"),
  selectDirectory: (root) => ipcRenderer.invoke("workspace:select", root),
  tasks: () => ipcRenderer.invoke("agent:tasks"),
  startTask: (id, text, acceptance, options) =>
    ipcRenderer.invoke("agent:start", id, text, acceptance, options),
  cancelTask: (id) => ipcRenderer.invoke("agent:cancel", id),
  replyPermission: (task, id, allow) =>
    ipcRenderer.invoke("agent:permission", task, id, allow),
  onTask: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, task: AgentTask) =>
      listener(task);
    ipcRenderer.on("agent:task", handler);
    return () => ipcRenderer.removeListener("agent:task", handler);
  },
  restore: () => ipcRenderer.invoke("workspace:restore"),
  openRepository: () => ipcRenderer.invoke("workspace:open"),
  status: () => ipcRenderer.invoke("workspace:status"),
  list: (path) => ipcRenderer.invoke("workspace:list", path),
  read: (path) => ipcRenderer.invoke("workspace:read", path),
  save: (document) => ipcRenderer.invoke("workspace:save", document),
  diff: (path, side) => ipcRenderer.invoke("workspace:diff", path, side),
  confirmDiscard: () => ipcRenderer.invoke("editor:discard"),
  setDirty: (dirty) => ipcRenderer.send("editor:dirty", dirty),
  startTerminal: () => ipcRenderer.invoke("terminal:start"),
  terminalInput: (data) => ipcRenderer.send("terminal:input", data),
  terminalResize: (cols, rows) =>
    ipcRenderer.send("terminal:resize", cols, rows),
  onTerminal: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TerminalEvent) =>
      listener(data);
    ipcRenderer.on("terminal:event", handler);
    return () => {
      ipcRenderer.removeListener("terminal:event", handler);
    };
  },
  onSave: (listener) => {
    ipcRenderer.on("editor:save", listener);
    return () => {
      ipcRenderer.removeListener("editor:save", listener);
    };
  },
};
contextBridge.exposeInMainWorld("anvil", api);

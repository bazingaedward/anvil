import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, TerminalEvent, AgentTask } from "../shared/api";
const api: DesktopAPI = {
  conversations: (drafts) => ipcRenderer.invoke("conversations:list", drafts),
  createConversation: () => ipcRenderer.invoke("conversations:create"),
  updateConversation: (id, patch) =>
    ipcRenderer.invoke("conversations:update", id, patch),
  selectConversation: (id) => ipcRenderer.invoke("conversations:select", id),
  deleteConversation: (id) => ipcRenderer.invoke("conversations:delete", id),
  platform: process.platform,
  showApplicationMenu: () => ipcRenderer.invoke("window:menu"),
  selectDirectory: (root) => ipcRenderer.invoke("workspace:select", root),
  tasks: () => ipcRenderer.invoke("agent:tasks"),
  startTask: (id, text, acceptance) =>
    ipcRenderer.invoke("agent:start", id, text, acceptance),
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

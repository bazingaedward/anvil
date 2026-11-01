import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { Workspace } from "./workspace";
import { Agent } from "./agent";
import type {
  FileDocument,
  DiffSide,
  TerminalEvent,
  AcceptanceOptions,
  ConversationPatch,
  LegacyDraft,
} from "../shared/api";

const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow;
let workspace: Workspace | undefined;
let directories: string[] = [];
let agent: Agent | undefined;
const providerCredentials = {
  BYTEPLUS_ARK_API_KEY: process.env.BYTEPLUS_ARK_API_KEY,
  BYTEPLUS_ARK_RESPONSES_URL: process.env.BYTEPLUS_ARK_RESPONSES_URL,
};
delete process.env.BYTEPLUS_ARK_API_KEY;
delete process.env.BYTEPLUS_ARK_RESPONSES_URL;
function currentAgent() {
  return (agent ??= new Agent(
    workspace?.root || app.getPath("userData"),
    path.join(app.getPath("userData"), "tasks"),
    app.isPackaged
      ? path.join(process.resourcesPath, "runtime/anvil-runtime.exe")
      : path.resolve(here, "../../runtime/opencode/dist/anvil-runtime.exe"),
    (task) => {
      if (!window.isDestroyed()) window.webContents.send("agent:task", task);
    },
    providerCredentials,
  ));
}
let terminal: pty.IPty | undefined;
let dirty = false;
let closing = false;
let prompting = false;
const settingsFile = () => path.join(app.getPath("userData"), "workspace.json");
const sendTerminal = (event: TerminalEvent) => {
  if (!window.isDestroyed()) window.webContents.send("terminal:event", event);
};
function stopTerminal() {
  const old = terminal;
  terminal = undefined;
  old?.kill();
}
function current() {
  if (!workspace) throw new Error("Add a working directory first.");
  return workspace;
}
async function discardChanges() {
  if (!dirty) return true;
  const result = await dialog.showMessageBox(window, {
    type: "warning",
    title: "Unsaved changes",
    message: "Discard your unsaved edits?",
    detail: "Your changes have not been saved to disk.",
    buttons: ["Keep editing", "Discard changes"],
    defaultId: 0,
    cancelId: 0,
  });
  return result.response === 1;
}
async function selectRepository(root: string) {
  const next = await Workspace.open(root);
  const status = await next.status();
  if (!directories.includes(next.root)) directories.push(next.root);
  await writeFile(
    settingsFile(),
    JSON.stringify({ root: next.root, directories }),
    "utf8",
  );
  if (workspace?.root !== next.root) {
    stopTerminal();
  }
  workspace = next;
  dirty = false;
  window.setTitle(`${status.name} — Anvil`);
  currentAgent().includeDirectory(next.root);
  return { ...status, directories: [...directories] };
}
function registerIPC() {
  const trusted = (
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  ) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Untrusted IPC sender.");
  };
  const handle = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => {
      trusted(event);
      return fn(...args);
    });
  };
  handle("workspace:restore", async () => {
    try {
      const stored = JSON.parse(await readFile(settingsFile(), "utf8"));
      directories = Array.isArray(stored.directories)
        ? stored.directories.filter(
            (value: unknown) => typeof value === "string",
          )
        : [];
      return await selectRepository(stored.root);
    } catch {
      return null;
    }
  });
  handle("window:menu", () => {
    Menu.getApplicationMenu()?.popup({ window, x: 8, y: 36 });
  });
  handle("workspace:open", async () => {
    if (!(await discardChanges())) return null;
    const result = await dialog.showOpenDialog(window, {
      title: "Add working directories",
      properties: ["openDirectory", "multiSelections"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const opened = await Promise.all(
      result.filePaths.map((root) => Workspace.open(root)),
    );
    for (const item of opened)
      if (!directories.includes(item.root)) directories.push(item.root);
    return selectRepository(opened[0].root);
  });
  handle("workspace:select", async (root: string) => {
    if (!directories.includes(root))
      throw new Error("Directory has not been added.");
    if (!(await discardChanges())) return null;
    return selectRepository(root);
  });
  handle("editor:discard", discardChanges);
  handle("workspace:status", async () => ({
    ...(await current().status()),
    directories: [...directories],
  }));
  handle("agent:tasks", () => currentAgent().list());
  handle("conversations:list", (drafts?: LegacyDraft[]) =>
    currentAgent().conversations(drafts),
  );
  handle("conversations:create", () => currentAgent().createConversation());
  handle("conversations:update", (id: string, patch: ConversationPatch) =>
    currentAgent().updateConversation(id, patch),
  );
  handle("conversations:select", (id: string) =>
    currentAgent().selectConversation(id),
  );
  handle("conversations:delete", async (id: string) => {
    const executor = currentAgent();
    const conversation = executor
      .conversations()
      .conversations.find((item) => item.id === id);
    if (!conversation) throw new Error("Conversation no longer exists.");
    const tasks = executor.list().filter((task) => task.conversationID === id);
    const running = tasks.some((task) => task.status === "running");
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Delete conversation",
      message: `Delete “${conversation.title || tasks[0]?.prompt.slice(0, 48) || "New conversation"}”?`,
      detail: running
        ? "The running task will be stopped, then this conversation and its messages will be removed. Project files will be kept."
        : "This conversation and its messages will be removed. Project files will be kept.",
      buttons: [
        "Keep conversation",
        running ? "Stop and delete" : "Delete conversation",
      ],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return false;
    await executor.deleteConversation(id);
    return true;
  });
  handle(
    "agent:start",
    (id: string, text: string, acceptance?: AcceptanceOptions) =>
      currentAgent().start(id, text, directories, current().root, acceptance),
  );
  handle("agent:cancel", (id: string) => currentAgent().cancel(id));
  handle("agent:permission", (task: string, id: string, allow: boolean) =>
    currentAgent().reply(task, id, allow),
  );
  handle("workspace:list", (relative: string) => current().list(relative));
  handle("workspace:read", (relative: string) => current().read(relative));
  handle("workspace:save", (document: FileDocument) =>
    current().save(document),
  );
  handle("workspace:diff", (relative: string, side: DiffSide) =>
    current().diff(relative, side),
  );
  ipcMain.on("editor:dirty", (event, value) => {
    trusted(event);
    dirty = value === true;
    window.setDocumentEdited(dirty);
  });
  handle("terminal:start", () => {
    const repo = current();
    stopTerminal();
    const env: Record<string, string> = {};
    // A terminal does not inherit model credentials or the app's arbitrary environment.
    const allowed = [
      "PATH",
      "HOME",
      "USERPROFILE",
      "USER",
      "LOGNAME",
      "SHELL",
      "SystemRoot",
      "WINDIR",
      "COMSPEC",
      "PATHEXT",
      "APPDATA",
      "LOCALAPPDATA",
      "TEMP",
      "TMP",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "SSH_AUTH_SOCK",
      "HOMEDRIVE",
      "HOMEPATH",
    ];
    for (const key of allowed)
      if (process.env[key]) env[key] = process.env[key]!;
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    const shell =
      process.platform === "win32"
        ? "powershell.exe"
        : process.env.SHELL || "/bin/zsh";
    const child = pty.spawn(
      shell,
      process.platform === "win32" ? ["-NoLogo"] : ["-l"],
      {
        name: "xterm-256color",
        cwd: repo.root,
        env,
        cols: 100,
        rows: 14,
      },
    );
    terminal = child;
    child.onData((data) => {
      if (terminal === child) sendTerminal({ type: "data", data });
    });
    child.onExit(({ exitCode }) => {
      if (terminal === child) {
        terminal = undefined;
        sendTerminal({ type: "exit", code: exitCode });
      }
    });
  });
  ipcMain.on("terminal:input", (event, data) => {
    trusted(event);
    if (typeof data === "string" && data.length <= 64 * 1024)
      terminal?.write(data);
  });
  ipcMain.on("terminal:resize", (event, cols, rows) => {
    trusted(event);
    if (
      Number.isInteger(cols) &&
      Number.isInteger(rows) &&
      cols >= 2 &&
      cols <= 500 &&
      rows >= 1 &&
      rows <= 300
    )
      terminal?.resize(cols, rows);
  });
}

if (process.env.ANVIL_TEST_USER_DATA)
  app.setPath("userData", process.env.ANVIL_TEST_USER_DATA);
app.whenReady().then(() => {
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#1b1b1b",
    title: "Anvil",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#1b1b1b", symbolColor: "#d4d4d4", height: 36 },
    webPreferences: {
      preload: path.join(here, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on("did-start-loading", stopTerminal);
  window.on("close", (event) => {
    if (!dirty || closing) {
      stopTerminal();
      return;
    }
    event.preventDefault();
    if (prompting) return;
    prompting = true;
    void discardChanges()
      .then((discard) => {
        if (discard) {
          closing = true;
          window.close();
        }
      })
      .finally(() => {
        prompting = false;
      });
  });
  window.on("closed", () => {
    stopTerminal();
    agent?.stop();
  });
  registerIPC();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "Save",
            accelerator: "CmdOrCtrl+S",
            click: () => window.webContents.send("editor:save"),
          },
          { role: "close" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "toggleDevTools" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
    ]),
  );
  if (process.platform !== "darwin") window.setMenuBarVisibility(false);
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(path.join(here, "../renderer/index.html"));
});
app.on("window-all-closed", () => app.quit());

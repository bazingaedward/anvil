import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { Workspace } from "./workspace";
import type { FileDocument, DiffSide, TerminalEvent } from "../shared/api";

const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow;
let workspace: Workspace | undefined;
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
  if (!workspace) throw new Error("Open a Git repository first.");
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
  await writeFile(settingsFile(), JSON.stringify({ root: next.root }), "utf8");
  if (workspace?.root !== next.root) stopTerminal();
  workspace = next;
  dirty = false;
  window.setTitle(`${status.name} — Anvil`);
  return status;
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
      return await selectRepository(stored.root);
    } catch {
      return null;
    }
  });
  handle("workspace:open", async () => {
    if (!(await discardChanges())) return null;
    const result = await dialog.showOpenDialog(window, {
      title: "Open Git repository",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return selectRepository(result.filePaths[0]);
  });
  handle("editor:discard", discardChanges);
  handle("workspace:status", () => current().status());
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
    backgroundColor: "#171b22",
    title: "Anvil",
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
  window.on("closed", stopTerminal);
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
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(path.join(here, "../renderer/index.html"));
});
app.on("window-all-closed", () => app.quit());

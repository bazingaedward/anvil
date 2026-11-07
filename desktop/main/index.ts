import { Account } from "./account";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, cp, access } from "node:fs/promises";
import { ComposerStore, validateModel } from "./composer";
import { reviewHistory, reviewPatch } from "./review";
import { realpath } from "node:fs/promises";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
} from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { Workspace } from "./workspace";
import { Agent } from "./agent";
import type {
  FileDocument,
  PermissionMode,
  DiffSide,
  TerminalEvent,
  AcceptanceOptions,
  ConversationPatch,
} from "../shared/api";

const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow;
let workspace: Workspace | undefined;
let directories: string[] = [];
let agent: Agent | undefined;
if (process.env.ANVIL_TEST_USER_DATA)
  app.setPath("userData", process.env.ANVIL_TEST_USER_DATA);
let dataRoot = app.getPath("userData");
let account: Account;
let activeUser = "";
let composerStore = new ComposerStore(
  path.join(app.getPath("userData"), "composer"),
);
const providerCredentials: Record<string, string | undefined> = {
  BYTEPLUS_ARK_API_KEY: process.env.BYTEPLUS_ARK_API_KEY,
  BYTEPLUS_ARK_RESPONSES_URL: process.env.BYTEPLUS_ARK_RESPONSES_URL,
};
for (const profile of composerStore.models()) {
  if (!(profile.keyRef in providerCredentials))
    providerCredentials[profile.keyRef] = process.env[profile.keyRef];
  delete process.env[profile.keyRef];
}
delete process.env.BYTEPLUS_ARK_API_KEY;
delete process.env.BYTEPLUS_ARK_RESPONSES_URL;
function currentAgent() {
  const runtime =
    process.platform === "win32" ? "anvil-runtime.exe" : "anvil-runtime";
  return (agent ??= new Agent(
    workspace?.root || app.getPath("userData"),
    path.join(dataRoot, "tasks"),
    app.isPackaged
      ? path.join(process.resourcesPath, "runtime", runtime)
      : path.resolve(here, "../../runtime/opencode/dist", runtime),
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
const settingsFile = () => path.join(dataRoot, "workspace.json");
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
function announceAccount() {
  if (!window.isDestroyed()) window.webContents.send("account:changed");
}
async function deactivate() {
  stopTerminal();
  await agent?.close();
  agent = undefined;
  workspace = undefined;
  directories = [];
  activeUser = "";
  dirty = false;
}
function applyConfig() {
  const config = account.snapshot?.config;
  if (!config) return;
  composerStore.replaceProfiles(config.models);
  currentAgent().replaceGroups(config.groups);
  for (const profile of config.models) {
    if (!(profile.keyRef in providerCredentials))
      providerCredentials[profile.keyRef] = process.env[profile.keyRef];
    delete process.env[profile.keyRef];
  }
}
let activation: Promise<void> | undefined;
function activateAccount() {
  return (activation ??= activateProfile().finally(() => {
    activation = undefined;
  }));
}
async function activateProfile() {
  const user = await account.require();
  if (activeUser === user.id) return;
  await deactivate();
  dataRoot = path.join(
    app.getPath("userData"),
    "accounts",
    createHash("sha256").update(user.id).digest("hex"),
  );
  await mkdir(dataRoot, { recursive: true });
  const marker = path.join(app.getPath("userData"), "legacy-account-imported");
  try {
    await access(marker);
  } catch {
    try {
      await access(path.join(app.getPath("userData"), "tasks"));
      const answer = await dialog.showMessageBox(window, {
        type: "question",
        message: "Keep existing local chats with this account?",
        detail: `Import this computer’s chats and model profiles into ${user.email}. Chats and folder permissions stay on this computer.`,
        buttons: ["Start fresh", "Import local data"],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response === 1) {
        for (const item of ["tasks", "composer", "workspace.json"]) {
          const source = path.join(app.getPath("userData"), item);
          try {
            await access(source);
          } catch {
            continue;
          }
          await cp(source, path.join(dataRoot, item), {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
        }
      }
      await writeFile(marker, user.id, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  composerStore = new ComposerStore(path.join(dataRoot, "composer"));
  await account.refresh();
  if (account.snapshot!.revision === 0) {
    const models = composerStore.models();
    const groups = currentAgent()
      .conversations()
      .groups.map(({ id, name }) => ({ id, name }));
    try {
      await account.mutate(() => ({
        models,
        groups,
        preferences: { defaultModelID: models[0].id },
      }));
    } catch (error) {
      await account.refresh();
      if (account.snapshot!.revision === 0) throw error;
    }
  }
  applyConfig();
  activeUser = user.id;
}
async function changeConfig(change: Parameters<Account["mutate"]>[0]) {
  const state = await account.mutate(change);
  applyConfig();
  announceAccount();
  return state;
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
      try {
        if (!channel.startsWith("account:") && channel !== "window:menu")
          await activateAccount();
        return await fn(...args);
      } catch (error) {
        if (!account.user && activeUser) {
          await deactivate();
          announceAccount();
        }
        throw error;
      }
    });
  };
  handle("account:status", async (refresh = false) => {
    try {
      await activateAccount();
      if (refresh) {
        await account.refresh();
        applyConfig();
        announceAccount();
      }
    } catch (error) {
      if (account.hasSession) throw error;
      if (activeUser) {
        await deactivate();
        announceAccount();
      }
    }
    return account.state();
  });
  handle("account:login", async () => {
    if (account.user) return;
    await shell.openExternal(await account.begin());
  });
  handle("account:poll", async () => {
    if (await account.poll()) await activateAccount();
    return account.state();
  });
  handle("account:logout", async () => {
    if (!(await discardChanges())) return;
    try {
      await account.logout();
    } finally {
      await deactivate();
      announceAccount();
    }
  });
  handle("account:devices", () => account.devices());
  handle("account:revoke", async (id: string) => {
    await account.revoke(id);
    await account.refresh();
  });
  handle("account:default-model", async (id: string) => {
    await activateAccount();
    return changeConfig((c) => {
      if (!c.models.some((m) => m.id === id)) throw new Error("Unknown model.");
      c.preferences.defaultModelID = id;
      return c;
    });
  });
  handle("account:reorder-groups", async (ids: string[]) => {
    await activateAccount();
    return changeConfig((c) => {
      if (
        !Array.isArray(ids) ||
        ids.length !== c.groups.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !c.groups.some((g) => g.id === id))
      )
        throw new Error("Invalid group order.");
      c.groups = ids.map((id) => c.groups.find((g) => g.id === id)!);
      return c;
    });
  });
  const reviewWorkspace = async (root: string) => {
    if (typeof root !== "string" || !directories.includes(root))
      throw new Error("Add this repository before reviewing it.");
    const workspace = await Workspace.open(root);
    if (workspace.root !== root || !(await workspace.status()).git)
      throw new Error("Select the repository root explicitly.");
    return workspace;
  };
  handle("review:open", async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: "Open repository for review",
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const next = await Workspace.open(picked.filePaths[0]);
    if (!(await next.status()).git)
      throw new Error("Select a Git repository root.");
    if (!directories.includes(next.root)) directories.push(next.root);
    await writeFile(
      settingsFile(),
      JSON.stringify({ root: workspace?.root || next.root, directories }),
      "utf8",
    );
    return next.root;
  });
  handle("review:status", async (root: string) =>
    (await reviewWorkspace(root)).status(),
  );
  handle(
    "review:history",
    async (
      root: string,
      limit: number,
      options?: import("../shared/api").ReviewOptions,
    ) => {
      await reviewWorkspace(root);
      return reviewHistory(root, limit, options);
    },
  );
  handle("review:patch", async (root: string, head: string, base?: string) => {
    await reviewWorkspace(root);
    return reviewPatch(root, head, base);
  });
  handle("review:diff", async (root: string, file: string, side: DiffSide) => {
    if (!["index", "worktree"].includes(side))
      throw new Error("Invalid diff side.");
    return (await reviewWorkspace(root)).diff(file, side);
  });
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
  handle(
    "conversations:permission-mode",
    async (id: string, mode: PermissionMode) => {
      const executor = currentAgent();
      const conversation = executor
        .conversations()
        .conversations.find((item) => item.id === id);
      if (!conversation) throw new Error("Conversation no longer exists.");
      if (!["ask", "auto", "full"].includes(mode))
        throw new Error("Invalid permission mode.");
      if (mode === "full" && conversation.permissionMode !== "full") {
        const approval = await dialog.showMessageBox(window, {
          type: "warning",
          title: "Full access",
          message: "Allow unrestricted tool execution in this conversation?",
          detail:
            "Anvil will approve file operations and commands without asking, including outside attached folders. Tools run with your operating system account’s access. This is not a sandbox. The mode is saved for this conversation.",
          buttons: ["Cancel", "Allow full access"],
          defaultId: 0,
          cancelId: 0,
        });
        if (approval.response !== 1) return null;
      }
      return executor.setPermissionMode(id, mode);
    },
  );
  handle("conversations:add-folders", async (id: string) => {
    const executor = currentAgent();
    if (!executor.conversations().conversations.some((item) => item.id === id))
      throw new Error("Conversation no longer exists.");
    if (!(await discardChanges())) return null;
    const picked = await dialog.showOpenDialog(window, {
      title: "Add local folders to this conversation",
      properties: ["openDirectory", "multiSelections"],
    });
    if (picked.canceled || !picked.filePaths.length) return null;
    const roots = await Promise.all(
      picked.filePaths.map((root) => realpath(root)),
    );
    const approval = await dialog.showMessageBox(window, {
      type: "question",
      title: "Authorize folder access",
      message: "Allow this conversation to read and modify these folders?",
      detail:
        roots.join("\n") +
        "\n\nReads inside these folders do not require repeated approval. Ask mode confirms edits; Auto also approves scoped edits. Commands and outside access require approval unless Full access is enabled. Access is saved for this conversation and can be revoked.",
      buttons: ["Cancel", "Allow access"],
      defaultId: 0,
      cancelId: 0,
    });
    if (approval.response !== 1) return null;
    await selectRepository(roots[0]);
    for (const root of roots)
      if (!directories.includes(root)) directories.push(root);
    await writeFile(
      settingsFile(),
      JSON.stringify({ root: roots[0], directories }),
      "utf8",
    );
    return executor.grantFolders(id, roots);
  });
  handle("conversations:revoke-folder", (id: string, root: string) =>
    currentAgent().revokeFolder(id, root),
  );
  handle("agent:tasks", () => currentAgent().list());
  handle("conversations:list", () => currentAgent().conversations());
  handle("groups:create", async (name: string, conversationID?: string) => {
    const id = randomUUID();
    if (
      conversationID &&
      !currentAgent()
        .conversations()
        .conversations.some((c) => c.id === conversationID)
    )
      throw new Error("Chat no longer exists.");
    await changeConfig((c) => {
      c.groups.push({ id, name });
      return c;
    });
    if (conversationID)
      currentAgent().updateConversation(conversationID, { groupID: id });
    return currentAgent()
      .conversations()
      .groups.find((g) => g.id === id)!;
  });
  handle(
    "groups:update",
    async (id: string, patch: { name?: string; collapsed?: boolean }) => {
      if (patch.name !== undefined)
        await changeConfig((c) => {
          const g = c.groups.find((g) => g.id === id);
          if (!g) throw new Error("Group no longer exists.");
          g.name = patch.name!;
          return c;
        });
      return currentAgent().updateGroup(
        id,
        patch.collapsed === undefined ? {} : { collapsed: patch.collapsed },
      );
    },
  );
  handle("groups:delete", async (id: string) => {
    const executor = currentAgent();
    const group = executor
      .conversations()
      .groups.find((item) => item.id === id);
    if (!group) throw new Error("Group no longer exists.");
    const result = await dialog.showMessageBox(window, {
      type: "question",
      message: `Delete group “${group.name}”?`,
      detail:
        "Conversations will be moved to Ungrouped. No conversations will be deleted.",
      buttons: ["Cancel", "Delete group"],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return false;
    await changeConfig((c) => ({
      ...c,
      groups: c.groups.filter((g) => g.id !== id),
    }));
    return true;
  });
  handle("conversations:fork", (taskID: string) =>
    currentAgent().forkConversation(taskID),
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
      message: `Delete “${conversation.title || tasks[0]?.prompt.slice(0, 48) || "New chat"}”?`,
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
  handle("composer:models", () => composerStore.models());
  handle(
    "composer:save-model",
    async (value: import("../shared/api").ModelProfile) => {
      const profile = validateModel(value);
      await changeConfig((c) => ({
        ...c,
        models: [...c.models.filter((m) => m.id !== profile.id), profile],
      }));
      return composerStore.models();
    },
  );
  handle("composer:delete-model", async (id: string) => {
    await changeConfig((c) => {
      c.models = c.models.filter((m) => m.id !== id);
      if (!c.models.length) throw new Error("Keep at least one model.");
      if (c.preferences.defaultModelID === id)
        c.preferences.defaultModelID = c.models[0].id;
      return c;
    });
    return composerStore.models();
  });
  handle("composer:upload", (name: string, bytes: Uint8Array) =>
    composerStore.attach(name, bytes),
  );
  handle("composer:pick", async () => {
    const selection = await dialog.showOpenDialog(window, {
      properties: ["openFile", "multiSelections"],
    });
    if (selection.canceled) return [];
    if (selection.filePaths.length > 8)
      throw new Error("Select up to eight attachments.");
    const files = await Promise.all(
      selection.filePaths.map(async (file) => {
        const info = await import("node:fs/promises").then((fs) =>
          fs.stat(file),
        );
        if (info.size > 5 * 1024 * 1024)
          throw new Error("Each attachment must be at most 5 MB.");
        return { file, data: await readFile(file) };
      }),
    );
    return files.map(({ file, data }) =>
      composerStore.attach(path.basename(file), data),
    );
  });
  handle("composer:test-model", async (id: string) => {
    const model = composerStore.model(id);
    const key = providerCredentials[model.keyRef];
    if (!key)
      throw new Error(
        `Restart Anvil through Keygrant with ${model.keyRef} injected.`,
      );
    const endpoint =
      model.endpoint || providerCredentials.BYTEPLUS_ARK_RESPONSES_URL;
    if (!endpoint) throw new Error("Responses URL is missing.");
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.model,
        input: "Reply OK",
        max_output_tokens: 16,
        store: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`Model connection failed (HTTP ${response.status}).`);
    await response.body?.cancel();
  });
  handle(
    "agent:start",
    (
      id: string,
      text: string,
      acceptance?: AcceptanceOptions,
      options?: import("../shared/api").MessageOptions,
    ) => {
      const executor = currentAgent();
      const folders =
        executor.conversations().conversations.find((item) => item.id === id)
          ?.folders || [];
      return executor.start(
        id,
        text,
        folders,
        folders.includes(workspace?.root || "") ? workspace!.root : folders[0],
        acceptance,
        {
          model: composerStore.model(
            options?.modelID ||
              account.snapshot?.config.preferences.defaultModelID,
          ),
          attachments: composerStore.attachments(options?.attachmentIDs),
        },
      );
    },
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
    if (!activeUser || !account.user) return;
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
    if (!activeUser || !account.user) return;
    if (typeof data === "string" && data.length <= 64 * 1024)
      terminal?.write(data);
  });
  ipcMain.on("terminal:resize", (event, cols, rows) => {
    trusted(event);
    if (!activeUser || !account.user) return;
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
  account = new Account(
    app.getPath("userData"),
    (value) => {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Secure credential storage is unavailable.");
      return safeStorage.encryptString(value);
    },
    (value) => safeStorage.decryptString(value),
  );
  const icon = path.join(app.getAppPath(), "assets", "icon.png");
  if (process.platform === "darwin") app.dock?.setIcon(icon);
  window = new BrowserWindow({
    icon,
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

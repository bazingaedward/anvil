import { extensionCommand } from "./extension-command";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dialog, type BrowserWindow } from "electron";
import { githubIdentity } from "./extensions";
import { executionEnvironment } from "./acceptance";
import { loginPattern } from "../shared/extensions";
const run = promisify(execFile);

// gh owns device authorization. Only the login name crosses IPC.
export async function connectGithub(
  window: BrowserWindow,
  login: string,
  signal: AbortSignal,
) {
  if (!loginPattern.test(login)) throw Error("请输入有效的 GitHub 用户名。");
  const matches = async () =>
    (await githubIdentity())?.toLowerCase() === login.toLowerCase();
  if (await matches()) return;
  const answer = await dialog.showMessageBox(window, {
    type: "question",
    message: `连接 GitHub 账号 ${login}？`,
    detail:
      "Anvil 将切换本机 GitHub CLI 的当前账号。如果尚未登录，GitHub 会打开浏览器，一次性验证码会复制到剪贴板。授权完成后继续。",
    buttons: ["取消", "连接"],
    cancelId: 0,
    defaultId: 1,
    signal,
  });
  if (answer.response !== 1 || signal.aborted)
    throw Error("已取消 GitHub 授权。");
  const env = { ...executionEnvironment(), GH_PROMPT_DISABLED: "1" };
  try {
    await run(
      extensionCommand("gh"),
      ["auth", "switch", "--hostname", "github.com", "--user", login],
      { env, signal },
    );
  } catch (error) {
    if (signal.aborted) throw Error("已取消 GitHub 授权。");
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw Error("请安装 GitHub CLI 后重新连接。");
    try {
      await run(
        extensionCommand("gh"),
        [
          "auth",
          "login",
          "--hostname",
          "github.com",
          "--git-protocol",
          "https",
          "--web",
          "--clipboard",
        ],
        { env, timeout: 600000, signal },
      );
    } catch {
      throw Error("GitHub 授权没有完成，请重新连接。");
    }
  }
  if (!(await matches())) throw Error(`登录账号与绑定不同，请选择 ${login}。`);
}

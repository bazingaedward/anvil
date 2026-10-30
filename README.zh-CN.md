# Anvil

[English](README.md) | 简体中文

专注 coding、模型可替换的开源 agent harness，提供 macOS / Windows 桌面工作台。

**我们的长期目标是打造一个模型可替换的 coding harness，未来在真实编程任务中超过 Claude。** 以 Claude Code 作为主要产品对标，通过可复现评测衡量进步。

模型会更迭。Anvil 专注于模型周围的执行闭环：理解仓库、选择工具、精确修改、运行检查，并根据失败结果继续修复。

## 桌面预览

第一个桌面阶段提供真实本地仓库的编辑和审阅能力：

- 打开 Git 仓库、浏览文件。
- 使用 Monaco 编辑 UTF-8 文本，拒绝覆盖外部修改，保护未保存编辑。
- 分别审阅工作区和暂存区 Diff，处理新增、删除、重命名。
- 使用 xterm.js 与 node-pty 在仓库内运行交互终端。
- 调整侧栏和终端尺寸，启动时恢复上次打开的仓库。

桌面**尚未接入 agent 执行**。下一阶段重点是 harness；暂存、提交和推送目前通过终端完成。Git Graph、完整 Git 客户端、插件市场和独立浏览器产品不在本阶段范围。

开发需要 Node.js 22.12+ 与 Git。安装包用户无需安装 Node.js 或 npm，但需另外安装 Git 和项目所需开发工具。

```sh
npm ci
npm run dev
```

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run package:mac   # 在 macOS 上执行
npm run package:win   # 在 Windows 上执行
```

安装依赖时会为 Electron 重建终端原生模块；源码构建可能需要 macOS Xcode Command Line Tools 或 Windows Visual Studio C++ 构建工具。编辑器限制为 2 MiB UTF-8 文本，不打开符号链接目标或二进制文件。终端拥有当前用户权限，不是沙箱。安装包签名与自动更新尚未配置。

## 内部 harness 原型

- 本地命令行入口、独立于提供商的执行循环，以及首个 OpenAI Responses API 适配器。
- 列出文件、文本搜索、读取文件、精确替换、新建文件和执行命令。
- 修改文件和模型提出的命令需要逐次交互确认；非交互运行默认拒绝这些操作。
- 用户指定验收命令；检查失败时交回模型继续修复，没有验收命令则标记为 **未验证**。
- 限制模型轮数、上下文体积、文件大小、命令输出与执行时长。
- 文件工具进行路径校验，并检查读取后文件是否变化，以减少意外覆盖。

当前是早期原型。本地测试使用脚本化模型返回，但操作真实文件并执行真实测试进程。真实模型执行和 Claude 对照评测尚未验证，目前也只实现了一个真实提供商适配器。

## 运行内部 harness

需要 Node.js 22+、ripgrep（`rg`）以及存放在 keygrant 中、名称为 `OPENAI_API_KEY` 的 OpenAI API 密钥。API Key 调用单独按 API 计费，不使用 ChatGPT 订阅额度。

```sh
npm ci
npm test
npm run anvil -- --help
```

在交互式终端运行，将仓库路径和模型 ID 替换为实际值：

```sh
keygrant exec --redact OPENAI_API_KEY -- npm run anvil -- \
  --repo /path/to/repository \
  --model MODEL_ID \
  --check 'npm test' \
  '用最小改动修复失败测试。'
```

Anvil 会展示拟执行的修改或命令，等待确认。通过 `--check` 指定的命令视为已经授权，可能重复执行。检查通过返回 `completed`；未配置检查返回 `unverified`（退出码 2）。拒绝操作会停止当前任务；其他失败、中断或达到上限返回退出码 1。提交前请检查实际 diff。

这是本地执行器，**不是沙箱**。获批命令拥有当前用户权限。文件工具拒绝路径越界、符号链接和部分敏感路径，但不能限制 shell 命令。子进程仅继承精简环境，不继承模型 API 密钥。默认不保存对话记录。

## 设计与评测

模块边界、实现决策及验收条件见[设计文档](docs/design.md)。

后续 Claude 对照评测应固定任务、起始仓库、运行环境、权限和预算，记录模型及产品版本，并通过重复运行比较成功率、耗时、成本和人工干预次数。

## ChatGPT 订阅实验

独立 OAuth 连通性测试因账号／工作区权限问题暂缓，尚未完成真实推理请求，也不是当前 CLI 使用的认证方式。过程和结论见[测试说明](docs/chatgpt-smoke-test.md)。

## 许可证

[MIT License](LICENSE)。

# Anvil

[English](README.md) | 简体中文

**Claude Code 用不了，也能换模型继续写代码。**

Anvil 是一个开源、模型可替换的桌面 coding agent，支持 macOS / Windows。如果你的 Claude 或其他模型厂商账号被封禁、停用，或当前服务不可用，可以在 Anvil 中配置另一个可用的模型 API，继续对话、读写本地代码、执行命令和审查 Git 变更。开发工作不必绑定在某一家厂商的账号上。

Anvil 不只是聊天界面：它提供持续的 Agent 执行循环、工具调用、权限审批、会话持久化和代码审查工作区。当前桌面执行内核基于 OpenCode，产品体验以 Claude Code 等 coding agent 为参考。

### 账号停用后，怎样继续开发？

1. 准备一个仍可使用的模型 API 账号和密钥。当前通过 OpenCode 适配器接入 **Responses、Chat Completions、Anthropic Messages、Google Gemini**；已实测 BytePlus Ark + DeepSeek 的前两种协议，不代表所有厂商或模型均已验证。
2. 按[运行说明](runtime/opencode/README.md)构建或启动 Anvil，通过 Keygrant 注入密钥。
3. 点击输入框右侧的模型名称，添加供应商、API 协议、模型 ID、HTTPS API 地址 和密钥环境变量名称，保存并测试连接。
4. 添加你的本地工作文件夹，选择授权模式，即可继续让 Agent 修改代码、运行命令和查看 Diff。也可以不添加文件夹，先进行普通对话。

在 Anvil 内切换模型会继续使用当前会话，本地代码、对话和工作区不需要随模型供应商一起更换。Anvil 不会恢复被封禁的账号，也不能继续使用失效的密钥；原平台的订阅额度和聊天历史不会自动迁移。新供应商的调用按其 API 规则计费。

**长期目标：打造一个模型可替换、在真实编程任务中超过 Claude 的 coding harness。** 这是产品目标，尚无对照评测证明；后续通过可复现任务衡量进步。

## 桌面预览

当前桌面预览已具备以下能力：

- **对话与权限**：本地对话、分组、置顶、重命名、归档/恢复和删除；支持逐次询问、Auto、完全访问三种权限模式。
- **多目录工作**：一个对话可以添加多个普通文件夹或 Git 仓库，也可以不绑定项目；文件夹按对话授权。
- **可替换模型**：从输入框选择、添加和配置多个供应商的模型，按对话记忆选择；运行中可停止任务，结束后可切换下一轮模型。
- **文件与图片附件**：选择、拖入或粘贴附件；支持 UTF-8 文本和常见图片，图片要求模型支持图像输入。PDF、Office 文档暂不支持。
- **代码审查工作区**：固定左侧图标入口、可折叠仓库列表、彩色提交图、分支筛选、提交比较及逐文件 Diff；分别查看暂存与未暂存变更。
- **本地编辑与终端**：Monaco 文本编辑器保护未保存编辑、拒绝过期覆盖；按需打开交互终端。
- **账号与配置同步**：桌面端需要 Google 登录；模型配置（不含密钥）、默认模型、Group 名称和顺序通过 Cloudflare Workers + D1 同步。配置冲突会要求刷新，不会静默覆盖。
- **本地数据**：对话、任务、附件及目录授权按账号保存在本机，不同步到云端。首次登录可选择导入旧版本地数据。发起推理时，提示和所需上下文仍会发送给所选模型服务。

登录后点击左下角头像，可查看账号、打开设置或退出登录。设置中可同步配置、调整默认模型、管理登录设备；Group 在聊天侧边栏管理。模型密钥仍通过本机 Keygrant 注入。配置服务为独立项目 `anvil-cloud`，接口位于 `https://anvil.keygrant.app`。详见[账号与同步说明](docs/account-sync.md)。

首个实测供应商为 BytePlus Ark Responses + DeepSeek。macOS ARM64 已验证真实对话、上下文、工具读取、取消和历史恢复；Windows 已验证当前运行内核读取文本附件并回复。图片和自定义模型能否正常调用仍取决于所选模型与接口能力。

目前仍是桌面预览：GitHub PR 列表、评论、合并尚未接入；暂存、提交和推送通过终端完成。详见[代码审查设计](docs/code-review.md)和[输入框、模型与附件说明](docs/composer-and-models.md)。

开发需要 Node.js 22.13+ 与 Git。安装包用户无需安装 Node.js 或 npm，但需另外安装 Git 和项目所需开发工具。

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

这里指独立的内部 CLI 原型，与上文已验证真实模型调用的桌面 OpenCode 内核不同。CLI 本地测试使用脚本化模型返回，但操作真实文件并执行真实测试进程；其真实模型执行和 Claude 对照评测尚未验证，目前只实现了一个提供商适配器。

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

模型供应商配置和运行原理见[模型接入说明](docs/model-providers.md)。

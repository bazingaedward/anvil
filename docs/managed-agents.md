# 本地 Managed Agent：Codex

## 问题与范围

Anvil 的直接模型接入依赖 API 凭据和 OpenCode。增加本地 Codex 执行后端，让用户通过已登录的官方 Codex 使用其账号允许的订阅额度，复用成熟的编码循环。首版只接 Codex；不新增 DeepSeek 调度循环、不接 Claude、不实现云端共享账号。

## 方案

- 在现有执行器选择中提供固定的 Codex (local) 入口，与 API 模型分开标识；由 Codex 选择账号当前默认模型，不把本地执行器存为云端模型配置。
- Electron 主进程调度本地 `codex app-server` 的 stdio JSON-RPC，识别 Anvil 客户端。探测可执行文件和账号登录状态，未安装/未登录/非订阅登录明确报错，不自动切换 API 计费。
- 保留官方登录数据，由 Codex 自己读取和刷新；不复制、读取或记录凭据，不注入 OpenAI API Key。
- 映射线程、流式文本、工具活动、审批和结束事件到现有 Anvil 任务协议。只在 turn/completed 成功后结束；复用现有验收命令、修复轮次和任务超时。
- 会话 ID 按执行后端隔离，继续对话使用 thread/resume；切换执行后端必须明确处理上下文，不把 OpenCode session ID 传给 Codex。
- 权限采用 Codex sandbox 和 Anvil 审批共同控制，禁止因为适配层缺少处理而默认同意未知请求。取消先发 turn/interrupt，超时后结束进程树。支持异步提问卡片和回答续聊；阻塞式提问与 MCP 复杂表单仍未接入，详见 [交互式提问原理](agent-questions.md)。
- 目录来自当前会话已授权文件夹；无文件夹使用独立会话工作目录。文本附件按不可信内容传递，图片走 Codex 图片输入。

## 使用与权限

新建对话，在输入框的模型选择中选 **Codex (local)**。本机需安装 Codex CLI 或受支持的 Codex/ChatGPT 桌面程序，并在官方 CLI 中执行 `codex login` 使用 ChatGPT 登录。默认模型由本机 Codex 决定；这里只提供本地执行入口，不支持修改 API endpoint 或密钥。当前验证平台为 macOS，Windows 留待后续验证。

- Ask each time：映射 Codex read-only sandbox + on-request 审批；只读命令可能无需审批，提权请求进入 Anvil 审批界面。
- Auto：映射 workspace-write sandbox，允许工作区内修改和沙箱内命令，额外网络/目录权限仍须审批。
- Full access：映射 danger-full-access + never；遵循用户已选择的完全访问权限。
- Codex 的沙箱限制写入和命令网络访问，不保证只能读取挂载文件夹。与 OpenCode 的逐工具权限判定不同，界面权限提示会随执行器切换。无文件夹可聊天，使用独立内部 cwd。
- Codex 的线程存储由官方 CLI 保管，Anvil 保存线程 ID。删除 Anvil 对话不会删除 Codex 自身保存的历史。
- API 内核与 Codex 之间切换需新建或 fork 对话；fork 用文本历史建立新线程，不继承工具进程及附件内容。
- 优先采用显式代理环境变量；从 Finder 启动时解析 Electron 的系统代理并传给 Codex。适配层不复制登录凭据，也不转发任意环境变量或 API 密钥。

## 验证

先检查当前本机账号，在临时仓库验证真实推理、文件修改和测试，再验证会话恢复、取消、审批拒绝、异常退出和不泄露凭据。接入后运行相关单元测试、类型检查、安装包验证，并记录真实成功与未验证边界。

## 官方依据

- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/auth

本地/开源集成与商业托管服务的认证支持范围不同；本功能仅运行用户本机安装的 Codex。工作区策略和订阅额度仍由 Codex/OpenAI 执行。

## 本次实测（2026-11-11）

在本机 `codex-cli 0.167.0-alpha.3.2` 的 ChatGPT 登录下，经完整 Anvil Agent → bundled worker → app-server 链路：修复临时项目的加法错误，运行独立验收命令通过；第二轮通过 thread/resume 正确回忆上一轮指定内容。首次无代理请求超时，系统代理接入后通过。测试未读取 token，未提供 API Key。

协议测试覆盖流式输出、附件、会话恢复、三种权限模式、命令/文件/额外权限审批、拒绝后停止、取消、未知交互、进程退出和非订阅登录拦截。仅编码和续聊已做真实模型验证；审批与取消由协议模拟测试覆盖。

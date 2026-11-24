# Copilot 套餐模型接入

## 问题

需要在保留 Anvil / OpenCode 2.0 工具循环的前提下，使用用户的 GitHub Copilot 套餐切换模型，比较完成质量与响应时间。VS Code 显示的模型不能直接当作账户已授权的 API 模型列表。

## 方案

- 使用固定版本 OpenCode 2.0 的原生 GitHub Copilot OAuth 与 provider，避免重新实现 Copilot 请求协议或另换 agent loop。
- 当前授权账号为 `kaixiang-qiu`。浏览器完成 GitHub device flow；完成后读取 GitHub 身份核对账号。若组织策略拒绝，展示实际原因，不自动换账号。
- 授权测试 host 的数据库仅在内存中。OAuth credential 通过 stdin 存入 Keygrant 的 `ANVIL_COPILOT_OAUTH`；不输出凭据，不写入配置文件/日志/仓库。
- 后续执行仅通过 Keygrant 注入凭据；运行 host 的凭据存储也必须避免落盘。按账户返回的模型、权限和工具调用能力生成可选项，保留额度/权限错误，不自动购买升级。
- 先验证授权与模型发现，再用隔离测试目录验证纯文本、读文件/修改/检查的工具循环。只对实际允许的模型做小规模对照，不修改正在运行的用户项目。

## 验证边界

登录成功、模型可列出、文本回复成功、工具循环完成是四个不同检查点。模型展示为可用不等于真实调用已通过；测试报告记录实际模型 ID、首响应/总耗时、工具调用与验收结果。

## 使用

1. 先安装 `runtime/opencode` 的依赖并执行 `npm run runtime:build`。
2. 首次授权：用该目录依赖里的 Bun 执行 `runtime/opencode/copilot-login.mjs <github-login>`，按输出的 device URL / 验证码授权。脚本核对 GitHub 账号后，通过 stdin 写入 Keygrant。隔离 OpenCode 的 XDG 目录不会改变 Keygrant 的保存位置。
3. 通过 Keygrant 注入 `ANVIL_COPILOT_OAUTH` 启动 Anvil，例如 `keygrant exec ANVIL_COPILOT_OAUTH -- npm run dev`。同时需要其他 provider 时，按 Keygrant 的多密钥参数注入。OAuth 值不放进命令参数或配置文件。
4. 输入框首次加载时自动获取 Copilot 目录，本次启动内复用结果。也可点击「获取 / 刷新 Copilot 模型」手动刷新。成功获取目录后，只列出其中可用的 Copilot 模型。若草稿或默认配置引用了已下线的模型，发送时保留草稿并提示重新选择。当前版本授权由本地脚本完成，尚未提供应用内登录按钮。

模型选择沿用现有会话和权限流程。Copilot 模型不能编辑 endpoint/keyRef；OAuth 不能被配置成普通 API key。网络访问使用启动进程的代理环境。套餐限制和组织权限以 GitHub 的实际响应为准。

## OpenCode 2.0 适配边界

`@opencode/sdk` 2.0.0 的公共 `OpenCode.create` 只转发第一个参数，无法传入凭据服务替换。本适配器使用该固定依赖里的 `dist/promise.js` 的 `PromiseSdk.create`，替换 `Credential.Service` 为内存存储，同时继续持久化会话数据库。升级 OpenCode 时必须重新验证这个内部入口；回归测试会检查凭据可被 host 解析且不写入 SQLite。

原生 Copilot 插件异步刷新模型目录，其网络超时只有 5 秒且失败后不重试。Anvil 在初始化 host 前先获取模型目录：单次最多 20 秒，网络错误、429、5xx 或无效响应自动重试一次；401/403 直接提示重新授权或权限问题。成功后在本轮进程内复用该响应给原生插件，不再发第二次目录请求；原生模型转换和协议选择不变。创建会话前仍等待所选模型可执行，最长等待 30 秒；界面模型发现进程预算为 45 秒以覆盖两次网络尝试。这是连接初始化期限，不是任务执行期限。模型请求错误经脱敏后返回前端，便于区分权限、额度和配置问题。

## 2026-11-16 实测

账户返回 15 个符合选择器、未禁用、支持工具调用条件的模型；其中以下三个完成了真实调用。统一使用隔离目录，读取有错误的 `sum.cjs`，仅修复该文件，并运行 `node check.cjs`。外部进程再次执行检查，并扫描运行目录确认没有保存 OAuth 值。

| 模型 ID | 总耗时 | 首段可见文本 | 外部验收 | 备注 |
| --- | ---: | ---: | --- | --- |
| `gpt-6-luna` | 10.9 秒 | 10.7 秒 | 通过 | read → patch → shell |
| `mai-code-1.1-flash` | 12.1 秒 | 12.0 秒 | 通过 | 一次 edit 失败后自行修正 |
| `claude-haiku-4.5` | 10.4 秒 | 3.1 秒 | 通过 | read → edit → shell |

三次运行均未发现凭据落盘。这是小任务连通性检查，不是模型能力排名，也不能直接与十万 token 的 DeepSeek 历史任务比较。其余模型尚未进行真实推理验证。

可通过 Keygrant 注入凭据运行 `node_modules/.bin/tsx scripts/copilot-smoke.mjs <model-id>...` 重复上述检查。脚本每个探测设 120 秒期限，只影响探测，不影响应用任务；不打印模型正文或凭据。

本地回归：`npm run typecheck`、`TMPDIR=/private/tmp npm run test:desktop`（88 项）、使用 runtime 的 Bun 执行 `bun test runtime/opencode/copilot.test.mjs`（3 项）、`npm run runtime:build`、`npm run build`。

## 保存为默认模型

Copilot profile 可持久化到账号配置并作为默认模型。现有云端 schema 尚无 `connection` 字段：传输时省略这个本地字段，读取时仅对 `ANVIL_COPILOT_OAUTH` 与 `https://api.githubcopilot.com` 的精确组合恢复原生 Copilot 连接；OAuth 值仍只在 Keygrant。其他地址不会推断为 Copilot。已保存模型与新获取目录按 ID 合并，避免重复显示。删除旧模型不删除历史任务。

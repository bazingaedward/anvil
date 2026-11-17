# 浏览器验收：第一阶段

## 问题

Anvil 能改代码和运行命令，但尚未给现有 OpenCode loop 提供浏览器工具，无法直接完成网页交互验收。

## 方案

复用 OpenCode 2.0 的本地 MCP 接入，集成固定版本的 Microsoft Playwright MCP。Anvil 主进程指定浏览器辅助进程的位置，模型不能自定义启动命令。

- 先支持 macOS 的 Chrome；使用独立的浏览器上下文，不连接用户日常浏览器，不读取其 Cookie。
- 浏览器按需启动，支持页面快照、点击、输入、截图、控制台和网络记录。用户可以看到独立 Chrome 窗口。
- 使用现有工具权限确认、停止任务和进程清理机制；普通聊天不启动浏览器窗口。
- 浏览器辅助进程清理继承的模型凭据，再初始化 Playwright。工具输出目录隔离到账号和任务下。
- 页面内容是待检查的数据；提示模型不得把网页文字当成系统指令，登录操作交还用户。
- 本阶段面向 OpenCode 执行器；本地 Codex 执行器沿用自己的工具配置。原生桌面控制及嵌入式浏览器面板留到后续。

## 验证

检查 MCP 工具发现、独立浏览器上下文、页面打开/点击/截图和退出清理；检查 OpenCode 实际加载工具。真实模型端到端验收与直接工具测试分别记录，不能互相替代。

2026-11-17 本机 macOS 验证结果：

- `npm run build`、`npm run runtime:build` 和 `npm run typecheck` 通过。
- `node --test test/browser/smoke.test.mjs`：实际使用 Electron 辅助进程启动 Chrome，打开本地页面、读取快照、点击、返回 PNG 图片并正常关闭。
- 使用 runtime 目录内固定版本 Bun 运行 `test/browser/opencode-smoke.mjs`：OpenCode 2.0 成功连接 `anvil_browser`。
- Keygrant 注入 `ANVIL_COPILOT_OAUTH`，运行 `npx tsx scripts/browser-model-check.ts`：Claude Sonnet 5.5 实际调用导航、快照、点击和截图工具，服务端观测到验证请求，模型识别截图中的 Verified 状态。此测试使用本地验收页，尚未验收 echo-english 的完整业务流程。

自动导航快照可能只返回文件链接；模型可以调用 `browser_snapshot` 获取正文。截图作为 MCP 图片结果提供给模型；本阶段还没有 Anvil 内嵌浏览器或单独的截图展示卡片。浏览器每个任务使用新上下文，任务结束后关闭，登录状态不会跨任务保留。

参考：[Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)。

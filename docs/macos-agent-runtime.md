# macOS 执行内核

## 问题

桌面发送流程寻找固定的 `anvil-runtime.exe`，内核构建脚本与 Bun 依赖也只支持 Windows x64。macOS 可以启动界面，但发送消息会报执行内核未安装。

## 方案

- 保持 OpenCode 2.0.0 和 Bun 1.4.2，按构建主机选择 Windows x64、macOS ARM64 或 x64 的 Bun 包。
- 平台编译器作为 optionalDependencies，安装时只选择当前平台。macOS 输出 `anvil-runtime`，Windows 继续输出 `anvil-runtime.exe`。
- 桌面开发模式与安装包按平台寻找内核；macOS 打包时携带独立执行文件。
- OpenCode 的 macOS PTY 包使用动态模块路径，Bun 编译无法自动包含它。通过构建期路径映射替换该包的路径查询，将原始 PTY 二进制放在内核旁边；上游 SDK 不做修改。
- 凭据继续只经 keygrant 注入。此机器现有的 `DEEPSEEK_API_KEY` 保存的是 BytePlus 密钥，可在启动命令中映射为 `BYTEPLUS_ARK_API_KEY`，端点使用用户指定的 BytePlus Responses 地址。

## 验证

先构建本机独立执行文件，再验证类型检查、生产构建和无文件夹桌面回归。通过 keygrant 执行真实模型桌面测试，检查无文件夹回复、添加文件夹后的上下文延续、工具读取、取消和历史恢复。出现平台构建或模型接入阻塞时记录具体错误，不无限重试。签名、发布和其他架构实机验证不属于本次修复。

## 本次结果（2026-11-04）

- ARM64 内核与 PTY 辅助程序已构建，真实桌面 E2E 通过：无文件夹回复、后续读取项目文件及记忆保持、授权等待时取消、重启后的历史恢复。
- 类型检查、生产构建、无凭据/无文件夹桌面回归通过；本地应用已通过 keygrant 注入凭据启动。
- 首次实测暴露动态 PTY 模块无法解析，加入辅助程序及构建期映射后修复。映射使用 Bun 支持的 [tsconfig paths](https://bun.sh/docs/runtime/module-resolution)。
- 真实 E2E 明确等待文件夹授权计数变为 1 后再发送，避免仍在处理授权时发起下一轮；测试窗口隐藏，避免干扰用户操作。
- macOS Intel、安装包签名及发布未在本次验证。

# OpenCode Windows 执行进程验证

此实验固定 `@opencode/sdk@2.0.0` 与上游使用的 Bun `1.4.2`，目前只验证 Windows x64。依赖和锁文件独立于 Anvil 桌面产品。

```powershell
npm ci --prefix experiments/opencode-runtime --ignore-scripts
npm run probe --prefix experiments/opencode-runtime
```

脚本将 SDK 编译为独立 EXE，在 `.anvil/runtime-probes/run-*` 中启动两个子进程：第一个检查健康状态、创建会话并关闭；第二个从 SQLite 恢复相同 ID 和 metadata。两个进程都必须正常退出，任一步失败或超过 60 秒则验证失败。保留运行目录、数据库和二进制供排查。

子进程只继承必要的 Windows 环境变量，XDG 目录和测试 home 指向本次运行目录；关闭模型目录联网更新、项目配置、文件监听和 fff。实验不发送模型请求，不执行工具，也不使用用户模型凭据。编译时禁用 dotenv 和 bunfig 自动载入。

Bun 编译器显式复制到本次运行目录并传入 `--compile-executable-path`，避免本次测试遇到的默认编译路径 / Unicode 路径查找失败。当前验证使用 `D:\Projects\anvil`，尚未保证所有 Unicode 安装路径可用。

## 2026-10-31 验证结果

- 从本目录锁文件执行 `npm ci --ignore-scripts` 后，`npm run probe` 通过。
- 编译后的 EXE 在不含 node_modules 的目录中完成健康检查、会话创建、关闭和跨进程恢复。
- 使用 Electron 45.1.0 的 `ELECTRON_RUN_AS_NODE=1` 进程作为父进程，启动同一 EXE，创建与恢复通过。这是 Electron 运行时兼容性验证，不等于已接入桌面主进程 IPC 或已验证安装包。
- Node 直接导入 SDK 的旧问题可通过独立 Bun 执行进程规避；不需要在 Electron 主进程中加载 SDK。

可通过 `ANVIL_PROBE_EXECUTABLE` 指定已编译 EXE，仅执行启动和恢复验证；`ANVIL_PROBE_BUN`、`ANVIL_PROBE_SOURCE` 用于排查构建输入。

## 下一步接入门槛

1. 用真实任务验证流式事件、权限批准/拒绝、执行中取消及崩溃后的恢复；当前仅验证空会话元数据持久化。
2. 确认真实工具需要的原生模块、资源文件、Git Bash 和模型适配依赖能随执行进程交付；健康检查不证明全部工具可运行。
3. 增加类型化 IPC，管理超时、退出与事件订阅，打通 Electron 主进程的生命周期。
4. 用 electron-builder extraResources 随应用打包执行文件，验证安装路径、空格/Unicode 路径、Windows 安装包；macOS 单独构建验证。
5. 正式分发前整理 SDK、Bun 和传递依赖的许可证及第三方声明。此实验尚未改变产品依赖、打包配置或发送按钮。

依据：[上游 SDK](https://github.com/anomalyco/opencode/blob/v2.0.0/packages/sdk/README.md)、[上游 Bun 版本](https://github.com/anomalyco/opencode/blob/v2.0.0/package.json)。

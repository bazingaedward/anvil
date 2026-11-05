# Agent loop 源码对比与 Anvil 的实施顺序

日期：2026-11-05。状态：静态源码研究；不是性能排行榜，也不是三个执行器的实测报告。

## 问题与结论

Anvil 需要在纯 coding 场景中先达到可比较的完成质量，再提高成功率、恢复能力和成本效率。需要判断：OpenCode 2.0 是否足以作为当前内核，哪些职责应由 Anvil 掌握，何时才值得替换内核。

本轮结论：继续使用 OpenCode 2.0.0；优先接通执行记录并建立固定任务评测，再接通产品验收流程。Claude Code 镜像值得研究异常收尾和工具反馈，DeepSeek Harness 值得研究执行结果的持久化、并发边界和基于实际进展的恢复。没有源码证据或实测结果支持现在切换内核。

Anvil 保持对话为主的 macOS / Windows 桌面产品；本研究不扩大到插件市场、办公集成、npm CLI 产品或多 agent 平台。Claude Agent SDK 作为补充参考，本轮不接入、不调用模型。

## 版本与证据边界

| 对象                  | 固定基线                                                                                            | 阅读方式与限制                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode              | 本项目实际安装的 `@opencode/sdk`、`@opencode/core` **2.0.0**                                        | 阅读发布包 `dist`，使用包内 `// src/...` 标记定位原模块；版本和下载完整性记录见 [runtime 锁文件](../runtime/opencode/package-lock.json)。没有把最新主分支或 V1 文档当作本版本源码；本轮未重新下载校验 tarball |
| Claude Code 早期镜像  | 自称 v2.1.88；第三方仓库 commit `4e5426b82ab19c81244f165b4f18306944b8a169`                          | [固定快照] [C0]；未与原始 npm 发布物逐字节核验。缺少部分引用文件，例如 `src/query/transitions.ts`；`feature(...)` 和运行时开关的存在不证明发布版启用                                                          |
| DeepSeek Harness      | 官方仓库 commit `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`，提交说明为合入 `release-dsh-0.2.2-rc.1` | [固定快照] [D0]；阅读实现及 `base` / `sdk-minimal` bundle 配置。不是对所有 profile 和桌面安装包的启用情况作保证                                                                                               |
| Anvil                 | 本轮开始时 `17d2abb98a1c944b8e73e7c6ecdce485050b86ef`                                               | 对照实际 worker、主进程、聊天入口。运行内核有能力，不等于 Anvil 已接通、展示或验证该能力                                                                                                                      |
| 官方 Claude Agent SDK | 2026-11-05 核查的官方文档与公开 Python SDK                                                          | 用于说明集成边界；不是第四个已做源码审计或运行评测的内核                                                                                                                                                      |

两份外部仓库只下载到 Git 忽略的 `.anvil/research/`，没有安装依赖或执行其脚本。本文仅总结机制，不收录第三方实现代码。Claude 镜像不是 MIT 授权来源，不移植其代码到 Anvil。

证据用语：**实现确认**表示读到相应分支；**配置确认**表示读到指定 bundle 的声明；**待验证**表示需要实际运行。上游测试文件能帮助定位行为，但本轮没有运行它们。

## 核心循环与停止

| 维度       | OpenCode 2.0.0                                                                       | Claude Code 早期镜像                                                                                      | DeepSeek Harness 固定快照                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 执行组织   | 会话协调器管理 owner、pending wake 和 interrupt；runner 组织逐步请求与结果 [O1] [O2] | `queryLoop` 维护状态、继续原因和终止分支，`QueryEngine` 包装会话与消息处理 [C1] [C6]                      | `ReactLoopAgent` 区分 turn、step、inbox、维护和运行状态；pre-step 决定进入还是阻止 [D1]                                        |
| 工具后继续 | step 产出 `needsContinuation`；拒绝、失败、工具选择和模型结果影响下一步 [O2] [O3]    | 消费工具结果后继续请求；自然结束可进入 stop hooks，阻塞反馈可触发继续 [C1]                                | 有工具时交给选定 executor；结果可结束 turn，否则继续；next-step inbox 可以追加工作 [D1]                                        |
| 上限与结束 | 配置 agent `steps` 后，达到上限禁用工具并请求总结；不能误当成默认总预算 [O2]         | 支持 `maxTurns`；API 错误跳过普通 stop hooks，避免错误和 hook 相互触发；部分 token-budget 分支有开关 [C1] | 自然停止前触发 `agent/turn-stopping`；LLM 重试、压缩和目标继续分别由策略插件承担，不能假设 loop 本身统一限制所有重试 [D1] [D4] |

三者的基础都是模型请求、工具执行、结果回填和继续判断。真正需要比较的是这些步骤之间的约束及异常语义，而不是是否存在一个 `while`。

## 工具调度、编辑与大输出

| 维度         | OpenCode 2.0.0                                                                                                | Claude Code 早期镜像                                                                         | DeepSeek Harness 固定快照                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 并发方式     | 流中收到工具调用后启动 scoped fiber，step 收集执行结果；这层未显示 Claude 式通用安全分类屏障 [O3]             | 流式执行器根据工具及参数判断并发安全；不安全调用独占；普通 batch 路径也区分串并行 [C2] [C3]  | native executor 使用有界滚动池；仅精确 `true` 的安全分类可并发，其他情况独占；结果按模型顺序提交 [D2] [D3]                        |
| 具体保护范围 | patch/edit 修改路径有锁，patch 涉及的目标排序后加锁；这不等于任意 shell、副作用工具之间都有依赖调度 [O6] [O9] | 分类失败按不安全处理；streaming fallback 会丢弃旧尝试结果，但不代表撤销已发生的外部操作 [C2] | exclusive 调用形成屏障，后续调用启动前重新分类；取消后停止启动新调用，并收尾已启动调用 [D2]                                       |
| 编辑依据     | 已核查文件修改锁与 patch 校验；未据此推断所有写入都有完整的 read-before-edit 防护 [O6] [O9]                   | FileEdit 校验读取状态、读取后变化以及替换目标是否唯一，返回可供模型纠正的原因 [C5]           | `fs-observation-policy` 要求编辑前的存在性观察并给出版本条件，交给文件 provider 检查；源码明确指出未加载策略时不具备同样保护 [D6] |
| 大结果       | 限制内联行数/字节，完整文本保存到文件并返回路径 [O7]                                                          | 将大工具结果存盘，用预览与路径代替内联内容；工具可有不同阈值 [C7]                            | spill 策略与存储后端分离，可保存完整内容并返回有界展示；是否生效取决于策略和存储的组合 [D7]                                       |

**对 Anvil 的意义：** 不需要再造通用大输出截断；应测试文件可否再次读取，以及错误信息是否足够修复。调度差异是测试假设，不是 OpenCode 不安全的结论。需要专门测试同文件编辑、shell 与编辑交错、并发读取中一个失败、工具执行中取消。

DeepSeek 的 `base` bundle 声明 native executor，PTC executor 默认 `disabled: true`；不能把 PTC 的程序化工具能力说成所有运行的默认行为。`base` 还声明压缩、LLM 重试与文件观察策略；`sdk-minimal` 有自己的组合。参见 [bundle 配置] [D9]。

## 上下文、重试与恢复

| 维度         | OpenCode 2.0.0                                                                                                       | Claude Code 早期镜像                                                                                           | DeepSeek Harness 固定快照                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 压缩策略     | 按模型容量及预留判断；结构化摘要保留目标、约束、决策、工作状态、下一步与文件，保留近期上下文；有本地/供应商路径 [O5] | microcompact 处理旧工具结果，autocompact 做整体压缩；部分缓存和历史处理分支受功能开关控制 [C4]                 | pre-step 检查压力；压缩插件可调用独立裁剪器，再做摘要；配置可按模型覆盖 [D5]                                            |
| 失败边界     | 上下文溢出专门恢复；单步设置恢复标志，避免反复走相同恢复；压缩失败可以直接结束 [O2] [O5]                             | 自动压缩连续失败达到 3 次时停止反复尝试；reactive recovery 保留已尝试状态，避免与 stop hook 形成循环 [C1] [C4] | overflow 恢复受次数限制，默认配置为 1；只有会话 surface 替换代数前进才重试，未减少上下文时保留原错误 [D5]               |
| 一般请求重试 | 区分限流、传输、不完整输出、认证、额度等；退避策略有有限 schedule，并考虑服务端提示和 hook [O4]                      | 在可见循环中区分 fallback、API 错误、中断与输出上限恢复；不对缺失模块里的完整网络策略作结论 [C1]               | `llm-retry` 根据 provider 策略决定：normal 有次数及错误码限制，always 允许持续重试；先记录重试事件，再可取消地等待 [D4] |
| 中断收尾     | 中断 fiber，补失败/未完成工具结果；另有 server restart 恢复及重复恢复上限，是否在 Anvil 场景生效待验证 [O3] [O8]     | 中断后补齐 tool result，保持调用/结果配对；Bash 失败可取消同批兄弟工具，其他独立读取失败不一概取消 [C1] [C2]   | `ToolCallRecovery` 补齐悬空工具与 turn/step 边界，区分未开始和已开始但结果未知 [D8]                                     |
| 记录边界     | SDK 内核有会话、step、用量和工具事件；Anvil 的适配只转发少量事件 [O3] [A1]                                           | `QueryEngine` 处理 transcript 与 usage；不等于任何崩溃时刻都完整落盘 [C6]                                      | 持久会话事件与 live agent 事件分离；成功消息与失败 attempt 有不同记录。硬崩溃发生在结算前，临时流仍可能丢失 [D1] [D8]   |

最值得借鉴的两个行为约束：

1. **有进展才重复恢复。** 更改上下文后才能证明下一次请求有不同的成功机会；一般传输退避仍需单独处理。不能把“重试次数更多”当成能力更强，Anvil 应有总体时间和资源限制。
2. **结果未知不能伪装成没执行。** DeepSeek 将“已记录工具开始但未记录结果”视为结果未知，并提示先检查有副作用操作的外部状态。它仍不保证 exactly-once；补齐消息结构也不保证撤销或恢复操作。

## 模型适配与官方 SDK 的位置

OpenCode 的 runner 与供应商适配分层，Anvil 当前实际配置仍固定为 BytePlus Responses / DeepSeek，尚不是产品级模型自由选择。DeepSeek Harness 有专用 DeepSeek 适配器，也有 `llm-pi-ai` 多供应商路由；`base` 中后者最初没有路由，用户配置后才激活，不应宣传成开箱即有所有模型 [D9] [D10]。

Claude 镜像中的模型/fallback 分支主要围绕 Claude 生态，不能从中推断 OpenAI/DeepSeek 的完整支持。官方 Agent SDK 提供 TypeScript / Python 接入，底层运行 Claude Code 二进制；公开 Python 封装可研究进程通信、权限回调、hooks 和事件，不等于公开当前完整内核。

官方参考（访问日期 2026-11-05）：[SDK 概览](https://code.claude.com/docs/en/agent-sdk/overview)、[Python 子进程通信](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/transport/subprocess_cli.py)、[控制协议](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py)。这些链接随主分支变化，不用于证明早期镜像行为。将来实测时固定 SDK、二进制、模型和配置；比较 Claude Code 行为要显式考虑 `claude_code` preset，SDK 默认提示词不完全相同，见[官方提示词说明](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)。

如将来接入，Claude SDK 是与 OpenCode 并列的执行后端候选；不在 OpenCode 循环内部再套一层 SDK agent。Anvil 的会话、审批、Git 与验收属于产品层；跨后端不假定可以直接迁移 SDK 内部 session 状态。

## Anvil 当前差距：先补接入，再判断内核

| 发现                           | 直接证据                                                                                        | 影响                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 工具细节未进入产品记录         | worker 将 `session.tool.called` 变成通用 activity；主进程没有 activity 的专门处理分支 [A1] [A2] | 难以定位正在运行的工具、耗时、失败和重复行为                    |
| 执行失败被归为通用信息         | `session.execution.failed` 不保留具体错误类别与原因 [A1]                                        | 认证失败、供应商失败、工具失败在界面上难区分                    |
| 验收循环与普通聊天断开         | 主进程可接收 acceptance 并执行有限修复；聊天入口仅传会话和文本 [A2] [A3]                        | 模型可能自行测试，但不能说普通发送已经进入 Anvil 的独立验收循环 |
| 恢复产品状态不等于恢复所有执行 | 重启将运行中任务标成 cancelled；保留 SDK session 再继续 [A2]                                    | 没有完整工具记录，无法在产品层区分未开始、失败和结果未知        |
| 压缩、用量和重试未完整接入     | worker 的事件 switch 未转发这些类别；snapshots 关闭 [A1]                                        | 缺少对长任务、成本、恢复及工作区变化的诊断依据                  |

Anvil 已有任务总超时、权限判断、持久历史和可选验收修复；无需否定重做。没有 acceptance 时正常模型结束标记为 `unverified`，而非已验证成功。验收命令通过也只证明其覆盖范围；当前获准的模型工具仍可能修改测试文件，不能当成独立评测判定器 [A2]。

## 建议实施顺序与可验证目标

以下是后续设计建议，不代表本轮已经实现。每个开发项开始前应补相应实现设计；本轮仅提交研究文档。

| 顺序              | 范围与方案                                                                                                                                                              | 验证目标                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| P0 执行记录       | 在现有 worker JSONL 边界映射实际可用的工具开始/结果、模型 step、用量、压缩、重试、停止原因；关联 task/session/tool ID。脱敏、限制体积，大结果保存引用；缺失用量表示未知 | 正常执行能串起完整生命周期；取消/崩溃显式留下未知结果；落盘和导出均不包含测试凭证；低信息事件不能编造成完整轨迹 |
| P1 固定评测       | 建小规模 coding fixtures 与故障注入；从同一初始文件树独立运行，外部判定器检查最终行为及越界修改；记录成功率、耗时、用量和人工介入                                       | 每个结论有任务、版本、配置、预算和结果证据；固定条件重复运行，报告样本数和波动                                  |
| P2 对话中的验收   | 接通已存在的 acceptance 后端；明确用户授权的检查命令与目录，检查失败回传证据并有界修复。普通聊天不强制附带项目测试                                                      | 分清模型结束、检查通过、失败、取消和限制；修复不改变检查命令；检查通过不自动等同整个需求完成                    |
| P3 定向可靠性修复 | 根据失败类型补约束保留、陈旧文件处理、未知副作用核查和停止策略；优先使用内核已有能力                                                                                    | 对应回归用例从稳定失败变成稳定通过，原有任务无明显退化；结果不能仅依赖提示词自述                                |

首批评测覆盖以下互相不同的失败方式：

| 场景                   | 外部判定要点                                       |
| ---------------------- | -------------------------------------------------- |
| 定位 bug 并修改        | 隐藏行为检查通过，未改无关文件                     |
| 跨文件功能改动         | 调用方、实现和必要测试一致，不能只靠一个命令退出码 |
| 测试失败后修复         | 能根据真实输出纠错，不删除或弱化判定器             |
| 大搜索/命令输出        | 被省略的关键信息可重新读取，结果引用有效           |
| 用户并行修改文件       | 冲突后重读或准确报告，不悄悄覆盖用户更改           |
| 工具执行中取消、再恢复 | 检查真实文件/进程状态，不能无依据重放有副作用命令  |
| 断流、限流和认证失败   | 分别恢复或及时停止；重试次数、等待与停止原因可见   |
| 长上下文与重复溢出     | 保留早期约束；恢复无进展时有限退出，不无限消耗     |
| 权限拒绝和无文件夹聊天 | 拒绝后不绕过执行；不需要文件的对话可以完成         |

对比拆成三组：固定同模型/尽量匹配预算比较 harness；固定 harness 比较模型；单独做无真实模型的故障测试。若三个执行器不能使用相同模型，不把结果差异归因于 loop。Claude SDK 与原生 Claude Code 的完整产品体验也应分开报告。

## 何时替换内核

只有当固定任务反复暴露某项内核限制、确认不是模型/供应商/适配丢事件造成，并且现有公开接口无法修复时，才考虑补丁、替换局部模块或自研 loop。决策还应包括维护代价、会话迁移和回归成本。

当前取舍：**复用 OpenCode 的模型/工具执行、已有压缩和大输出处理；Anvil 自己掌握任务定义、产品状态、执行证据、权限交互、验收和评测。** 不为未来替换预先建设通用插件平台。

## 源码索引

下列 O 链接锁定 npm 版本及构建文件；文件内部 `src/...` 标记和函数名用于定位。C / D 链接锁定 commit。实现与分析结论在上文分开，不把缺失分支当作不存在。

- O1：`src/session/run-coordinator.ts`，`run/wake/interrupt/settle`。
- O2：`src/session/runner/llm.ts`，`runStep`、`stepLimitReached`、overflow/continuation guards。
- O3：`src/session/runner/step.ts`，`attempt`、`toolRuns`、`failUnsettledTools`。
- O4：`src/session/runner/retry.ts`，`isRetryable`、`policy`、`schedule`。
- O5：`src/session/compaction.ts`，`SUMMARY_TEMPLATE`、`required`、`compact`。
- O6 / O9：`src/file-mutation.ts` 与 patch 工具中的 `withLock`、patch 校验。
- O7：`src/tool-output.ts`，`truncate`、`outputPath`。
- O8：`src/session/execution/restart.ts`，`prepareResume`、`recoverShell`。
- C1：`query.ts`，`queryLoop`、abort 收尾、stop-hook/API-error 分支。
- C2 / C3：流式调度器与 batch 调度器，两条路径不混为一种并发上限。
- C4：`autoCompactIfNeeded`、`microcompact`；仅断言已读分支。
- C5 / C6 / C7：文件编辑校验、`QueryEngine` 会话包装、大结果存储。
- D1：`ReactLoopAgent.turn/step`；D2 / D3：`executeToolBatch` 与 `executionMode`。
- D4 / D5：请求重试插件、压缩插件与默认配置。
- D6 / D7 / D8：文件观察策略、spill 策略、`ToolCallRecovery`。
- D9 / D10：实际 bundle 声明、多供应商适配器。

[O1]: https://unpkg.com/@opencode/core@2.0.0/dist/chunks/aisdk-native-yp2x3t23.js
[O2]: https://unpkg.com/@opencode/core@2.0.0/dist/chunks/aisdk-native-2sqe2en6.js
[O3]: https://unpkg.com/@opencode/core@2.0.0/dist/chunks/aisdk-native-ybc7xzk8.js
[O4]: https://unpkg.com/@opencode/core@2.0.0/dist/chunks/aisdk-native-xv61b48b.js
[O5]: https://unpkg.com/@opencode/core@2.0.0/dist/chunks/aisdk-native-rmbt0h7x.js
[O6]: https://unpkg.com/@opencode/core@2.0.0/dist/chunks/aisdk-native-aqpgmyrr.js
[O7]: https://unpkg.com/@opencode/core@2.0.0/dist/chunks/aisdk-native-9jdakqgh.js
[O8]: https://unpkg.com/@opencode/core@2.0.0/dist/session/execution/restart.js
[O9]: https://unpkg.com/@opencode/core@2.0.0/dist/chunks/aisdk-native-h6t842eb.js
[C0]: https://github.com/Shengfu-Zhang/claude-code-public-package-extract/tree/4e5426b82ab19c81244f165b4f18306944b8a169
[C1]: https://github.com/Shengfu-Zhang/claude-code-public-package-extract/blob/4e5426b82ab19c81244f165b4f18306944b8a169/src/query.ts
[C2]: https://github.com/Shengfu-Zhang/claude-code-public-package-extract/blob/4e5426b82ab19c81244f165b4f18306944b8a169/src/services/tools/StreamingToolExecutor.ts
[C3]: https://github.com/Shengfu-Zhang/claude-code-public-package-extract/blob/4e5426b82ab19c81244f165b4f18306944b8a169/src/services/tools/toolOrchestration.ts
[C4]: https://github.com/Shengfu-Zhang/claude-code-public-package-extract/tree/4e5426b82ab19c81244f165b4f18306944b8a169/src/services/compact
[C5]: https://github.com/Shengfu-Zhang/claude-code-public-package-extract/blob/4e5426b82ab19c81244f165b4f18306944b8a169/src/tools/FileEditTool/FileEditTool.ts
[C6]: https://github.com/Shengfu-Zhang/claude-code-public-package-extract/blob/4e5426b82ab19c81244f165b4f18306944b8a169/src/QueryEngine.ts
[C7]: https://github.com/Shengfu-Zhang/claude-code-public-package-extract/blob/4e5426b82ab19c81244f165b4f18306944b8a169/src/utils/toolResultStorage.ts
[D0]: https://github.com/deepseek-ai/deepseek-harness/tree/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159
[D1]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/agent-loop/src/agent.ts
[D2]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/tools/src/batch.ts
[D3]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/tools/src/pipeline.ts
[D4]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/llm/llm-retry/src/index.ts
[D5]: https://github.com/deepseek-ai/deepseek-harness/tree/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/compaction/compaction-basic/src
[D6]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/fs/fs-observation-policy/src/index.ts
[D7]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/spill/spill-policy/src/index.ts
[D8]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/session/src/repair.ts
[D9]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/bundle/base/cordis.patch.yml
[D10]: https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/llm/llm-pi-ai/src/index.ts
[A1]: ../runtime/opencode/worker.mjs
[A2]: ../desktop/main/agent.ts
[A3]: ../desktop/renderer/conversation.tsx

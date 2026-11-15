# 模型上下文预算与原生压缩

核查日期：2026-11-15。运行时：@opencode/sdk 2.0.0。

## Anvil 提供的配置

对 BytePlus 官方域名 ark.ap-southeast.bytepluses.com 下的 deepseek-v4-1-flash-261017 / 260910，未显式配置时使用 1,048,576 token 上下文、131,072 token 输出预算。输出预算采用供应商文档默认值，不将其称为模型最大输出能力。

用户显式配置优先。已有未设置 token 参数的模型配置无需修改持久化数据，下次启动 runtime 即使用新默认值。未知模型/其他网关保持 65,536 / 4,096 的保守回退。仅设置较小上下文时，默认输出预算会限制在上下文以内。

## OpenCode 2.0.0 实际行为

核查安装包 @opencode/core/dist/chunks 中 session/compaction.ts 和模型选项实现：

- auto 默认 true，buffer 默认 20,000，保留最近消息的目标预算为 15,000 token。
- 输出预留为 min(model.limit.output, 32,000)。
- 无独立 input limit 时，压缩触发上限为 context - max(输出预留, buffer)。
- 如果有 input limit，则再取 min(input - buffer, 上述上限)。
- 用最近的 token usage（含缓存、输出与推理）加新增消息估算增长，不按消息条数触发。
- 当前单次生成输出还被限制为最多 31,999 token。提高模型 output 字段不会解除这个 runtime 上限。
- 未配置 provider compaction 时使用原生本地总结流程；上下文溢出也有本地恢复路径。Anvil 不另写压缩循环，不调用 Anthropic 专有压缩接口。

因此默认 DeepSeek 配置下，按该版本算法得到的触发预算是 1,016,576 token。这是计算阈值，不是已经完成百万 token 压力测试的结论。没有将 Claude 的百分比阈值照搬到 DeepSeek。

## 验证范围

覆盖已知部署、旧配置自动取默认值、显式覆盖、未知模型/网关回退，以及非法预算。类型检查、桌面构建及 runtime 重新编译后使用真实接口连接测试。长会话压缩前后任务信息保真度仍需单独回归评测。

## 来源

- [BytePlus DeepSeek V4.1 Flash 参数](https://docs.byteplus.com/en/docs/modelark/deepseek-v4-1-flash)
- [DeepSeek 模型元数据](https://api-docs.deepseek.com/api/list-models/)
- OpenCode 已安装并锁定的 2.0.0 代码：session/compaction.ts、模型选项输出预算处理。

## 上下文续接回归测试

运行 `npm run eval:context`，需要通过 Keygrant 注入 BYTEPLUS_ARK_API_KEY 和 BYTEPLUS_ARK_RESPONSES_URL。测试使用独立临时目录与原生 session，不读取账号数据或长期记忆，不改变产品的 1M 配置。

流程：临时模型上下文 65,536、输出预算 8,192 → 设置任务代号/约束/下一步 → 加入确定性合成校验和文本 → 监听真实 `session.compaction.started/ended/failed` → 要求写 result.json → 本地程序验证结果与 protected.txt。最多六轮填充，每轮最多三分钟；未发生压缩、失败或未满足断言均报告失败。报告写到 `.anvil/evaluations/context-*/summary.json`，不保存密钥或模型推理。

2026-11-15 首次真实 DeepSeek 测试通过：第 3、4 轮各完成一次自动压缩；任务代号、禁止依赖、禁止提交、下一步回忆及压缩后工具执行通过，protected.txt 保持原样。

边界：这是缩小窗口、合成消息负载的功能回归。约束字段验证的是回忆，不能据此证明复杂任务中始终遵守约束；未验证百万 token 性能、长工具输出、长期多次压缩或真实项目修复质量。后续将用真实仓库任务扩展，不能以本测试替代 coding benchmark。

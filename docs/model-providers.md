# 模型供应商接入

Anvil 继续使用固定版本的 OpenCode SDK 2.0.0，不额外引入另一套 agent loop 或模型 SDK。

## 调用链

用户选择模型 → Electron 主进程校验配置、从已注入的 Keygrant 凭据中选择对应密钥 → 独立 OpenCode runtime → 原生 provider 适配器 → 模型 API。流式文本、工具请求和完成状态转换为 Anvil 的 JSONL 事件；工具请求继续经过 Anvil 的 Ask / Auto / Full 权限策略。

Anvil 负责账号、同步、界面、密钥引用和目录权限。OpenCode 负责会话、模型与工具之间的执行循环。provider 负责供应商请求格式、流式结果以及工具/图片协议转换。

## 本版开放能力

| 协议 | OpenCode package |
| --- | --- |
| Responses | @opencode/ai/providers/openai/responses |
| Chat Completions | @opencode/ai/providers/openai-compatible |
| Anthropic Messages | @opencode/ai/providers/anthropic |
| Google Gemini | @opencode/ai/providers/google |

模型菜单 → Add model 或模型右侧配置按钮。先选供应商预设，再填写真实模型 ID。预设包括 OpenAI、Anthropic、Gemini、DeepSeek、OpenRouter、BytePlus Ark；任意兼容服务可手动配置。

API 地址可填写 HTTPS base URL。Responses、Chat Completions、Messages 也接受匹配协议的完整 endpoint，保存原值、运行时去掉末尾协议路径。Gemini 填写版本级 base URL，如 /v1beta。拒绝 URL 中的用户名、密码、query、fragment，以及明显不匹配的协议路径。

密钥值不随配置同步；只同步 Keygrant 环境变量名。新增密钥引用仍需通过 Keygrant 注入并重启应用。图片能力、工具调用能力和 token 限制可配置，默认 context=65536、output=4096；这些是配置值，不代表自动检测成功。

旧配置未包含 protocol 时继续使用 Responses。现有 Ark 环境变量仍作为旧配置兼容入口；传给子进程时使用通用 ANVIL_MODEL_API_KEY / ANVIL_MODEL_ENDPOINT，启动后立即从 runtime 的环境中移除。

## 连接测试

“Save and test”通过同一个编译后的 OpenCode runtime 发起简短文本请求，使用隔离临时工作目录，不写入聊天历史；任何工具授权请求都会拒绝。测试完成清理临时目录。成功只表示文本连接成功，不等于图片、工具调用和所有模型参数都已验证。

已真实验证 BytePlus/DeepSeek 的 Responses、Chat Completions。Anthropic 和 Gemini 已接入适配器，尚待对应凭据进行真实验证。单元测试覆盖协议映射、旧配置兼容、地址规范化、危险地址拒绝、能力和限制保留、云端配置校验。

暂未自动抓取 OpenCode / models.dev 模型目录，也未开放订阅 OAuth、AWS/Vertex 云身份认证、任意 npm provider 插件或自动模型 fallback。现阶段供应商名称用于展示，协议决定实际适配器。

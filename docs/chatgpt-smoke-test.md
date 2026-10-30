# ChatGPT 订阅接入连通性测试

## 问题与目标

官方提供面向开源、本地应用的 Sign in with ChatGPT 预览流程，但文档可访问不代表当前用户账号已具备调用资格。本实验验证 Anvil 能否独立完成 OAuth 注册授权、查询可用模型并通过订阅额度完成一次 Responses API 请求。

这是独立的 Node.js 22 测试脚本，不代表已选定完整 harness 的实现方案。

## 方案

1. 将稳定、非秘密的主机 ID 保存在被 Git 忽略的 `.anvil/host.json`。
2. 启动仅监听 `127.0.0.1` 的临时回调服务，使用 PKCE、state 和 nonce 打开系统浏览器进行授权。
3. 使用授权返回的动态 client ID 交换令牌；验证 ID token 签名、issuer、audience、有效期、nonce 和订阅使用 scope。
4. 通过 stdin 将 access token 存入 keygrant 的 `ANVIL_CHATGPT_ACCESS_TOKEN`。不打印或写入明文凭据；不读取 Codex 现有登录文件。
5. 通过 keygrant 将令牌注入测试进程，查询账号模型列表，然后调用 Responses API，只要求模型回复 `ANVIL_OK`。
6. 只有收到 `response.completed` 且输出符合预期才算通过。HTTP 成功、开始输出或流提前结束都不算通过。

## 执行

```sh
npm ci
npm test
npm run chatgpt:login
keygrant exec --redact ANVIL_CHATGPT_ACCESS_TOKEN -- npm run chatgpt:probe
```

登录脚本会打开外部浏览器，由用户本人登录并同意授权。需要本机已安装并运行 keygrant。

默认使用模型列表中第一个可展示模型；也可显式选择列表里的模型：

```sh
keygrant exec --redact ANVIL_CHATGPT_ACCESS_TOKEN -- npm run chatgpt:probe -- --model MODEL_SLUG
```

该请求会消耗少量用户套餐额度。脚本仅发送固定测试文本，不上传仓库代码。请求设定 `store: false` 和 `stream: true`，不自动重试、不切换为付费 API Key。

## 范围与限制

- 当前只验证一个账号、一次请求；不实现工具调用、会话恢复、多账号管理或自动刷新令牌。
- 本机保存主机 ID 和已注册 client ID；令牌只经 keygrant 存储和注入。测试不保留 refresh token 或 ID token，access token 过期后重新登录。
- 同一已注册 client ID 绑定原账号与工作区；重新登录必须使用原账号。需要改用其他账号时删除 `.anvil/registration.json` 后重新注册，保留主机 ID。
- 若服务端拒绝动态注册、账号不具备资格或额度不可用，记录失败阶段及安全的错误代码，不能据此声称订阅接入已成功。
- 脚本自动关闭回调监听；登录最长等待 10 分钟，网络请求设有超时。

## 官方依据

- [开源应用订阅接入](https://developers.openai.com/siwc/token-sharing-open-source)
- [注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## 验证记录

2026-10-30：

- 官方 OIDC discovery 请求返回 HTTP 200，端点与文档一致。
- 7 项单元测试通过，覆盖 OAuth state 与 client ID、JWT 校验、SSE 分片、提前断流及流中额度错误。
- 脚本语法检查与 Git 差异空白检查通过；运行数据与依赖目录已被 Git 忽略。
- 真实登录在 OpenAI 授权页被拒绝，页面提示组织尚未启用此应用，错误码为 `3p_delegated_access_policy_denied`（依据用户提供的截图）。仅凭该提示尚不能确定具体工作区或管理员设置项。
- 本地回调未收到授权结果，10 分钟后自动超时并关闭监听；未获得令牌，未执行模型列表查询或推理请求。
- 随后按用户要求改用个人工作区重试：收到包含已注册 client ID 的 OAuth 回调，但令牌兑换返回 HTTP 400 / `invalid_grant`。尚未验证账号身份或获得可用令牌。
- 按官方恢复流程保留已注册 client ID，重新发起一次授权；回调返回 `access_denied`，流程停止并关闭监听。该错误本身不足以判断是用户拒绝、工作区策略还是其他服务端限制，需结合授权页提示排查。
- 保留旧注册记录并开始新注册以选择企业工作区后，用户再次看到 `3p_delegated_access_policy_denied`。已结束本地等待，不继续重复授权。
- 补查官方 [Quickstart](https://developers.openai.com/siwc/quickstart) 和 [用户说明](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)：明确列出的套餐使用资格是符合条件的 Plus 和 Pro；本次未找到 Enterprise 自助启用该能力的入口或适用说明。不能将组织策略拒绝直接等同于 owner 有开关可以解除，企业可用性需向 OpenAI 确认。

单元测试只验证本地协议处理，不代表真实账号可用。

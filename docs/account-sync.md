# 账号与配置同步（第一版）

桌面端登录 Google 后使用；服务端是独立的 anvil-cloud 项目，部署到 Cloudflare Workers，D1 保存账号、会话和配置。接口地址 https://anvil.keygrant.app，Google Web OAuth 回调 https://anvil.keygrant.app/auth/callback。

## 数据边界

- 云端：Google 用户 ID、邮箱、显示名；登录设备及过期时间；模型 profile 的名称、model ID、HTTPS Responses URL、Keygrant 变量名、视觉能力；默认模型；Group 的 ID、名称和顺序。
- 本地：聊天、草稿、任务历史、附件、工作目录、目录授权、权限模式、Group 折叠状态。按 Google 用户 ID 的 SHA-256 目录分开保存。
- 密钥：模型 API key 留在本机 Keygrant；Google client secret 仅位于 Keygrant 和 Worker secret；桌面会话 token 使用 Electron safeStorage 加密落盘，不进入 renderer。

## 登录与同步

桌面生成一次性 verifier，仅将 SHA-256 challenge 提交给服务。系统浏览器完成 Google OAuth；Worker 校验 PKCE、nonce、issuer、audience、已验证邮箱及浏览器 cookie。桌面凭 verifier 兑换一次性结果。会话有效期 30 天，可退出或撤销其他设备。

首次登录可显式导入旧版的本机数据，旧数据保留原副本。首次云端配置由本机模型及 Group 初始化；已有云配置作为准本。聊天从不上传。

配置修改通过 revision 条件更新提交成功后才应用到本机。409 表示其他设备已修改，需要手动刷新并重做该次编辑；目前不做字段自动合并或离线写入队列。桌面每分钟拉取配置，也可手动刷新。Group 删除只解除本机聊天的分组，不删除聊天。

## 运维和验收

后端需要 D1 migration、Google OAuth Web client ID、GOOGLE_CLIENT_SECRET、域名路由。部署脚本在独立后端目录，密钥通过 Keygrant 注入，不写入配置文件。

自动化检查覆盖账号隔离、未登录拒绝、一次性登录交换、revision 冲突、会话撤销、Group 同步保留本地数据。真实 Google 登录和两台电脑同步仍需实际账号验收；仅入口重定向成功不代表完整 OAuth 已验收。

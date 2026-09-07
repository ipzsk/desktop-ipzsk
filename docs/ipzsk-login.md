# IPZSK 登录后直接使用模型

正式版和 Beta 均在启动本地 Host 前完成邮箱＋密码登录、账户校验和模型服务连接。首次设置向导自动跳过，沿用产品默认偏好；相关偏好仍可在设置中调整。未登录、模型服务未就绪或关闭登录窗口时不会进入工作区。

## 启动流程

1. 固定向 `https://api.ipzsk.com` 请求 `GET /api/account/status`，检查 `password_login_ready`。
2. 新登录调用 `POST /api/auth/sign-in/email`，提交邮箱和密码。注册、找回密码通过固定的网站账户入口打开。
3. 新登录或恢复登录后调用 `GET /api/me/profile`，然后 `POST /api/me/desktop/bootstrap`。
4. 后台返回会话绑定的调用凭证、支持的模型列表和默认模型。当前默认 `gpt-5.6-sol`，可选 `gpt-4o-mini`；实际列表取产品支持目录与启用号池的交集，不把图片、视频或音频模型加入聊天选择器。
5. 在 Host 启动前自动设置 `llm-pi-ai.providers.ipzsk` 和 `agent-default-model`。已保存且仍可用的 IPZSK 模型选择保留，其他插件配置保持原样。
6. 复用已安装的 pi-ai OpenAI Chat Completions 适配器，请求 `/v1/chat/completions`，支持流式输出和适配器已有的工具调用。

## 凭证生命周期

- 登录页不接触 Cookie 或模型调用凭证；请求由 Electron 主进程发送，密码只用于登录，不持久化。
- “记住登录”使用 Electron safeStorage 加密保存签名会话 Cookie。系统加密不可用时，取消该选项仍可登录。
- 模型调用凭证仅驻留内存，通过 Host 的 launch-environment 提供 `IPZSK_DESKTOP_API_KEY`。不写入设置文件、托管凭证文件或 `process.env`。
- 后台每个登录会话对应一个 access_tokens 记录。恢复登录会轮换该记录的随机秘密，避免每次启动新增永久 Key；独立登录会话彼此隔离。
- 调用凭证有效期不超过签发时的登录会话；网关在接收调用及排队后提交上游前均检查会话、用户状态和凭证有效性。
- 退出登录立即清空本机凭证并关闭应用；后台 sign-out 使对应调用凭证失效。网络不可达时本机仍退出，远端会话需等待过期或后台撤销。
- 密码重置撤销原会话，因此关联的桌面调用凭证也失效。手动撤销桌面 Key 后，当前会话不能重新签发，需重新登录。
- 默认会话期限为 7 天；持续运行直至到期时，需要重新登录。付费、额度和模型准入仍由服务端执行，客户端启动门禁不承担服务端授权责任。

## 验证（2026-09-07）

- 45 项客户端相关测试通过：密码登录、会话保存/恢复、窗口门禁、模型设置、真实已安装适配器的鉴权和流式请求。
- 后台 65 项单元和隔离数据库集成测试通过，含多设备、凭证轮换、退出、密码重置、用户隔离。
- 正式接口用独立验收账号完成密码登录 → bootstrap → gpt-5.6-sol 调用 → 账户归属检查 → 退出 → 401 验证；验收后账号停用，调用凭证撤销，测试密码清除。
- 正式后台 `password_login_ready: true`，`registration_ready: false`。已有验证账户可用密码登录；注册和密码找回仍受邮件服务就绪状态限制。

本次源码变更不包含安装包的公开发布或开发者签名公证。

## 独立客户端与插件修复（2026-09-07）

- 应用名为 IPZSK Desktop / IPZSK Desktop Beta，应用 ID 为 com.ipzsk.desktop / com.ipzsk.desktop.beta。
- 在获取单实例锁前设置独立 userData，默认 Harness home 位于其中的 dsh-home。macOS 正式版路径为 `~/Library/Application Support/IPZSK Desktop`。不自动读取或迁移旧 DSH 的登录、会话和配置；旧应用数据保留。
- standard 预设的 23 项是内置功能模块。原发现逻辑只检查实体 node_modules，遗漏桌面 Profile 到安装包的解析钩子。两条发布通道使用 Yarn patch 修复发现逻辑，同时继续拒绝缺失插件和不属于当前 Profile 的解析。
- 正式版 41 项、Beta 46 项相关测试通过（各 1 项平台跳过），两套类型检查通过；正式版完整 Host 的 standard 会话创建与释放通过；实际 Electron ASAR 运行检查通过，包含 standard 预设发现。

## 本机应用包

Apple Silicon Mac ZIP：`dsh-plugin-desktop/dist/IPZSK Desktop-2.0.5-arm64-mac.zip`；应用目录为 `dsh-plugin-desktop/dist/mac-arm64/IPZSK Desktop.app`。ZIP 与 Electron fuses 验收通过。此包未做开发者签名/公证，没有公开发布。

使用现有未签名打包入口及显式 `--mac zip --arm64`；没有关闭打包验证。新应用已独立启动至 IPZSK 登录窗口。未代替用户在图形界面输入真实账户密码；真实服务端登录与模型调用的验收记录见上文。

## GPT 5.6 Sol 工具请求兼容修复（2026-09-07）

上游的 Chat Completions 接口要求 GPT 5.6 Sol 携带函数工具时显式发送 `reasoning_effort: "none"`。客户端在自动模型配置中为该模型声明 `reasoningEfforts: { off: "none" }`，用 Yarn patch 允许现有适配器表达仅支持 off 的配置。界面只提供 off，不伪造可用的推理档位；GPT-4o mini 不受影响。正式版和 Beta 均应用此修复，启动时自动覆盖已有 IPZSK 模型配置，无需用户修改设置。

两套真实适配器测试覆盖两个模型的有工具/无工具请求，检查实际请求 JSON 与能力目录。上游最小工具请求已验证返回 200 和完整 SSE。新的 Apple Silicon 包输出到 `dsh-plugin-desktop/dist/tools-fix/IPZSK Desktop-2.0.5-arm64-mac.zip`，与上一包分开保存；需退出正在运行的旧版并打开新包中的应用。

## 默认 IPZSK API 启动修复（2026-09-30）

将账号模型配置提前到 Host 的 profile 组装阶段。首次插件初始化即读取 IPZSK 默认模型；保存的 IPZSK 模型仍获授权时保持选择，旧地址由账号渠道配置覆盖，密钥保持仅在内存中使用。

- 负向验证：新增真实 Host 检查在修复前捕获到初始 `deepseek-official / deepseek-flash`，修复后通过。
- 定向账号授权、启动数据及模型流式请求测试 31 项通过；验证从默认模型选择发出的请求使用 `https://api.ipzsk.com/v1/chat/completions` 与登录授权。
- `build:lib:host`、相关源码与测试 oxlint、双插件真实 Host 冒烟及 `git diff --check` 通过。
- 未调用真实付费模型，未签名或发布安装包。

# 3.0.0-beta.4 / Harness 0.2.0-rc.2 验证

验证日期：2026-09-30。官方源码固定为 `639ed015397290b3745d163aafe02ffee4aa3f84`，产品版本为 `3.0.0-beta.4`，分支为 `codex/ipzsk-desktop-0.2.0-rc.2`。

- `node scripts/run.mjs install`：固定 lockfile 安装通过。
- `node scripts/run.mjs build`：完整官方构建通过，包含 Host/Client TypeScript、Electron 主进程与预加载、Web 客户端。
- 官方 Vitest 的 IPZSK 账号、模型、市场和登录 Shell 环境测试：81 项通过。
- 相邻上游宿主进程、项目管理、设置及插件包操作测试：153 项通过、1 项平台条件跳过。
- `node --test tests/*.test.mjs`：13 项通过，覆盖私有启动 IPC、取消与断连、无效数据、签名环境隔离及打包配置。
- `node scripts/build-plugins.mjs` 及作图插件 `scripts/smoke.mjs`：构建、类型检查和界面/路由回归通过。
- `node tests/plugin-host-smoke.mjs --imagegen`：真实官方 Host 加载双插件、认证拒绝、模型目录、配置保存与凭据脱敏、模拟图片生成、Word→Excel 下载、超过 4 MiB PDF 分块上传及哈希校验通过；确认产品统计与会话反馈导出器没有加载，测试没有外部模型请求。
- 官方 oxlint 对接入涉及的主进程、Host、CLI profile runner 及插件包操作文件检查通过。
- IPZSK 公开 `/api/account/status` 接口响应正常，`password_login_ready` 为 `true`。该检查只证明后台公开状态，没有使用真实账户密码。

本次未进行真实账号登录、付费模型调用、实际大文件压力测试、签名公证、Windows 构建、安装包发布或官网部署。以下为旧版本历史验证记录。

---

# 3.0.0-beta.3 / Harness 0.1.7-rc.2 验证

升级基线：`477b4f420553e8a52c2fbccc464d7561b239c443`（2026-09-24 官方版本），产品版本 `3.0.0-beta.3`。本次使用合成数据和临时目录，不访问真实账户或付费模型。

- `node scripts/run.mjs install`：固定 lockfile 安装通过。
- `node scripts/run.mjs build`：官方完整构建通过，包含 TypeScript、Electron 主进程/预加载和 Web 客户端。
- 官方 Vitest 中的 `apps/desktop/tests/ipzsk`、`apps/desktop-host/tests/ipzsk`：60 项通过，覆盖账号协议、模型流式调用、私有启动数据、真实 pnpm 插件安装、校验/降级限制、共享锁和旧生图版本升级。
- `node --test tests/*.test.mjs`：13 项通过，覆盖真实子进程启动、超时、取消、父进程断开、无效凭据和签名环境隔离及打包配置。
- 相邻上游测试（宿主进程、项目管理、配置编辑、包操作）：153 项通过、1 项平台条件跳过。
- 官方 oxlint 定向检查通过，覆盖插件安装、首装升级、启动数据、Host 入口和包操作；`git diff --check` 通过。
- 作图插件 `scripts/smoke.mjs`：全部场景通过，含 jsdom 中的侧栏、生成面板、设置页注册和聊天图片操作。
- `node scripts/build-plugins.mjs`：文档插件及作图插件构建通过，作图插件类型检查通过。
- `node tests/plugin-host-smoke.mjs --imagegen`：真实官方 Web Host、模块图、认证拒绝、模型目录、插件配置保存与凭据脱敏、模拟作图及图片 GET/HEAD、Word→Excel 下载、超过 4 MiB PDF 分块上传与哈希核对通过。

本次未进行真实账号登录、付费模型推理、数千页实际 PDF 压力测试、macOS 签名/公证打包、Windows 构建或官网发布。下面保留旧版本历史记录，不能作为 beta.3 的安装包验收结果。

---

# 3.0.0-beta.1 验证记录

验证日期：2026-09-12。平台：macOS Apple Silicon。

## 产物

- 应用：`IPZSK Desktop Next`，标识 `com.ipzsk.desktop.next`。
- DMG：`artifacts/IPZSK.Desktop.Next-3.0.0-beta.1-arm64.dmg`，251,593,341 字节。
- SHA-256：`99a55a3fcd6cf4719cf9bc527d0daa08faae2b9d94cdaecf3421a2fc2e830583`。
- 官方源码：`c291e7961a515f6d7af9304e7fd1d257929aef26`；Node 24.17.0、Electron 44.0.0。
- 内置首装归档：文档转 Excel 0.3.0-beta.1、生图 1.8.0-beta.1；两份归档大小和 SHA-256 与打包清单一致。

## 已通过

- 完整官方工作区构建，包括 IPZSK 覆盖模块与 Electron 主进程。
- 账户、模型行为：35 项；一次性 IPC 启动和清理：11 项真实进程检查。
- 市场、首装及官方回归：55 项通过、1 项官方跳过；之后版本比较和禁止降级变更的 18 项定向检查通过。两组包含重叠检查，不合计数量。
- 文档插件：24 项 Node、8 项 Python；生图：32 项 smoke、4 项离线模板检查。
- 两插件从官方依赖重建，类型检查通过；29 个生图开发依赖链接全部限定在生成的官方工作区内。
- 真实双插件 Host：Cordis 同一实例、依赖图、客户端模块加载、账户渠道注入、模拟生图和图片 GET/HEAD、Word 经 Python 导出 Excel、跨越 4 MiB 分块的 PDF 上传及文件散列一致。测试使用合成文件和临时目录，没有外部网络或付费模型请求。
- 最终过滤运行时：真实 flock 互斥和重新获取、Koffi、Sharp、HTML、PTY 检查通过；内置 Node 启动独立 Host，正确返回本地前端。
- electron-builder 完成 DMG；打包后的全部运行时文件及权限通过官方完整性校验；应用 ID、版本、插件归档检查通过。
- 实际启动打包应用，已看到可交互的 IPZSK 登录窗口。
- `git diff --check` 通过；原有用户改动保留。

## 尚未验证及发布边界

- 等待用户在新窗口登录后检查真实账户工作台与插件界面。未读取或迁移旧客户端凭据。
- 未调用真实付费模型，未用三四千页真实 PDF 做准确率、耗时与内存峰值验收。
- 当前为本地未签名预览包。未做 Apple 公证、Windows/macOS Intel 构建、2.x 会话迁移或正式自动更新验收。
- 预览包不携带自动更新配置；本次没有提交、推送、GitHub 发布或官网部署。

## 重建

见 `README.zh.md`。`package-preview.mjs` 会重建两个插件并保留打包后的运行时完整性检查。构建缓存不进入 Git，也不打入应用。

两处打包 smoke 已随补丁维护：旧 `fs-ext` 检查更新为生产使用的 flock；Host smoke 使用合成账户启动数据走正式 IPC 通道。生产登录和凭据校验保持启用。

## 3.0.0-beta.2 登录后启动修复

实际账号登录测试确认密码验证、账户会话和桌面模型授权均成功。随后发现 beta.1 的正式安装包缺少生图插件声明的三个共享依赖：client-store、client-ui-primitives、client-ui-slots，导致启动中断。原先使用完整源码依赖树的 Host 测试没有覆盖该分发问题。

修复将这三个官方平台模块纳入共享运行时依赖闭包，并修复重复准备源码时保留旧产品版本号、旧打包缓存混用和生成预览脚本的类型检查问题。

新增 `tests/packaged-plugin-startup.mjs`：使用真实 Resources、内置 Node 和 pnpm，在临时目录完成双插件首次安装及启动；旧 beta.1 资源可稳定复现缺失依赖错误，beta.2 首次安装及同一失败目录的恢复均通过。此检查已接入打包脚本。

本机 `/Applications/IPZSK Desktop Next.app` 已更新为 beta.2。使用用户提供的账户在新版本中实际登录成功，已进入工作台并打开文档转 Excel 面板，显示准备就绪。未执行付费模型生成或真实文档上传。旧应用文件已留存于 artifacts/previous-installed-3.0.0-beta.1.app，用户数据未重置。

新 DMG：`IPZSK.Desktop.Next-3.0.0-beta.2-arm64.dmg`，251,761,251 字节。SHA-256：`7b4aa3f48afc120559ca46ca8570f21fc299ed0235dc3be3e875b75dde487c9b`。仍是未签名本地预览，未发布到官网或 GitHub。

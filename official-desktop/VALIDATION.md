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

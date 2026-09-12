# IPZSK Desktop Next

`3.0.0-beta.2` 使用官方 DeepSeek Harness 桌面架构，源码基线为 `0.1.5-rc.2 / c291e7961a51`。官方 Electron 壳、独立 Node 后端、分帧流传输和 `dsh-app://` 协议保留；IPZSK 的账号、模型和审核市场通过独立模块接入。

新版使用单独的 `IPZSK Desktop Next` 数据目录。现有 2.x 会话和已安装插件不自动迁移；后续迁移需按新版会话格式验证。插件继续作为外部依赖独立安装、更新，文档任务数据放在插件包目录之外。

首次启动安装适配后的文档转 Excel `0.3.0-beta.1` 和生图 `1.8.0-beta.1`。首装失败可以继续重试；完成后主动卸载不会再次自动安装。市场阻止降级，旧版审核目录不会覆盖这些新版插件。

## 编译与启动

需要 Node `^22.19.0` 或 `>=24`，通过 Corepack 使用官方固定的 pnpm `11.7.0`。外层仓库仍沿用原 Yarn 工具链。

```sh
cd official-desktop
node scripts/prepare.mjs
node scripts/run.mjs install
node scripts/run.mjs build
node scripts/run.mjs start
```

准备脚本下载并校验锁定提交的归档，只在 `.build/upstream` 中应用差异补丁和 IPZSK 模块。原有上游子模块及旧客户端源码保持独立。编译命令不会打开窗口；启动命令明确打开开发版。开发版依照官方规则禁用插件包修改，安装体验需用打包版本验证。

## 本机预览安装包

```sh
node scripts/package-preview.mjs
```

当前生成 macOS Apple Silicon 本机预览包。它沿用官方的依赖物化、原生模块检查和运行时文件完整性验证；单独的预览准备脚本跳过签名，正式发布脚本的签名和公证要求保留。预览包没有自动更新配置，也不会上传产物。

正式发布需要 IPZSK 自有签名身份、公证配置和更新源；生产更新源必须通过 `IPZSK_DESKTOP_UPDATE_ORIGIN` 明确提供。本预览不更改官网、已发布 GitHub 版本或 2.x 更新渠道。

## 验证

```sh
node --test tests/bootstrap-channel.test.mjs
node tests/plugin-host-smoke.mjs
node tests/plugin-host-smoke.mjs --imagegen
```

实际 Host 冒烟使用临时目录与合成文件，验证真实 Cordis 加载、ModuleLoader、官方分帧响应、Word 转 Excel 下载及超过 4 MiB 的 PDF 分块上传，同时检查没有 Web 监听端口。测试不调用付费模型。

`--imagegen` 额外加载生图插件，验证账号渠道注入、模拟生成、图片 GET/HEAD 与客户端模块图。生图采用新版聊天附件接口，图片存储同样隔离在插件数据目录中。

账户、模型及市场测试随模块复制进官方工作区并通过 Vitest 执行；文档插件另有 Node 和 Python 回归测试。真实账号登录、付费模型调用和长篇实际文档验收需要在预览窗口中进一步确认，单元与合成样本结果不能替代这些验证。

`upstream.lock.json` 记录来源与版本，`patches/` 保存上游差异，`overlay/` 保存产品模块，`plugins/` 保存独立插件。`.build/` 与 `artifacts/` 均不进入 Git。官方版权、MIT 许可和第三方声明随运行时保留。

## 签名构建

GitHub Actions 的 `IPZSK Next signed macOS` 工作流在 `codex/next-signed-build` 分支生成 Apple Silicon 安装包。复用仓库已有的六项签名及公证 Secrets，仅在签名步骤导入临时钥匙串，结束后清理。

本地已配置对应环境变量时，可以运行 `npm run package:signed -- --reuse-build`（此前需完成依赖安装与构建）。签名流程对原生运行时、应用和 DMG 依次签名与验证，并向 Apple 提交应用及 DMG 公证，附加票据。安装包启动验证通过后才上传 Actions artifact。产物位于 `artifacts/signed/`，包含 SHA-256 校验文件；该工作流不创建 Release，也不切换官网和自动更新。

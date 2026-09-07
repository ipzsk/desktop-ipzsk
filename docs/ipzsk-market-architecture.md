# IPZSK 插件独立发布与更新

## 发布边界

- Desktop 主程序负责账户、通用插件安装和恢复、IPZSK 市场入口。
- 后台负责插件目录、审核、上下架、运行配置与独立计费。
- 生图代码来自 JayceHuang/dsh-imagegen 的独立 GitHub Release，未进入 Desktop 的生产依赖。

客户端的插件市场直接显示 IPZSK 已上架的插件。固定目录为 `/api/me/plugin-market`；本地 Host 只接受插件 ID 和审核版本 ID，重新向后台验证后下载 GitHub 产物。核验包名、版本、文件大小与 SHA-256，通过后才能安装。用户不能在 IPZSK 市场添加外部来源或绕过审核安装 npm latest。

产品显示名为 dsh-ipzsk-market；内部 package、Profile provider key 和源码目录仍保留 community-market 身份，以保留已有客户端配置。原 dsh-market 独立保留为可选市场。

## 插件更新 SOP

1. 在插件仓库修改代码并更新 package.json / protocol.ts 版本。
2. 构建、测试、npm pack，创建同版本 GitHub Release 并上传 tgz。
3. 开发者中心提交 Release URL，管理员审核上架。
4. 客户端打开插件市场，点击检查更新，再点击插件的更新按钮。
5. 安装前保存恢复检查点，安装精确的审核产物，重启后加载新版本。无需重新编译主程序。

安装失败会恢复依赖清单并重新安装旧依赖。安装后无法启动时可以通过恢复中心恢复健康检查点。插件数据目录不参与安装替换；插件作者仍需保证自身数据格式迁移的兼容性。

生图插件继续保留 @dickpy/dsh-imagegen 的包身份，使本机原作者版可以原位升级；只从 JayceHuang 的 GitHub Release 下载，不向原作者 npm 命名空间发包。插件自身不能绕过 IPZSK 审核更新。

## 客户端更新 SOP

1. 修改 Desktop 版本并构建相应平台安装包，验证后发布到 JayceHuang/ipzsk-dsh-desktop 的 GitHub Release。
2. 在后台 src/desktop-releases.json 登记频道、版本和 GitHub 附件名，并部署后台。
3. 客户端从 api.ipzsk.com/api/desktop/version 检查版本，从对应 download 端点下载目标版本；已安装插件和用户数据位于应用包外。

本次产物为 2.0.6 / macOS Apple Silicon，未签名公证。其他平台需构建并验收对应安装包后登记发布。不要将 ARM64 安装包用作 Intel 或 Windows 更新。

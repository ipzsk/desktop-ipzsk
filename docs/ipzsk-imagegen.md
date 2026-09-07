# IPZSK 模型适配与独立生图插件

当前后台开放 GPT 5.6（`gpt-5.6-sol`）聊天和 GPT Image 2 生图。登录后自动连接，无需填写模型地址或 API Key。

## 如何生图

1. 退出旧 IPZSK Desktop，打开新包中的 IPZSK Desktop。
2. 登录后直接在对话中说：“用生图工具生成一张蓝色圆形图标，白色背景，1:1。”
3. GPT 5.6 调用 `generate_image`；独立的 `@dickpy/dsh-imagegen` 插件执行任务并展示图片。插件也提供生图工作台。

本机已通过官方 `dsh plugin --profile desktop add` 安装 `@dickpy/dsh-imagegen@1.5.6`。它位于 IPZSK 的 Profile 依赖中，未加入主工程生产依赖，也未复制进客户端源码。全新机器需单独安装该插件；主程序不会静默下载插件。

## 独立安装与更新

使用本仓库的管理脚本和已安装的 IPZSK 应用：

```sh
node scripts/ipzsk-plugin.mjs "/Applications/IPZSK Desktop.app" @dickpy/dsh-imagegen@latest
```

指定版本即可固定或回退。更新后重启客户端；无需重新编译主程序。脚本使用应用自带的 Electron/DSH CLI，明确指定 IPZSK 数据目录和 `desktop` Profile。上游插件自身的更新器默认选择 `web` Profile 且依赖系统 `dsh`，因此当前桌面发行版使用上述命令更新。

插件源仓库：https://github.com/dickpy/dsh-imagegen 。单独研究用 checkout 位于主工程之外，未修改上游插件。

## 边界

- 后台 `model-catalog.mjs` 维护产品模型目录、插件渠道配置和模型参数转换。
- 客户端聊天入口使用统一 Chat Completions 协议，不包含模型 ID 条件分支。
- 后台 bootstrap 返回 `plugin_configs`，描述已安装插件的配置行与凭证字段路径。客户端仅对可解析的已安装插件应用配置，不安装后台指定的任意代码。
- 会话凭证只注入本次 Host composition 内存配置，不写入用户设置或插件文件。后台仍检查会话有效性和任务归属。
- GPT 5.6 Chat 工具请求由后台设置 `reasoning_effort: none`；之前的客户端适配器 patch 已删除。
- GPT Image 2 的像素尺寸与 quality 由后台转换为上游的比例与 resolution。当前验证文生图；插件图生图 `/images/edits` 尚未接入本网关。
- 图片通过已鉴权、按用户隔离的后台图片端点返回，后台抓取 CDN 时不转发登录凭证。
- 插件源码、版本、历史和画廊归独立插件管理；主程序仅负责通用登录和配置注入。

## 验收

2026-09-07：65 项后台回归通过；客户端通用配置和实际适配器测试通过；完整 Host 验证插件的 Agent 工具注册与浏览器模块图。

独立验收账号真实完成：密码登录 → 获取后台插件配置 → GPT 5.6 选择 `generate_image` → 调用原版插件 → GPT Image 2 任务完成 → 下载图片 → 插件返回一张图片附件引用。退出后会话撤销、验收账号停用。

Mac Apple Silicon 包：`dsh-plugin-desktop/dist/plugin-integration/IPZSK Desktop-2.0.5-arm64-mac.zip`。未做开发者签名公证。

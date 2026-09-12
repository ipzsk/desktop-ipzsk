# 更新 punk 内容

当前来源：adrianpunk/Punk-Skill，固定提交记录在 src/punk-source/SOURCE.json。

1. 审阅上游变更，更新 src/punk-source 下的 Skill、风格、引用文档和 MIT LICENSE，并记录新的固定提交。
2. 更新 src/templates/punk-images.json 的预览图映射，URL 固定到该提交；新增风格的预览路径也写入此文件。
3. 执行 node scripts/import-punk.mjs，重建分类目录和模板。
4. 运行 npm run build、node --test scripts/test-punk.mjs、node scripts/smoke.mjs，并核对新增风格数量。
5. 同步 package.json 和 src/protocol.ts 的插件版本，npm pack --ignore-scripts，然后创建 GitHub Release 并上传 tgz。
6. 在 IPZSK 后台导入该 Release、审核上架；客户端通过插件市场更新并重启。

仅模板库里「punk」随插件更新。其他原有案例库保留其既有刷新方式。

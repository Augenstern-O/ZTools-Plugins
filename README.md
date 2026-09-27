# ZTools 插件

本人（Augenstern）开发与移植的 ZTools 插件合集，每个插件一个独立子目录。

- 作者：Augenstern
- GitHub：https://github.com/Augenstern-O

## 插件列表

| 插件 | 说明 | 当前版本 |
| --- | --- | --- |
| [long-image-stitch](long-image-stitch/) | 长图拼接：将多个图片拼接成一张长图 | v0.0.1 |

## 目录约定

- 每个插件一个子目录，目录名 = 插件 ID（英文 kebab-case）
- 插件子目录内各有自己的 `README.md`（插件介绍）与 `AGENTS.md`（该插件的维护约束）
- 打包产物保留在本地各插件的 `dist/` 目录，由 Git 忽略；下载通过仓库 Releases 提供
- 各插件的 `scripts/` 提供零依赖的打包与校验脚本

## 下载与发布

在[仓库 Releases](https://github.com/Augenstern-O/ZTools-Plugins/releases) 中按插件标签下载 `.zpx` 附件。每个插件独立发布，例如 `long-image-stitch/v0.0.1`。

发布前在对应插件目录执行 `node scripts/pack_zpx.js` 和 `node scripts/verify_zpx.js`，然后将生成的安装包上传到对应 Release。安装包不提交到源码仓库。

## 维护约定

版本规则、插件 ID 命名约束、仓库结构、打包命令与移植规范见[AGENTS.md](AGENTS.md)；单个插件的专属约束见各子目录下的 AGENTS.md。

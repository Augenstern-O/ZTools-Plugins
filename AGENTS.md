# AGENTS.md

本仓库用于收录本人开发的 ZTools 插件，每个插件一个子目录（目录名 = 插件 ID）。本文件是**仓库级**维护约束；
单个插件的专属约束（元数据、指令集合、资源结构等）写在对应插件子目录自己的 AGENTS.md 中。

## 作者与归属

| 项 | 值 |
| --- | --- |
| 作者 | Augenstern |
| GitHub | https://github.com/Augenstern-O |

移植类插件可在其子目录的 AGENTS.md 中标注原插件出处（插件 ID、版本、作者、主页）。

## 版本规则

版本号格式 `x.y.z`（语义化版本），每个插件从 **v0.0.1** 起版：

| 升级类型 | 版本号变化 | 示例 |
| --- | --- | --- |
| 小升级（修复、微调） | 只动小版本号（第三位） | 0.0.1 → 0.0.2 |
| 中升级（新功能、较大改进） | 动中版本号（第二位），小版本号归零 | 0.0.2 → 0.1.0 |
| 大升级（重大重构、不兼容变更） | 动大版本号（第一位），中、小版本号归零 | 0.1.0 → 1.0.0 |

升版本必须同步修改该插件 `plugin.json` 的 `version` 字段，并重新打包 `.zpx`（打包脚本会自动把版本号写进产物文件名）。安装包只保留在本地 `dist/` 并作为 GitHub Release 附件发布，不提交到 Git。

## 插件 ID 命名约束

- `plugin.json` 的 `name`（插件 ID）**必须英文 kebab-case**，匹配 `/^[a-z][a-z0-9-]*[a-z0-9]$/`。
  依据：官方插件库 256 个插件无一使用中文 ID；官方 CLI 的发布校验(`validatePluginName`)只接受该格式，中文 ID 无法通过官方渠道上架。
- 中文只用于 `title`（显示名）。
- 插件子目录名与插件 ID 保持一致。
- 宿主持有的 `title` 不可与已安装插件重复，否则安装被拒。

## 仓库结构与打包

```
<repo>/
├── AGENTS.md                ← 本文件（仓库级约束）
├── .gitignore               ← 排除第三方版权材料
└── <plugin-id>/             ← 每个插件一个目录，目录名 = 插件 ID
    ├── AGENTS.md            ← 该插件的专属约束
    ├── README.md            ← 插件介绍
    ├── dist/                ← 本地打包产物 <标题>-v<版本>.zpx（Git 忽略）
    ├── public/              ← 插件实体（ZTools 开发者工具可直接添加此目录）
    │   ├── plugin.json
    │   ├── preload.js
    │   ├── index.html
    │   ├── app.bundle.js
    │   └── assets/...
    ├── references/          ← 参考文件（原插件、原插件代码等）
    └── scripts/             ← 打包与校验脚本
```

每个插件的 `scripts/` 下提供打包与校验脚本，仅依赖 Node 内置模块：

```bash
node scripts/pack_zpx.js     # 打包到 dist/<插件标题>-v<版本号>.zpx（版本读自 plugin.json）
node scripts/verify_zpx.js   # 校验：解压、plugin.json 字段、文件名版本一致性、与源目录逐字节比对、官方 @electron/asar 交叉校验
```

- `.zpx` 格式：ASAR 归档经 brotli（quality 5）压缩，即 ZTools 的 ZPX 格式。
- 安装校验只要求 `name`、`version` 及 `features` 或 `tools` 之一。
- 每个插件独立发布 Release，标签格式为 `<plugin-id>/v<版本>`，例如 `easy-translate/v0.0.1`；Release 附件使用打包脚本生成且已校验的 `.zpx`。
- 仓库只提交源码、资源、文档和脚本；`dist/` 与 `.zpx` 不进入提交历史。安装说明以 Release 下载为主，本地构建用于开发和校验。

## 移植规范（uTools → ZTools）

- ZTools 宿主 API 与 uTools 完全兼容，仅命名空间为 `window.ztools`；在插件 `preload.js` 中建立 `window.utools = window.ztools` 别名后，原插件代码即可原样运行。宿主以 session 级 frame preload 注入 `window.ztools`，先于插件自身 preload 执行，别名必然可用。
- **100% 复刻，不增不减功能**。原插件的构建产物（bundle、html、图标）除元数据外不得改动；需要的行为差异只能通过 `preload.js` 兼容层实现。
- `preload.js` 必须保持可读、不打包不混淆（ZTools 插件规范要求），第三方依赖需附源码。
- 原 `.upxs` 参考包与解密产物属于第三方版权材料，已通过 `.gitignore` 排除，不上传 GitHub。

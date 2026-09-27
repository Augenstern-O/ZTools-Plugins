# AGENTS.md · 长图拼接插件

本文件的约束**仅适用于本目录下的「长图拼接」插件**；仓库级约束（作者、版本规则、ID 命名、打包命令、移植规范）见上级目录的 [AGENTS.md](../AGENTS.md)，修改前两份都要读。

## 插件元数据（plugin.json 权威值）

| 字段 | 值 |
| --- | --- |
| 插件 ID（`name`） | `long-image-stitch` |
| 显示名（`title`） | 长图拼接 |
| 当前版本 | v0.0.1 |
| 作者（`author`） | Augenstern |
| 主页（`homepage`） | https://github.com/Augenstern-O |

原插件出处（仅标注，非本插件作者）：长图拼接 v1.1.8，uTools 插件 ID `zec73eod`，
作者 splwany（https://github.com/splwany）。

## 不可违反的约束

1. **100% 复刻，不增不减功能**。`app.bundle.js`、`index.html` 是原插件构建产物，除元数据外不得改动；需要的行为差异只能通过 `preload.js` 兼容层实现。
2. **指令集合固定为 7 个**：`拼接 / 图片拼接 / 长图 / 拼图 / stitch / img / files`，顺序必须保持**中文指令在前、`stitch` 作为英文别名末位**。原因：ZTools「最近使用」在按插件标题启动时，历史记录名为 `title`（"长图拼接"），与任何文本指令名都不匹配，显示时会回退到该 feature 的第一个文本指令——若 `stitch` 在首位会显示英文。
3. `preload.js` 必须保持可读、不打包不混淆，第三方依赖需附源码。

## 资源结构

- 图片资源统一放 `public/assets/icons/`：
  - `logo.png` —— 插件 logo，被 `plugin.json` 的 `logo` 字段引用
  - `add.svg` / `left.svg` / `right.svg` / `delete.svg` —— 界面图标，被 `app.bundle.js` 的 CSS `background-image` 引用（分别是添加图片、上移/左移、下移/右移、删除）
- 原插件构建产物把图标以 webpack 哈希名平铺在根目录，已重命名为语义化名称并归入子目录，
  `app.bundle.js` 中的引用路径已同步修改。**改动图标文件名或位置时，必须同步改
  `app.bundle.js` 里的 `n.p+"..."` 引用**，否则运行时 404。

## 移植技术备忘

- 兼容层原理：ZTools 宿主 API 与 uTools 完全兼容，仅命名空间为 `window.ztools`；`preload.js` 建立 `window.utools = window.ztools` 别名后原代码原样运行。
- 插件实际使用的 8 个 API：`onPluginEnter`（files → path 列表、img → Data URL）、`dbStorage.setItem/getItem`、`hideMainWindow`、`screenCapture`、`showOpenDialog`、`copyImage`、`showNotification`。
- 插件视图 `webSecurity:false`，裸 Windows 路径可直接作为 `<img src>`（files 指令依赖此行为）。
- 字段映射：`pluginName`→`title`、`_development`→`development`；`pluginSetting.single:false` ZTools 同样支持（允许多开）。

# 长图拼接 · ZTools 插件

将多个图片拼接成一张长图片的 ZTools 插件。

在搜索框输入「拼接」「图片拼接」「长图」「拼图」或英文 `stitch` 即可使用；也可以直接粘贴图片、或拖入/选择多个图片文件（jpg / jpeg / png / webp）来触发。

## 功能

- 多张图片拼接为一张长图，支持纵向 / 横向
- 图片来源：拖拽、点击选择、截图、粘贴图片、选择图片文件
- 边框粗细滑块调节
- 背景色选择（预设色板 / 高级取色）
- 保存类型：png / webp / jpeg
- 「原」开关：是否限制结果图尺寸（纵向限宽 1080、横向限高 1920，关闭则用原始尺寸）
- 拼接结果自动复制到剪贴板并弹出系统通知；也可保存为文件
- 方向、保存类型、尺寸限制等设置本地持久化

## 安装

在[插件 Release](https://github.com/Augenstern-O/ZTools-Plugins/releases/tag/long-image-stitch%2Fv0.0.1) 中下载并安装 `长图拼接-v0.0.1.zpx` 附件，标签为 `long-image-stitch/v0.0.1`。

本地构建：在插件目录执行 `node scripts/pack_zpx.js` 和 `node scripts/verify_zpx.js`，安装包生成于 `dist/`。该目录由 Git 忽略，不随源码提交。

## 目录结构

```
long-image-stitch/
├── AGENTS.md                 ← 本插件的专属维护约束（仓库级约束在上一级目录）
├── README.md                 ← 本文件（插件介绍）
├── dist/                     ← 本地打包产物（Git 忽略，发布到 Release）
├── public/                  ← 插件实体（ZTools 开发者工具可直接添加此目录）
│   ├── plugin.json           ← ZTools 插件清单
│   ├── preload.js            ← uTools → ZTools API 兼容层
│   ├── index.html            ← 插件入口
│   ├── app.bundle.js         ← 原插件构建产物
│   └── assets/icons/         ← 图标资源（logo + 界面图标）
└── references/               ← 参考文件（原插件、原插件代码等）
└── scripts/                  ← 打包与校验脚本
```

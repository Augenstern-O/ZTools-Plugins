# 易翻翻译 · ZTools 插件

支持多种翻译服务、图片翻译、朗读和变量命名，新增 LibreTranslate 在线及本地实例支持。当前版本 v0.0.1，作者 Augenstern，主页：[Augenstern-O](https://github.com/Augenstern-O)。

原插件出处（仅标注，非本插件作者）：[ZTools 官方插件仓库的易翻翻译 v2.22.2](https://github.com/ZToolsCenter/ZTools-plugins/tree/main/plugins/easy-translate)，原作者 Lainbo & Milo。

在[插件 Release](https://github.com/Augenstern-O/ZTools-Plugins/releases/tag/easy-translate%2Fv0.0.1) 中下载并安装 `易翻翻译-v0.0.1.zpx` 附件，标签为 `easy-translate/v0.0.1`。开发时也可在 ZTools 开发者工具中添加 `src` 目录。

使用 LibreTranslate：打开插件设置，在「翻译服务」勾选 LibreTranslate，在对应厂商配置中填写服务地址和 API Key，然后点击「确定」。

- 官方地址：`https://libretranslate.com`，需按官方要求申请 API Key。
- 本地部署示例：`http://127.0.0.1:5000`；支持路径前缀及完整 `/translate` 地址。
- 自建服务关闭密钥校验时，API Key 留空。语种支持取决于实例安装的语言模型。
- 配置沿用插件原有保存、备份和导入机制。
- 下拉语言来自当前实例的 `/languages`，按各语种的 `targets` 过滤可用方向；切换服务、保存地址和打开下拉时刷新。自动检测将 `source: auto` 交由 Libre 处理，手动选择则按选定语种发送。
- 进入 Libre 默认使用「自动检测 → 中文简体」。语言菜单优先排列中文简体、英文，其余保持接口顺序；同一实例刷新时保留手选方向。实例缺少中文简体时仅在实际支持的语种内回退。

接口依据：[LibreTranslate 官方文档](https://docs.libretranslate.com/api/operations/translate/)。图标来自 [官方 SVG](https://libretranslate.com/static/icon.svg)，通过 CSS 蒙版随主题着色。

本地构建和检查（在插件目录执行，`dist/` 由 Git 忽略，安装包作为 Release 附件发布）：

```powershell
npm ci --prefix src/preload --omit=dev --ignore-scripts --no-audit --no-fund
node --test scripts/test_libretranslate.cjs scripts/test_libretranslate_frontend.cjs scripts/test_libretranslate_languages.cjs
node scripts/pack_zpx.js
node scripts/verify_zpx.js
```

上游只提供前端构建产物。新增可读逻辑位于 `src/assets/libretranslate.js`、`src/assets/libretranslate.css` 和 `src/preload/libretranslate.js`；原 bundle 只增加导入、配置读写、设置渲染、厂商图标和服务注册接入点。

# easy-translate 维护约束

## 插件元数据（plugin.json 权威值）

| 字段 | 值 |
| --- | --- |
| 插件 ID（`name`） | `easy-translate` |
| 显示名（`title`） | 易翻翻译 |
| 当前版本 | v0.0.1 |
| 作者（`author`） | Augenstern |
| 主页（`homepage`） | https://github.com/Augenstern-O |

## 来源与维护规则

- 上游：ZToolsCenter/ZTools-plugins，`plugins/easy-translate`，版本 2.22.2，提交 `b9a8748bd4ff9cbc035928cfcfbf49f8b909d2e7`；原作者 Lainbo & Milo。
- 本插件沿用上游 `src/` 实体目录布局，宿主入口为 `src/plugin.json`，预加载入口为 `src/preload/index.js`。
- 用户已授权新增 LibreTranslate。上游仅提供混淆构建产物，新增行为放在独立可读模块，bundle 中仅维护必要接入点，避免整体格式化或混淆新增代码。
- 厂商 ID 使用 `libretranslate`；设置嵌套字段为 `keyConfig.libretranslate.url` 和 `apiKey`，表单字段使用对应厂商前缀。不得重置其他厂商和通用配置。
- HTTP 请求置于 preload，支持本地 HTTP、自建 HTTPS 和官方在线服务，可选密钥不得在日志中输出。
- Libre 下拉选项以实例 `/languages` 与 `targets` 为准，独立于旧厂商兼容矩阵；自动检测原样传 `auto`，检测显示只采用 Libre 自身响应。
- Libre 默认方向为自动检测到中文简体；实际语种排序中文简体第一、英文第二，其余稳定保序。自动检测入口仍在源菜单最上方，同实例刷新保留手选方向。
- 本插件从 v0.0.1 起版，不沿用上游或开发阶段的 2.x 版本号。后续遵循仓库语义化版本规则，同步 changelog 并重新打包校验；原作者信息仅作为来源保留。
- 验证命令见 README；功能测试只使用本机模拟服务，在线真实翻译需单独配置有效密钥或实例。

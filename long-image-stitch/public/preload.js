/**
 * 长图拼接 - ZTools 插件 preload
 *
 * 本插件由 uTools 插件「长图拼接」(zec73eod, v1.1.8, 作者 splwany) 1:1 移植而来，
 * 移植版插件 ID 为 long-image-stitch。
 * 插件界面代码 (app.bundle.js) 保持原样未做改动，仍通过全局 utools 对象调用宿主 API。
 * ZTools 的宿主 API 与 uTools 完全兼容，只是命名空间为 window.ztools，
 * 因此这里仅需在 utools 不存在时建立别名，原代码即可原样运行。
 *
 * 插件实际使用到的 API:
 *   utools.onPluginEnter(({ code, type, payload }) => ...)
 *   utools.dbStorage.setItem / utools.dbStorage.getItem
 *   utools.hideMainWindow()
 *   utools.screenCapture((image, bounds) => ...)
 *   utools.showOpenDialog({ filters, properties })
 *   utools.copyImage(dataUrl)
 *   utools.showNotification(message)
 */
if (typeof window.utools === "undefined" && typeof window.ztools !== "undefined") {
  window.utools = window.ztools;
}

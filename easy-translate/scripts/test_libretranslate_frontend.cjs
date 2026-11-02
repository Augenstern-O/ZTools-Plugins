const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ROOT = path.resolve(__dirname, '..');

/** 直接加载无构建依赖的前端扩展，覆盖配置和现有派发器之间的边界。 */
async function testFrontendIntegration() {
  const source = fs.readFileSync(path.join(ROOT, 'src/assets/libretranslate.js'), 'utf8');
  const extension = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const form = {};
  extension.loadLibreTranslateSettings(form, { google: { apiType: 'online' } });
  assert.deepEqual(form, extension.libreTranslateDefaults);
  form.libretranslateUrl = ' http://127.0.0.1:5000/prefix ';
  form.libretranslateApiKey = ' SECRET ';
  const config = { google: { apiType: 'online' } };
  extension.saveLibreTranslateSettings(config, form);
  assert.deepEqual(config.libretranslate, { url: 'http://127.0.0.1:5000/prefix', apiKey: 'SECRET' });
  assert.equal(config.google.apiType, 'online');
  extension.loadLibreTranslateSettings(form, config);
  assert.equal(form.libretranslateApiKey, 'SECRET');
  form.libretranslateUrl = '';
  form.libretranslateApiKey = '';
  extension.saveLibreTranslateSettings(config, form);
  assert.equal(config.libretranslate.url, 'https://libretranslate.com');
  assert.equal(config.libretranslate.apiKey, '');

  const services = { google: { label: '谷歌翻译' } };
  const options = [{ value: 'google' }];
  const languages = {
    jp: { datas: { google_2: 'ja' } }, cht: { datas: { google_2: 'zh_HANT' } },
    fra: { datas: { google_2: 'fr' } }, kor: { datas: { google_2: 'ko' } },
    wyw: { datas: { google_2: '' } },
  };
  /** 模拟原插件结果标准化，仅保留本次调用所依赖的字段。 */
  function normalize(code, data, message) { return { code, ...data, message }; }
  extension.registerLibreTranslate({ services, options, languages, normalize });
  assert.equal(options[0].value, 'google');
  assert.equal(options.at(-1).value, 'libretranslate');
  assert.equal(languages.jp.datas.libretranslate, 'ja');
  assert.equal(languages.cht.datas.libretranslate, 'zh-Hant');
  assert.equal(languages.fra.datas.libretranslate, 'fr');
  assert.equal(languages.kor.datas.libretranslate, 'ko');
  assert.equal(languages.wyw.datas.libretranslate, '');
  assert.deepEqual(services.libretranslate.keys, []);

  const oldWindow = global.window;
  try {
    let captured;
    global.window = { servers: {
      /** 校验适配器把凭据和翻译参数完整传到 preload。 */
      libreTranslate: async (params) => { captured = params; return { code: 200, text: '你好' }; },
    } };
    const params = { q: 'hello', from: 'en', to: 'zh', keyConfig: config.libretranslate };
    const result = await services.libretranslate.fn(params);
    assert.equal(result.code, 200);
    assert.equal(result.text, '你好');
    assert.equal(captured, params);
    assert.equal(result.from.tag, 'en');
    /** 自动检测原样进入 preload，并采用 Libre 返回的日语识别结果。 */
    global.window.servers.libreTranslate = async (params) => {
      assert.equal(params.from, 'auto');
      return { code: 200, text: '你好', from: 'ja', to: 'zh' };
    };
    const detected = await services.libretranslate.fn({ ...params, from: 'auto', q: 'こんにちは' });
    assert.equal(detected.from.tag, 'jp');
    /** 缺少检测结果时不显示虚假的“检测到 auto”标签。 */
    global.window.servers.libreTranslate = async () => ({ code: 200, text: '你好', from: 'auto' });
    assert.equal((await services.libretranslate.fn({ ...params, from: 'auto' })).from.languageText, '');
    /** 模拟维护响应，确认不会触发原派发器的 503 立即重试。 */
    global.window.servers.libreTranslate = async () => ({ code: 503, message: '服务维护' });
    assert.equal((await services.libretranslate.fn(params)).code, 502);
    /** 模拟网络异常，确认以插件错误格式返回。 */
    global.window.servers.libreTranslate = async () => { throw new Error('网络异常'); };
    assert.equal((await services.libretranslate.fn(params)).code, 500);
  } finally {
    if (oldWindow === undefined) delete global.window;
    else global.window = oldWindow;
  }
  const bundle = fs.readFileSync(path.join(ROOT, 'src/assets/index-DIbm2xhO.js'), 'utf8');
  for (const marker of ['loadLibreTranslateSettings(e,t)', 'saveLibreTranslateSettings($,n)', 'renderLibreTranslateSettings(Y,Nu,', 'registerLibreTranslate({services:gy,options:Fo,languages:iM,normalize:My})']) {
    assert.equal(bundle.split(marker).length, 2, `前端接入点必须唯一：${marker}`);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'src/preload/index.js'), 'utf8'), /libreTranslate: require\('\.\/libretranslate'\)\.translate/);
}

test('LibreTranslate 配置、语言映射和派发接入', testFrontendIntegration);

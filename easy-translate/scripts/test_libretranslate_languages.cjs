'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const modulePath = path.join(__dirname, '..', 'src', 'assets', 'libretranslate.js');

/** 读取前端模块并经 data URL 导入，避免依赖项目 package.json 的模块类型。 */
async function loadModule() {
  const source = await fs.readFile(modulePath, 'utf8');
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(dataUrl);
}

/** 生成仅包含测试指定语种及互相支持方向的 LibreTranslate fixture。 */
function makeLanguages() {
  return [
    { code: 'en', name: 'English', targets: ['ja', 'zh', 'uk', 'ru', 'ja'] },
    { code: 'ja', name: 'Japanese', targets: ['en', 'zh'] },
    { code: 'zh', name: 'Chinese', targets: ['en', 'ja'] },
    { code: 'uk', name: 'Ukrainian', targets: ['en', 'ja', 'zh'] },
  ];
}

/** 收集菜单中源语种和所有子目标语种，供静态语种泄漏断言使用。 */
function collectOptions(options) {
  const values = [];
  for (const option of options) {
    values.push(option.value);
    for (const child of option.children || []) values.push(child.value);
  }
  return values;
}

/** 创建可控的异步响应，按测试顺序释放请求结果。 */
function createDeferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** 验证语种代码映射、targets 过滤、auto 目标及新语种注册副作用。 */
async function testLanguageOptions() {
  const api = await loadModule();
  assert.equal(api.libreCodeToUi('ja'), 'jp');
  assert.equal(api.libreCodeToUi('uk'), 'uk');

  const names = { en: '英语', jp: '日语', zh: '中文' };
  const inputEntries = makeLanguages();
  const originalEntries = structuredClone(inputEntries);
  const languageMap = {
    en: { name: '英语', datas: { google: 'en', baidu: 'en' } },
    jp: { name: '日语', datas: { google: 'ja', baidu: 'jp' } },
    zh: { name: '中文', datas: { google: 'zh-CN', baidu: 'zh' } },
  };
  const options = api.buildLibreLanguageOptions(inputEntries, names, languageMap);
  const values = collectOptions(options);

  assert.ok(values.includes('auto'), '自动检测应出现在方向选项中');
  assert.ok(values.includes('uk'), '实例支持的乌克兰语应加入菜单');
  assert.equal(values.includes('ru'), false, '服务不支持的俄语不应出现');
  assert.equal(values.includes('kor'), false, '服务不支持的韩语不应出现');
  assert.deepEqual(options.slice(1).map((item) => item.value), ['zh', 'en', 'jp', 'uk']);
  assert.deepEqual(options[0].children.map((item) => item.value), ['zh', 'en', 'jp', 'uk']);
  assert.deepEqual(options.find((item) => item.value === 'en').children.map((item) => item.value), ['zh', 'jp', 'uk']);
  assert.deepEqual(options.find((item) => item.value === 'jp').children.map((item) => item.value), ['zh', 'en']);
  assert.deepEqual(options.find((item) => item.value === 'uk').children.map((item) => item.value), ['zh', 'en', 'jp']);
  assert.equal(names.uk, 'Ukrainian');
  assert.equal(languageMap.uk.datas.libretranslate, 'uk');
  assert.equal(languageMap.en.datas.google, 'en');
  assert.equal(languageMap.en.datas.baidu, 'en');
  assert.equal(languageMap.jp.datas.google, 'ja');
  assert.equal(languageMap.jp.datas.baidu, 'jp');
  assert.deepEqual(inputEntries, originalEntries, '排序不得修改接口返回的原始语种数组');

  const traditionalEntries = [
    { code: 'en', name: 'English', targets: ['zh-Hant', 'zh-Hans', 'en'] },
    { code: 'zh-Hant', name: 'Traditional Chinese', targets: ['en'] },
    { code: 'zh-Hans', name: 'Simplified Chinese', targets: ['en'] },
  ];
  const traditionalOptions = api.buildLibreLanguageOptions(traditionalEntries, {}, {});
  assert.deepEqual(traditionalOptions.slice(1).map((item) => item.value), ['zh', 'en', 'cht']);
  assert.deepEqual(traditionalOptions[0].children.map((item) => item.value), ['zh', 'en', 'cht']);
}

/** 验证实例不支持的方向回退到自动检测，并保留有效的 auto 目标。 */
async function testDirectionReconciliation() {
  const api = await loadModule();
  const options = api.buildLibreLanguageOptions(makeLanguages(), {}, {});
  assert.deepEqual(api.reconcileLibreDirection(['auto', 'zh'], options), ['auto', 'zh']);
  assert.deepEqual(api.reconcileLibreDirection(['auto', 'uk'], options), ['auto', 'uk']);
  assert.deepEqual(api.reconcileLibreDirection(['ru', 'ko'], options), ['auto', 'zh']);
  assert.deepEqual(api.reconcileLibreDirection(['en', 'ru'], options), ['en', 'zh']);
  const withoutChinese = api.buildLibreLanguageOptions([
    { code: 'uk', name: 'Ukrainian', targets: ['en'] },
    { code: 'en', name: 'English', targets: ['uk'] },
  ], {}, {});
  assert.deepEqual(api.reconcileLibreDirection(['auto', 'zh'], withoutChinese), ['auto', 'en']);
}

/** 验证响应式服务切换、地址变更、过期响应丢弃及错误时不回退静态语种。 */
async function testLanguageBinding() {
  const api = await loadModule();
  const previousWindow = globalThis.window;
  const requests = [];
  const errors = [];
  const originalOptions = [{ value: 'static', children: [{ value: 'legacy' }] }];
  const provider = { value: 'google' };
  const direction = { value: ['en', 'uk'] };
  const options = { value: [] };
  let config = { url: 'http://libre-a.test', apiKey: '' };
  let onWatch;

  /** 按请求地址返回可延后完成的模拟语言列表查询。 */
  function getLanguages(requestConfig) {
    const deferred = createDeferred();
    requests.push({ url: requestConfig.url, deferred });
    return deferred.promise;
  }
  globalThis.window = { servers: { libreTranslateLanguages: getLanguages } };

  /** 模拟响应式 watch，保存更新回调并执行 immediate 初始通知。 */
  function watch(_getter, callback, watchOptions) {
    onWatch = callback;
    if (watchOptions.immediate) callback();
  }

  /** 返回原翻译服务的完整菜单，验证切回 Google 时恢复该菜单。 */
  function createOptions() {
    return originalOptions;
  }

  /** 返回当前 LibreTranslate 配置快照。 */
  function getConfig() {
    return config;
  }

  /** 收集语言列表获取失败提示，验证失败路径不静默回退。 */
  const notify = {
    /** 保存错误提示，供测试断言提示内容。 */
    error(message) { errors.push(message); },
  };

  try {
    const refresh = api.bindLibreTranslateLanguages({
      watch,
      provider,
      direction,
      options,
      createOptions,
      getConfig,
      names: { en: '英语', jp: '日语', zh: '中文' },
      languageMap: {},
      notify,
    });
    assert.equal(options.value, originalOptions, 'immediate watch 应初始化非 Libre 服务菜单');

    provider.value = 'libretranslate';
    config = { url: 'http://libre-a.test', apiKey: '' };
    onWatch();
    assert.deepEqual(direction.value, ['auto', 'zh'], '进入 LibreTranslate 应重置为默认方向');
    const oldRequest = refresh();
    await Promise.resolve();
    assert.equal(requests.length, 1);

    config = { url: 'http://libre-b.test', apiKey: '' };
    onWatch();
    assert.deepEqual(direction.value, ['auto', 'zh'], '更换实例地址应重置为默认方向');
    const newRequest = refresh();
    await Promise.resolve();
    assert.equal(requests.length, 2);
    requests[0].deferred.resolve({ code: 200, languages: makeLanguages() });
    await oldRequest;
    assert.deepEqual(options.value, [], '新地址请求未完成时不得写入旧地址的语种');

    direction.value = ['uk', 'en'];
    requests[1].deferred.resolve({
      code: 200,
      languages: [{ code: 'en', name: 'English B', targets: ['uk'] }, { code: 'uk', name: 'Ukrainian B', targets: ['en'] }],
    });
    await newRequest;
    assert.equal(options.value.some((item) => item.value === 'uk'), true, '新地址结果应生效');
    assert.equal(options.value.some((item) => item.value === 'ru'), false);
    assert.deepEqual(direction.value, ['uk', 'en'], '请求期间修改的有效方向应保留');

    const sameInstanceRefresh = refresh();
    await Promise.resolve();
    assert.deepEqual(direction.value, ['uk', 'en'], '同实例刷新开始时不得重置用户方向');
    requests[2].deferred.resolve({
      code: 200,
      languages: [{ code: 'en', name: 'English B', targets: ['uk'] }, { code: 'uk', name: 'Ukrainian B', targets: ['en'] }],
    });
    await sameInstanceRefresh;
    assert.deepEqual(direction.value, ['uk', 'en'], '同实例刷新完成后应保留用户方向');

    config = { url: 'http://libre-c.test', apiKey: '' };
    onWatch();
    const failedRequest = refresh();
    await Promise.resolve();
    requests[3].deferred.resolve({ code: 503, message: '实例暂不可用' });
    await failedRequest;
    assert.deepEqual(options.value, [], '语言接口失败时菜单应保持空，不回退为静态语种');
    assert.match(errors.at(-1), /实例暂不可用/);
    assert.deepEqual(direction.value, ['auto', 'zh'], '首次请求失败后应保留默认方向供重试');

    const retryRequest = refresh();
    await Promise.resolve();
    assert.equal(requests.length, 5);
    requests[4].deferred.resolve({
      code: 200,
      languages: [{ code: 'uk', name: 'Ukrainian C', targets: ['en'] }, { code: 'en', name: 'English C', targets: ['uk'] }],
    });
    await retryRequest;
    assert.deepEqual(direction.value, ['auto', 'en'], '无简体中文实例应回退到实际支持的目标语种');

    config = { url: 'http://libre-d.test', apiKey: '' };
    onWatch();
    const inFlight = refresh();
    await Promise.resolve();
    assert.equal(requests.length, 6);
    provider.value = 'google';
    onWatch();
    assert.equal(options.value, originalOptions, '切回 Google 应恢复原厂商的菜单');
    requests[5].deferred.resolve({ code: 200, languages: makeLanguages() });
    await inFlight;
    assert.equal(options.value, originalOptions, '旧 LibreTranslate 回包不得覆盖 Google 菜单');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

/** 验证设置帮助文案统一使用 ZTools 并删除自动复制说明项。 */
async function testSettingHints() {
  const api = await loadModule();
  const hints = {
    '关于自动复制': 'uTools 会自动复制',
    '配置说明': '登录 uTools 后使用',
    '其他说明': 'ZTools 保持不变',
  };
  api.updateZToolsSettingHints(hints);
  assert.equal(Object.hasOwn(hints, '关于自动复制'), false);
  assert.equal(hints['配置说明'], '登录 ZTools 后使用');
  assert.equal(hints['其他说明'], 'ZTools 保持不变');
}

test('LibreTranslate 语言选项构建', testLanguageOptions);
test('LibreTranslate 翻译方向回退', testDirectionReconciliation);
test('LibreTranslate 响应式菜单绑定', testLanguageBinding);
test('ZTools 设置提示文案清理', testSettingHints);

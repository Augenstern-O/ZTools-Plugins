/** LibreTranslate 表单默认值；兼容尚未配置此服务的旧设置。 */
export const libreTranslateDefaults = {
  libretranslateUrl: 'https://libretranslate.com',
  libretranslateApiKey: '',
};

/** 从现有厂商配置读取表单，复用原有保存、备份与导入流程。 */
export function loadLibreTranslateSettings(form, config) {
  form.libretranslateUrl = config.libretranslate?.url ?? libreTranslateDefaults.libretranslateUrl;
  form.libretranslateApiKey = config.libretranslate?.apiKey ?? '';
}

/** 将独立字段写回厂商配置，密钥允许为空以支持自建服务。 */
export function saveLibreTranslateSettings(config, form) {
  config.libretranslate = {
    url: (form.libretranslateUrl || '').trim() || libreTranslateDefaults.libretranslateUrl,
    apiKey: (form.libretranslateApiKey || '').trim(),
  };
}

/** 复用插件现有设置卡片与输入组件，配置随原设置按钮统一保存。 */
export function renderLibreTranslateSettings(h, form, { card, formItem, input, password }) {
  /** 更新服务地址，不改变其他厂商设置。 */
  function updateUrl(value) { form.libretranslateUrl = value; }
  /** 更新可选密钥，由原备份流程统一管理。 */
  function updateApiKey(value) { form.libretranslateApiKey = value; }
  /** 构建厂商配置内容，保持原设置页的间距和控件样式。 */
  function content() {
    return [
      h(formItem, { label: '服务地址' }, {
        /** 渲染本地或在线服务地址输入框。 */
        default: () => h(input, {
          modelValue: form.libretranslateUrl,
          'onUpdate:modelValue': updateUrl,
          placeholder: 'https://libretranslate.com 或 http://127.0.0.1:5000',
          'allow-clear': true,
        }),
      }),
      h(formItem, { label: 'API Key' }, {
        /** 密钥使用密码框，支持服务端关闭密钥校验时留空。 */
        default: () => h(password, {
          modelValue: form.libretranslateApiKey,
          'onUpdate:modelValue': updateApiKey,
          placeholder: '可选；官方在线服务需要 API Key',
          'allow-clear': true,
        }),
      }),
    ];
  }
  return h(card, { id: 'libretranslate', title: 'LibreTranslate', 'icon-data': 'libretranslate', 'is-server': '' }, { default: content });
}

/** 注册服务及语种映射，保持既有服务顺序和默认选择。 */
export function registerLibreTranslate({ services, options, languages, normalize }) {
  options.push({ label: 'LibreTranslate', value: 'libretranslate', sortOrder: 10 });
  for (const [code, language] of Object.entries(languages)) {
    language.datas.libretranslate = code === 'cht' ? 'zh-Hant' : language.datas.google_2 || '';
  }
  services.libretranslate = {
    label: 'LibreTranslate',
    keys: [],
    /** 通过 preload 请求本地或在线服务，结果沿用插件统一格式。 */
    async fn(params) {
      if (!window.servers?.libreTranslate) return normalize(500, {}, 'LibreTranslate 预加载模块未就绪，请重新加载插件');
      try {
        const result = await window.servers.libreTranslate(params);
        const code = result.from || params.from || 'auto';
        const uiCode = libreCodeToUi(code);
        const languageText = code === 'auto' ? '' : languages[uiCode]?.name || code;
        // 原派发器会立即重试 503；转成网关错误以免服务维护时循环请求。
        return normalize(result.code === 503 ? 502 : result.code, {
          text: result.text || '',
          from: { tag: code === 'auto' ? undefined : uiCode, languageText },
          to: result.to || params.to,
        }, result.message);
      } catch {
        return normalize(500, {}, 'LibreTranslate 请求失败，请检查服务地址与网络');
      }
    },
  };
}

/** 把 Libre 的标准语种代码映射到原插件的选项代码。 */
export function libreCodeToUi(code) {
  return ({ ja: 'jp', ko: 'kor', fr: 'fra', es: 'spa', 'zh-Hant': 'cht', 'zh-Hans': 'zh' })[code] || code;
}

/** 只按实例返回的语种及 targets 构建 Libre 的双层方向菜单。 */
export function buildLibreLanguageOptions(entries, names, languageMap) {
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const orderedEntries = sortLibreLanguages(entries);
  /** 将单个服务语种转换为菜单项，保留插件已有的中文名称。 */
  function item(code, prefix) {
    const uiCode = libreCodeToUi(code);
    const entry = byCode.get(code);
    const label = names[uiCode] || entry.name;
    names[uiCode] = label;
    languageMap[uiCode] ??= { name: label, datas: {} };
    languageMap[uiCode].datas.libretranslate = code;
    return { label, value: uiCode, id: `libre:${prefix}:${code}`, disabled: false };
  }
  /** 为某个源语种构建实例实际支持的目标项。 */
  function targets(entry) {
    const allowed = entry.targets ?? [...byCode.keys()];
    const supported = [...new Set(allowed)].filter((code) => byCode.has(code));
    return sortLibreCodes(supported).map((code) => item(code, entry.code));
  }
  const sources = orderedEntries.map((entry) => ({ ...item(entry.code, 'source'), children: targets(entry) }))
    .filter((entry) => entry.children.length);
  const autoTargets = new Set(sources.flatMap((entry) => entry.children.map((child) => child.value)));
  const autoChildren = orderedEntries.filter((entry) => autoTargets.has(libreCodeToUi(entry.code))).map((entry) => item(entry.code, 'auto'));
  return autoChildren.length ? [{ label: '自动检测', value: 'auto', id: 'libre:auto', disabled: false, children: autoChildren }, ...sources] : [];
}

/** 稳定地按简体中文、英文、其他语种的优先级排序，不修改输入数组。 */
function sortLibreLanguages(entries) {
  return entries.slice().sort((left, right) => libreLanguagePriority(left.code) - libreLanguagePriority(right.code));
}

/** 稳定地按简体中文、英文、其他语种的优先级排序代码列表副本。 */
function sortLibreCodes(codes) {
  return codes.slice().sort((left, right) => libreLanguagePriority(left) - libreLanguagePriority(right));
}

/** 返回 LibreTranslate 语种的菜单优先级，繁体中文保持在其他语种组。 */
function libreLanguagePriority(code) {
  if (code === 'zh' || code === 'zh-Hans') return 0;
  if (code === 'en') return 1;
  return 2;
}

/** 将当前方向限制到实例可用的组合；自动检测始终保留为 auto。 */
export function reconcileLibreDirection(direction, options) {
  let [from, to] = direction;
  let source = options.find((entry) => entry.value === from);
  if (!source) { from = 'auto'; source = options[0]; }
  const targets = source?.children || [];
  if (!targets.some((entry) => entry.value === to)) {
    to = targets.find((entry) => entry.value === 'zh')?.value || targets[0]?.value;
  }
  return [from, to];
}

/** 按当前服务和配置更新语言菜单，隔离其他厂商并丢弃过期请求。 */
export function bindLibreTranslateLanguages({ watch, provider, direction, options, createOptions, getConfig, names, languageMap, notify }) {
  let revision = 0;
  let activeKey = '';
  let pending;
  /** 请求当前实例语种，失败时明确提示，避免展示不支持的静态语种。 */
  async function refresh(visible = true) {
    if (!visible || provider.value !== 'libretranslate') return;
    const config = getConfig();
    const key = JSON.stringify([config.url || libreTranslateDefaults.libretranslateUrl, config.apiKey || '']);
    if (pending?.key === key) return pending.promise;
    const isNewInstance = activeKey !== key;
    const current = ++revision;
    if (isNewInstance) {
      options.value = [];
      activeKey = key;
      direction.value = ['auto', 'zh'];
    }
    /** 获取并应用语种，配置或厂商发生变化后不再写入旧请求结果。 */
    async function load() {
      try {
        const result = await window.servers.libreTranslateLanguages(config);
        if (current !== revision || provider.value !== 'libretranslate') return;
        if (result.code !== 200) throw new Error(result.message || '获取语言列表失败');
        options.value = buildLibreLanguageOptions(result.languages, names, languageMap);
        if (!options.value.length) throw new Error('LibreTranslate 实例没有可用的翻译语言');
        const next = reconcileLibreDirection(direction.value, options.value);
        if (next[0] !== direction.value[0] || next[1] !== direction.value[1]) direction.value = next;
      } catch (error) {
        if (current === revision && provider.value === 'libretranslate') notify.error(`LibreTranslate 语言列表获取失败：${error.message}`);
      } finally {
        if (pending?.promise === promise) pending = undefined;
      }
    }
    // 微任务启动后再读取 promise，兼容桥接函数同步抛错的情况。
    const promise = Promise.resolve().then(load);
    pending = { key, promise };
    return promise;
  }
  /** 服务切换或保存地址后更新菜单；其他服务恢复原来的完整选项。 */
  function update() {
    ++revision;
    pending = undefined;
    if (provider.value === 'libretranslate') refresh();
    else { activeKey = ''; options.value = createOptions(); }
  }
  /** 读取响应式配置，只监听会影响语种列表的服务地址与密钥。 */
  function dependencies() {
    const config = getConfig();
    return [provider.value, config.url, config.apiKey];
  }
  watch(dependencies, update, { immediate: true });
  return refresh;
}

/** 清理上游设置文案并移除自动复制说明，保留其余提示内容。 */
export function updateZToolsSettingHints(hints) {
  delete hints['关于自动复制'];
  for (const key of Object.keys(hints)) {
    if (typeof hints[key] === 'string') hints[key] = hints[key].replaceAll('uTools', 'ZTools');
  }
}

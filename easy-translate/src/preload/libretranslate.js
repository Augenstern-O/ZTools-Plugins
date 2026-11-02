'use strict';

const http = require('node:http');
const https = require('node:https');

const DEFAULT_URL = 'https://libretranslate.com';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** 将插件输入发给 LibreTranslate，并统一转换成插件约定的结果结构。 */
async function translate({ q, from, to, keyConfig = {} } = {}, options = {}) {
  keyConfig = keyConfig && typeof keyConfig === 'object' ? keyConfig : {};
  options = options && typeof options === 'object' ? options : {};
  let endpoint;
  try {
    endpoint = normalizeEndpoint(keyConfig.url || DEFAULT_URL, 'translate');
  } catch (error) {
    return failure(400, `LibreTranslate 地址无效：${error.message}`);
  }

  if (typeof q !== 'string' || !q.trim() || typeof to !== 'string' || !to.trim()) {
    return failure(400, 'LibreTranslate 请求缺少有效的原文或目标语言');
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const payload = {
    q,
    source: typeof from === 'string' && from ? from : 'auto',
    target: to,
    format: 'text'
  };
  const apiKey = typeof keyConfig.apiKey === 'string' ? keyConfig.apiKey : '';
  if (apiKey) payload.api_key = apiKey;

  try {
    const response = await requestJson(endpoint, { method: 'POST', body: payload, timeoutMs });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return failure(response.statusCode, serviceErrorMessage(response, apiKey));
    }
    if (response.invalidJson) return failure(500, 'LibreTranslate 返回了无效 JSON');
    if (response.data && typeof response.data.error === 'string' && response.data.error.trim()) {
      return failure(500, `LibreTranslate 服务提示：${sanitize(response.data.error, apiKey)}`);
    }
    if (!response.data || typeof response.data.translatedText !== 'string' || !response.data.translatedText.trim()) {
      return failure(500, 'LibreTranslate 响应缺少有效的 translatedText');
    }
    const detectedLanguage = normalizeDetectedLanguage(response.data.detectedLanguage);
    const actualFrom = payload.source === 'auto'
      ? detectedLanguage?.language || 'auto'
      : payload.source;
    const result = { code: 200, text: response.data.translatedText, from: actualFrom, to };
    if (detectedLanguage) result.detectedLanguage = detectedLanguage;
    return result;
  } catch (error) {
    if (error.code === 'ETIMEDOUT') return failure(408, 'LibreTranslate 请求超时');
    if (error.code === 'ERESPONSETOOLARGE') return failure(500, 'LibreTranslate 响应超过 1 MiB 限制');
    return failure(500, `LibreTranslate 网络请求失败：${sanitize(error.message, apiKey)}`);
  }
}

/** 获取 LibreTranslate 实例支持的语言列表并严格校验返回结构。 */
async function getLanguages(keyConfig = {}, options = {}) {
  keyConfig = keyConfig && typeof keyConfig === 'object' ? keyConfig : {};
  options = options && typeof options === 'object' ? options : {};
  let endpoint;
  try {
    endpoint = normalizeEndpoint(keyConfig.url || DEFAULT_URL, 'languages');
  } catch (error) {
    return failure(400, `LibreTranslate 地址无效：${error.message}`);
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  try {
    const response = await requestJson(endpoint, { method: 'GET', timeoutMs });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return failure(response.statusCode, serviceErrorMessage(response, ''));
    }
    if (response.invalidJson) return failure(500, 'LibreTranslate 语言接口返回了无效 JSON');
    if (!Array.isArray(response.data) || !response.data.every(isValidLanguage)) {
      return failure(500, 'LibreTranslate 语言接口返回的数据结构无效');
    }
    return { code: 200, languages: response.data };
  } catch (error) {
    if (error.code === 'ETIMEDOUT') return failure(408, 'LibreTranslate 请求超时');
    if (error.code === 'ERESPONSETOOLARGE') return failure(500, 'LibreTranslate 响应超过 1 MiB 限制');
    return failure(500, `LibreTranslate 网络请求失败：${sanitize(error.message, '')}`);
  }
}

/** 校验并规范化 LibreTranslate 的语言检测结果。 */
function normalizeDetectedLanguage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (typeof value.language !== 'string' || !value.language.trim()) return undefined;
  if (value.confidence !== undefined &&
      (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 100)) {
    return undefined;
  }
  return value.confidence === undefined
    ? { language: value.language }
    : { language: value.language, confidence: value.confidence };
}

/** 判断语言条目是否符合 LibreTranslate 的 code/name/targets 结构。 */
function isValidLanguage(value) {
  return Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.code === 'string' && value.code.trim().length > 0 &&
    typeof value.name === 'string' && value.name.trim().length > 0 &&
    Array.isArray(value.targets) &&
    value.targets.every((target) => typeof target === 'string' && target.trim().length > 0);
}

/** 校验服务地址并将既有 API 后缀替换为目标路径，保留前缀和查询参数。 */
function normalizeEndpoint(value, resource) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('地址不能为空');
  if (value.includes('#')) throw new Error('地址不能包含片段标识');

  let endpoint;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new Error('请使用完整的 HTTP 或 HTTPS 地址');
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('仅支持 HTTP 或 HTTPS');
  }
  if (endpoint.username || endpoint.password) throw new Error('地址不能包含用户名或密码');

  let prefix = endpoint.pathname.replace(/\/+$/, '');
  prefix = prefix.replace(/\/(?:translate|languages)$/i, '');
  endpoint.pathname = `${prefix}/${resource}`;
  return endpoint;
}

/** 通过 Node 内置 HTTP(S) 客户端收发 JSON，并限制绝对超时和响应体大小。 */
function requestJson(endpoint, { method, body: payload, timeoutMs }) {
  const client = endpoint.protocol === 'https:' ? https : http;
  const body = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload));
  const headers = body ? { 'content-type': 'application/json', 'content-length': body.length } : {};

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    let request;

    /** 结束请求并清理绝对截止计时器，避免重复结算。 */
    function finish(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    }

    /** 解析响应体；超限、无效 JSON 和 HTTP 状态均保留给调用方处理。 */
    function handleResponse(response) {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          const error = new Error('响应超过 1 MiB 限制');
          error.code = 'ERESPONSETOOLARGE';
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', (error) => finish(reject, error));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        let invalidJson = false;
        try {
          data = JSON.parse(text);
        } catch {
          invalidJson = true;
        }
        finish(resolve, { statusCode: response.statusCode || 500, data, text, invalidJson });
      });
    }

    request = client.request(endpoint, { method, headers }, handleResponse);
    timeout = setTimeout(() => {
      const error = new Error('请求超时');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    }, timeoutMs);
    timeout.unref?.();
    request.on('error', (error) => finish(reject, error));
    request.end(body);
  });
}

/** 将 HTTP 错误响应整理成中文提示，并清理可能回显的密钥。 */
function serviceErrorMessage(response, apiKey) {
  let detail = '';
  if (response.data && typeof response.data === 'object') {
    const candidate = response.data.error || response.data.message || response.data.error_message;
    if (typeof candidate === 'string') detail = candidate;
  } else if (response.text && !response.invalidJson) {
    detail = response.text;
  } else if (response.text && response.text.trim()) {
    detail = response.text;
  }
  const prefix = `LibreTranslate 服务返回 HTTP ${response.statusCode}`;
  return detail ? `${prefix}：${sanitize(detail, apiKey)}` : `${prefix}，请检查服务地址和配置`;
}

/** 构造统一的错误结果，避免异常向插件调用方外泄。 */
function failure(code, message) {
  return { code, text: '', message };
}

/** 移除服务错误信息中可能包含的 API 密钥。 */
function sanitize(value, apiKey) {
  const message = String(value || '未知错误');
  return apiKey ? message.split(apiKey).join('[密钥已隐藏]') : message;
}

module.exports = { translate, getLanguages };

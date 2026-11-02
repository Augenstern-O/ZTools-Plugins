'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const { translate, getLanguages } = require('../src/preload/libretranslate.js');

/** 启动仅监听本机的测试服务，返回地址和可关闭的服务实例。 */
async function startServer(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

/** 关闭测试 HTTP 服务并等待连接全部结束。 */
async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => {
    /** 在服务关闭完成后结束 Promise。 */
    server.close((error) => error ? reject(error) : resolve());
  });
}

/** 验证本地服务下的请求体、路径、凭据、错误响应和超时行为。 */
async function testLibreTranslate() {
  const received = [];
  /** 根据测试路径返回模拟 LibreTranslate 成功、异常和延迟响应。 */
  function handleRequest(request, response) {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      received.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body: body ? JSON.parse(body) : undefined
      });
      if (request.method === 'GET') {
        if (request.url.startsWith('/prefix/languages')) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify([{ code: 'ja', name: 'Japanese', targets: ['en', 'zh'] }]));
        } else if (request.url === '/invalid/languages') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify([{ code: 'ja', name: 'Japanese', targets: 'en' }]));
        } else if (request.url === '/language-error/languages') {
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: '服务暂不可用' }));
        } else {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: '语言路径不存在' }));
        }
        return;
      }
      if (request.url.startsWith('/prefix/translate') || request.url === '/translate') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ translatedText: '你好' }));
      } else if (request.url === '/detected/translate') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ translatedText: 'こんにちは', detectedLanguage: { language: 'ja', confidence: 95 } }));
      } else if (request.url === '/invalid-confidence/translate') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ translatedText: 'こんにちは', detectedLanguage: { language: 'ja', confidence: 101 } }));
      } else if (request.url === '/forbidden/translate') {
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: '密钥 TOKEN-SECRET 无效' }));
      } else if (request.url === '/limited/translate') {
        response.writeHead(429, { 'content-type': 'text/plain' });
        response.end('请求太频繁');
      } else if (request.url === '/plain/translate') {
        response.writeHead(502, { 'content-type': 'text/plain' });
        response.end('上游服务暂不可用');
      } else if (request.url === '/bad-json/translate') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{');
      } else if (request.url === '/empty/translate') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ translatedText: '' }));
      } else if (request.url === '/wrong-type/translate') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ translatedText: 42 }));
      } else if (request.url === '/large/translate') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('x'.repeat(1024 * 1024 + 1));
      } else if (request.url === '/timeout/translate') {
        setTimeout(() => {
          if (!response.destroyed) response.end(JSON.stringify({ translatedText: '迟到' }));
        }, 150);
      } else if (request.url === '/drip/translate') {
        const interval = setInterval(() => {
          if (response.destroyed) {
            clearInterval(interval);
            return;
          }
          response.write(' ');
        }, 10);
        response.on('close', () => clearInterval(interval));
      } else if (request.url === '/json-error/translate') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: '上游额度不足' }));
      } else {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: '路径不存在' }));
      }
    });
  }

  const { server, url } = await startServer(handleRequest);
  try {
    const success = await translate({ q: 'hello', to: 'zh', keyConfig: { url: `${url}/prefix/` } });
    assert.deepEqual(success, { code: 200, text: '你好', from: 'auto', to: 'zh' });
    assert.equal(received.at(-1).path, '/prefix/translate');
    assert.deepEqual(received.at(-1).body, { q: 'hello', source: 'auto', target: 'zh', format: 'text' });

    const withKey = await translate({
      q: 'hello', from: 'en', to: 'zh', keyConfig: { url, apiKey: 'TOKEN-SECRET' }
    });
    assert.deepEqual(withKey, { code: 200, text: '你好', from: 'en', to: 'zh' });
    assert.deepEqual(received.at(-1).body, {
      q: 'hello', source: 'en', target: 'zh', format: 'text', api_key: 'TOKEN-SECRET'
    });

    const prefixed = await translate({ q: 'x', to: 'zh', keyConfig: { url: `${url}/prefix///?tenant=one` } });
    assert.equal(prefixed.code, 200);
    assert.equal(received.at(-1).path, '/prefix/translate?tenant=one');
    const existingPath = await translate({ q: 'x', to: 'zh', keyConfig: { url: `${url}/prefix/translate/` } });
    assert.equal(existingPath.code, 200);
    assert.equal(received.at(-1).path, '/prefix/translate');

    const detected = await translate({ q: 'こんにちは', to: 'zh', keyConfig: { url: `${url}/detected` } });
    assert.deepEqual(detected, {
      code: 200,
      text: 'こんにちは',
      from: 'ja',
      to: 'zh',
      detectedLanguage: { language: 'ja', confidence: 95 }
    });
    const invalidConfidence = await translate({
      q: 'こんにちは', to: 'zh', keyConfig: { url: `${url}/invalid-confidence` }
    });
    assert.deepEqual(invalidConfidence, { code: 200, text: 'こんにちは', from: 'auto', to: 'zh' });
    const manual = await translate({ q: 'hello', from: 'en', to: 'ja', keyConfig: { url } });
    assert.equal(manual.from, 'en');
    assert.equal(manual.to, 'ja');

    const forbidden = await translate({
      q: 'x', to: 'zh', keyConfig: { url: `${url}/forbidden`, apiKey: 'TOKEN-SECRET' }
    });
    assert.equal(forbidden.code, 403);
    assert.match(forbidden.message, /HTTP 403/);
    assert.match(forbidden.message, /密钥已隐藏/);
    assert.doesNotMatch(forbidden.message, /TOKEN-SECRET/);

    const limited = await translate({ q: 'x', to: 'zh', keyConfig: { url: `${url}/limited` } });
    assert.equal(limited.code, 429);
    assert.match(limited.message, /请求太频繁/);
    const plainError = await translate({ q: 'x', to: 'zh', keyConfig: { url: `${url}/plain` } });
    assert.equal(plainError.code, 502);
    assert.match(plainError.message, /上游服务暂不可用/);

    const invalidJson = await translate({ q: 'x', to: 'zh', keyConfig: { url: `${url}/bad-json` } });
    assert.equal(invalidJson.code, 500);
    assert.match(invalidJson.message, /无效 JSON/);
    const emptyText = await translate({ q: 'x', to: 'zh', keyConfig: { url: `${url}/empty` } });
    assert.equal(emptyText.code, 500);
    const wrongType = await translate({ q: 'x', to: 'zh', keyConfig: { url: `${url}/wrong-type` } });
    assert.equal(wrongType.code, 500);
    const upstreamError = await translate({ q: 'x', to: 'zh', keyConfig: { url: `${url}/json-error` } });
    assert.equal(upstreamError.code, 500);
    assert.match(upstreamError.message, /上游额度不足/);
    const tooLarge = await translate({ q: 'x', to: 'zh', keyConfig: { url: `${url}/large` } });
    assert.equal(tooLarge.code, 500);
    assert.match(tooLarge.message, /1 MiB/);

    const timeout = await translate(
      { q: 'x', to: 'zh', keyConfig: { url: `${url}/timeout` } },
      { timeoutMs: 20 }
    );
    assert.equal(timeout.code, 408);
    assert.match(timeout.message, /超时/);

    const dripTimeout = await translate(
      { q: 'x', to: 'zh', keyConfig: { url: `${url}/drip` } },
      { timeoutMs: 60 }
    );
    assert.equal(dripTimeout.code, 408);
    assert.match(dripTimeout.message, /超时/);
  } finally {
    await closeServer(server);
  }
}

/** 验证 GET /languages 的结构、路径归一化、错误处理和不发送密钥。 */
async function testGetLanguages() {
  const received = [];
  /** 记录 GET 请求并返回合法、非法或失败的模拟响应。 */
  function handleLanguages(request, response) {
    received.push({ method: request.method, path: request.url, headers: request.headers });
    if (request.url.startsWith('/prefix/languages')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ code: 'ja', name: 'Japanese', targets: ['en', 'zh'] }]));
    } else if (request.url === '/invalid/languages') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ code: 'ja', name: 'Japanese', targets: 'en' }]));
    } else if (request.url === '/language-error/languages') {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: '服务暂不可用' }));
    } else {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: '语言路径不存在' }));
    }
  }
  const { server, url } = await startServer(handleLanguages);
  try {
    const result = await getLanguages({
      url: `${url}/prefix/translate/?tenant=two`,
      apiKey: 'MUST-NOT-BE-SENT'
    });
    assert.deepEqual(result, {
      code: 200,
      languages: [{ code: 'ja', name: 'Japanese', targets: ['en', 'zh'] }]
    });
    assert.equal(received.at(-1).method, 'GET');
    assert.equal(received.at(-1).path, '/prefix/languages?tenant=two');
    assert.equal(received.at(-1).headers.authorization, undefined);
    assert.doesNotMatch(received.at(-1).path, /MUST-NOT-BE-SENT/);

    const existingLanguagesPath = await getLanguages({
      url: `${url}/prefix/languages/`
    });
    assert.equal(existingLanguagesPath.code, 200);
    assert.equal(received.at(-1).path, '/prefix/languages');

    const invalid = await getLanguages({ url: `${url}/invalid` });
    assert.equal(invalid.code, 500);
    assert.match(invalid.message, /结构无效/);
    const failed = await getLanguages({ url: `${url}/language-error` });
    assert.equal(failed.code, 503);
    assert.match(failed.message, /服务暂不可用/);
  } finally {
    await closeServer(server);
  }
}

/** 验证无效 URL、凭据、片段和非 HTTP(S) 协议均按 400 返回。 */
async function testInvalidUrls() {
  for (const url of ['not-a-url', 'ftp://example.test', 'https://user:pass@example.test', 'http://example.test/path#frag']) {
    const result = await translate({ q: 'x', to: 'zh', keyConfig: { url } });
    assert.equal(result.code, 400, url);
    assert.equal(result.text, '', url);
    assert.match(result.message, /地址无效/, url);
  }
}

/** 验证无法连接的本机端口返回中文网络错误，且不会泄露密钥。 */
async function testNetworkError() {
  const result = await translate({
    q: 'x', to: 'zh', keyConfig: { url: 'http://127.0.0.1:1', apiKey: 'DO-NOT-LEAK' }
  });
  assert.equal(result.code, 500);
  assert.equal(result.text, '');
  assert.match(result.message, /网络请求失败/);
  assert.doesNotMatch(result.message, /DO-NOT-LEAK/);
}

/** 验证缺少输入参数时不发起网络请求并返回 400。 */
async function testInvalidInput() {
  let requestCount = 0;
  /** 记录请求数量，确保空白输入不会联系本地或在线服务。 */
  function countRequest(request, response) {
    requestCount += 1;
    response.end('{}');
  }
  const { server, url } = await startServer(countRequest);
  try {
    const keyConfig = { url };
    assert.equal((await translate({ q: '', to: 'zh', keyConfig })).code, 400);
    assert.equal((await translate({ q: '  \t\n　', to: 'zh', keyConfig })).code, 400);
    assert.equal((await translate({ q: 'x', to: '', keyConfig })).code, 400);
    assert.equal(requestCount, 0);
  } finally {
    await closeServer(server);
  }
}

test('本地 LibreTranslate HTTP 行为', testLibreTranslate);
test('LibreTranslate 语言列表 GET 接口', testGetLanguages);
test('无效 URL 校验', testInvalidUrls);
test('网络错误处理', testNetworkError);
test('输入参数校验', testInvalidInput);

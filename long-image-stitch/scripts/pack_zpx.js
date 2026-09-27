#!/usr/bin/env node
/**
 * 将插件目录打包为 ZTools 的 .zpx（ASAR + brotli）。
 *
 * 零第三方依赖：ASAR 头部按 Chromium Pickle 格式手工编码，
 * 格式与 @electron/asar 一致（可用 verify_zpx.js 交叉校验）。
 *
 * 输出: dist/<插件标题>-v<版本号>.zpx   （版本号读取自 plugin.json）
 * 用法: node scripts/pack_zpx.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

/** 递归收集目录内所有文件（按名字排序，保证输出确定性） */
function collectFiles(dir, base = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  const files = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      files.push({ rel, abs: path.join(dir, entry.name), size: fs.statSync(path.join(dir, entry.name)).size });
    }
  }
  return files;
}

/** 构造 ASAR 头部 JSON：目录为 {files:{...}}，文件为 {offset,size} */
function buildHeader(files, offsets) {
  const root = { files: {} };
  for (const f of files) {
    const parts = f.rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.files[parts[i]]) node.files[parts[i]] = { files: {} };
      node = node.files[parts[i]];
    }
    node.files[parts[parts.length - 1]] = {
      offset: String(offsets[f.rel]),
      size: f.size
    };
  }
  return root;
}

/** Chromium Pickle 编码一个字符串：[uint32 payloadSize][int32 len][data][4 字节对齐填充] */
function pickleString(str) {
  const data = Buffer.from(str, 'utf8');
  const pad = (4 - (data.length % 4)) % 4;
  const buf = Buffer.alloc(4 + 4 + data.length + pad);
  buf.writeUInt32LE(4 + data.length + pad, 0); // payload size
  buf.writeInt32LE(data.length, 4);
  data.copy(buf, 8);
  return buf;
}

/** Chromium Pickle 编码一个 uint32 */
function pickleUInt32(value) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32LE(4, 0);
  buf.writeUInt32LE(value, 4);
  return buf;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('插件目录不存在:', SRC);
    process.exit(1);
  }
  const files = collectFiles(SRC);
  if (!files.some((f) => f.rel === 'plugin.json')) {
    console.error('插件目录缺少 plugin.json');
    process.exit(1);
  }

  // 从 plugin.json 读取标题与版本，生成带版本号的输出文件名
  const config = JSON.parse(fs.readFileSync(path.join(SRC, 'plugin.json'), 'utf8'));
  if (!config.version) {
    console.error('plugin.json 缺少 version 字段');
    process.exit(1);
  }
  const outName = `${config.title || config.name}-v${config.version}.zpx`;
  const OUT = path.join(DIST, outName);

  // 偏移相对于文件数据区起点（数据区紧随头部），按收集顺序累计即可
  const offsets = {};
  const contents = [];
  let cursor = 0;
  for (const f of files) {
    offsets[f.rel] = cursor;
    const data = fs.readFileSync(f.abs);
    contents.push(data);
    cursor += data.length;
  }

  // asar = sizePickle(8) + headerPickle + 文件内容
  const headerBuf = pickleString(JSON.stringify(buildHeader(files, offsets)));
  const asar = Buffer.concat([pickleUInt32(headerBuf.length), headerBuf, ...contents]);

  // ZTools ZPX = asar 经 brotli(quality 5) 压缩
  const zpx = zlib.brotliCompressSync(asar, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 }
  });
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(OUT, zpx);

  console.log('已打包:', OUT);
  console.log('  版本:', config.version, '| 文件数:', files.length, '| asar:', asar.length, 'bytes | zpx:', zpx.length, 'bytes');
  for (const f of files) console.log('   -', f.rel, f.size);
}

try {
  main();
} catch (e) {
  console.error('打包失败:', e);
  process.exit(1);
}

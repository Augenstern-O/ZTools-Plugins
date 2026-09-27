#!/usr/bin/env node
/**
 * 校验 dist/ 下的 .zpx：
 *  1. 按 ZTools 的安装路径解出 asar（brotli → 头部 Pickle → 文件表）
 *  2. 与插件源目录逐文件比对（字节级）
 *  3. plugin.json 必填字段校验
 *  4. 若本机装有 @electron/asar，则额外交叉校验头部可被官方库解析
 *
 * 用法: node scripts/verify_zpx.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

/** 定位待校验的 zpx：dist/ 下唯一的 .zpx 文件 */
function findZpx() {
  if (!fs.existsSync(DIST)) throw new Error('dist/ 目录不存在，请先执行 node scripts/pack_zpx.js');
  const zpxFiles = fs.readdirSync(DIST).filter((f) => f.endsWith('.zpx'));
  if (zpxFiles.length === 0) throw new Error('dist/ 下没有 .zpx 文件');
  return path.join(DIST, zpxFiles.sort()[zpxFiles.length - 1]);
}

function readAsar(buf) {
  const sizePicklePayload = buf.readUInt32LE(0);
  if (sizePicklePayload !== 4) throw new Error('sizePickle payload 应为 4');
  const headerSize = buf.readUInt32LE(4);
  const headerPicklePayload = buf.readUInt32LE(8);
  const jsonLen = buf.readInt32LE(12);
  if (headerPicklePayload !== 4 + jsonLen + ((4 - (jsonLen % 4)) % 4)) {
    throw new Error('headerPickle payload 长度不匹配');
  }
  const json = buf.slice(16, 16 + jsonLen).toString('utf8');
  const header = JSON.parse(json);
  const dataStart = 8 + headerSize;
  const files = {};
  const walk = (node, base) => {
    for (const [name, entry] of Object.entries(node.files || {})) {
      const rel = base ? `${base}/${name}` : name;
      if (entry.files) walk(entry, rel);
      else files[rel] = { offset: Number(entry.offset), size: entry.size };
    }
  };
  walk(header, '');
  return { header, dataStart, files };
}

function main() {
  let fail = 0;
  const ZPX = findZpx();
  console.log('待校验文件:', ZPX);

  // 1. ZTools 的 isValidZpx：非 gzip magic、非 zip magic → brotli 解压 + asar 头校验
  const zpx = fs.readFileSync(ZPX);
  const GZIP = Buffer.from([0x1f, 0x8b]);
  const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const magic = zpx.slice(0, 4);
  if ((magic[0] === GZIP[0] && magic[1] === GZIP[1]) || ZIP.every((b, i) => magic[i] === b)) {
    throw new Error('zpx 不是 brotli 格式');
  }
  const asarBuf = zlib.brotliDecompressSync(zpx);
  console.log('[1] zpx 解压为 asar:', asarBuf.length, 'bytes');

  const { dataStart, files } = readAsar(asarBuf);
  console.log('[2] asar 头部解析成功，共', Object.keys(files).length, '个文件');

  // 2. plugin.json 权威配置校验（ZTools 安装时读取的字段）
  const pf = files['plugin.json'];
  const config = JSON.parse(asarBuf.slice(dataStart + pf.offset, dataStart + pf.offset + pf.size).toString('utf8'));
  console.log('[3] plugin.json: name=%s version=%s title=%s', config.name, config.version, config.title);
  if (!config.name) throw new Error('缺少 name 字段');
  if (!config.version) throw new Error('缺少 version 字段');
  const hasFeatures = Array.isArray(config.features) && config.features.length > 0;
  const hasTools = config.tools && typeof config.tools === 'object';
  if (!hasFeatures && !hasTools) throw new Error('缺少 features/tools');
  // 文件名应与 plugin.json 版本一致
  const ver = path.basename(ZPX).match(/-v([0-9.]+)\.zpx$/);
  if (ver && ver[1] !== config.version) {
    console.log('   ⚠ 文件名版本(%s) 与 plugin.json 版本(%s) 不一致', ver[1], config.version);
    fail++;
  }

  // 3. 与源目录逐字节比对
  console.log('[4] 与源目录比对:');
  for (const rel of Object.keys(files).sort()) {
    const want = fs.readFileSync(path.join(SRC, rel));
    const got = asarBuf.slice(dataStart + files[rel].offset, dataStart + files[rel].offset + files[rel].size);
    const ok = Buffer.compare(want, got) === 0;
    if (!ok) fail++;
    console.log('   ', ok ? 'OK  ' : 'DIFF', rel, got.length);
  }
  const srcFiles = [];
  const walkDir = (d, base = '') => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walkDir(path.join(d, e.name), rel);
      else srcFiles.push(rel);
    }
  };
  walkDir(SRC);
  for (const rel of srcFiles) {
    if (!(rel in files)) {
      fail++;
      console.log('   MISSING', rel);
    }
  }

  // 4. 官方库交叉校验（可选）：每个文件都能被官方 @electron/asar 读出且字节一致
  try {
    const asar = require('@electron/asar');
    const os = require('os');
    const tmp = path.join(os.tmpdir(), `verify-zpx-${Date.now()}.asar`);
    fs.writeFileSync(tmp, asarBuf);
    try {
      // listPackage 会同时列出目录项，统一分隔符后只比对文件
      const officialList = asar.listPackage(tmp).map((p) => p.replace(/^\\+/, '').replace(/\\/g, '/'));
      let crossOk = true;
      for (const rel of Object.keys(files)) {
        if (!officialList.includes(rel)) {
          console.log('   ⚠ 官方库文件表中缺少', rel);
          crossOk = false;
          continue;
        }
        const got = asar.extractFile(tmp, rel.split('/').join(path.sep));
        const mine = asarBuf.slice(dataStart + files[rel].offset, dataStart + files[rel].offset + files[rel].size);
        if (Buffer.compare(got, mine) !== 0) {
          console.log('   ⚠ 官方库读出内容不一致', rel);
          crossOk = false;
        }
      }
      console.log('[5] 官方 @electron/asar 交叉校验:', crossOk ? '通过（' + Object.keys(files).length + ' 个文件）' : '不一致');
      if (!crossOk) fail++;
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) {}
    }
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.log('[5] 官方 @electron/asar 未安装，跳过交叉校验');
    } else {
      console.log('[5] 官方库交叉校验失败:', e.message);
      fail++;
    }
  }

  if (fail) {
    console.error('校验失败:', fail, '项');
    process.exit(1);
  }
  console.log('全部校验通过 ✓');
}

try {
  main();
} catch (e) {
  console.error('校验失败:', e.message);
  process.exit(1);
}

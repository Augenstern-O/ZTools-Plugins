#!/usr/bin/env node
/** 将 src 插件目录打包成 ZTools 使用的 Brotli 压缩 ASAR（.zpx）。 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/** 按路径排序收集 src 中的普通文件，便于生成稳定、可复现的归档。 */
function collectFiles(dir, base = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  const files = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(abs, rel));
    } else if (entry.isFile()) {
      files.push({ rel, abs, size: fs.statSync(abs).size });
    } else {
      throw new Error(`不支持归档符号链接或特殊文件：${rel}`);
    }
  }
  return files;
}

/** 根据文件相对路径和偏移量构造 ASAR 文件头 JSON。 */
function buildHeader(files, offsets) {
  const root = { files: {} };
  for (const file of files) {
    const parts = file.rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!node.files[parts[i]]) node.files[parts[i]] = { files: {} };
      node = node.files[parts[i]];
    }
    node.files[parts[parts.length - 1]] = {
      offset: String(offsets[file.rel]),
      size: file.size
    };
  }
  return root;
}

/** 按 Chromium Pickle 格式编码字符串及四字节填充。 */
function pickleString(value) {
  const data = Buffer.from(value, 'utf8');
  const padding = (4 - (data.length % 4)) % 4;
  const buffer = Buffer.alloc(8 + data.length + padding);
  buffer.writeUInt32LE(4 + data.length + padding, 0);
  buffer.writeInt32LE(data.length, 4);
  data.copy(buffer, 8);
  return buffer;
}

/** 按 Chromium Pickle 格式编码一个 uint32 值。 */
function pickleUInt32(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(4, 0);
  buffer.writeUInt32LE(value, 4);
  return buffer;
}

/** 校验源目录和元数据后写出带标题、版本号的 .zpx 文件。 */
function main() {
  if (!fs.existsSync(SRC)) throw new Error(`插件源目录不存在：${SRC}`);
  const files = collectFiles(SRC);
  if (!files.some((file) => file.rel === 'plugin.json')) {
    throw new Error('插件源目录缺少 plugin.json');
  }

  const config = JSON.parse(fs.readFileSync(path.join(SRC, 'plugin.json'), 'utf8'));
  if (typeof config.version !== 'string' || !config.version) {
    throw new Error('src/plugin.json 缺少有效的 version 字段');
  }
  const outName = `${config.title || config.name}-v${config.version}.zpx`;
  const outPath = path.join(DIST, outName);
  const offsets = {};
  const contents = [];
  let cursor = 0;
  for (const file of files) {
    offsets[file.rel] = cursor;
    const content = fs.readFileSync(file.abs);
    contents.push(content);
    cursor += content.length;
  }

  const headerBuffer = pickleString(JSON.stringify(buildHeader(files, offsets)));
  const asar = Buffer.concat([pickleUInt32(headerBuffer.length), headerBuffer, ...contents]);
  const zpx = zlib.brotliCompressSync(asar, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 }
  });
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(outPath, zpx);

  console.log('已打包：', outPath);
  console.log(`版本：${config.version}；文件数：${files.length}；ASAR：${asar.length} 字节；ZPX：${zpx.length} 字节`);
}

try {
  main();
} catch (error) {
  console.error('打包失败：', error.message);
  process.exit(1);
}

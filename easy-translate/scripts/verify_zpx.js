#!/usr/bin/env node
/** 解压并严格校验 .zpx 的文件表、插件元数据及源文件字节。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/** 收集源目录文件，供文件表完整性及字节一致性核对。 */
function collectFiles(dir, base = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  const files = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(abs, rel));
    else if (entry.isFile()) files.push({ rel, abs });
    else throw new Error(`源目录包含不支持的符号链接或特殊文件：${rel}`);
  }
  return files;
}

/** 从源 plugin.json 精确定位当前版本对应的归档，避免误选旧包。 */
function findZpx(config) {
  if (!fs.existsSync(DIST)) throw new Error('dist/ 目录不存在，请先生成当前版本的 .zpx');
  if (typeof config.version !== 'string' || !config.version) {
    throw new Error('src/plugin.json 缺少有效的 version 字段');
  }
  const expectedName = `${config.title || config.name}-v${config.version}.zpx`;
  const expectedPath = path.join(DIST, expectedName);
  if (!fs.existsSync(expectedPath) || !fs.statSync(expectedPath).isFile()) {
    throw new Error(`dist/ 中缺少与 src/plugin.json 版本精确匹配的包：${expectedName}`);
  }
  return expectedPath;
}

/** 校验 Pickle 长度并解析 ASAR 头部，拒绝重复、越界或不连续的文件区间。 */
function readAsar(buffer) {
  if (buffer.length < 16) throw new Error('ASAR 数据过短');
  const sizePicklePayload = buffer.readUInt32LE(0);
  if (sizePicklePayload !== 4) throw new Error('ASAR sizePickle payload 应为 4');
  const headerSize = buffer.readUInt32LE(4);
  const headerPicklePayload = buffer.readUInt32LE(8);
  const jsonLength = buffer.readInt32LE(12);
  if (jsonLength < 0 || headerPicklePayload !== 4 + jsonLength + ((4 - (jsonLength % 4)) % 4)) {
    throw new Error('ASAR headerPickle payload 长度不匹配');
  }
  if (16 + jsonLength > buffer.length || headerSize !== 4 + headerPicklePayload) {
    throw new Error('ASAR 头部长度超出范围或不匹配');
  }
  const header = JSON.parse(buffer.subarray(16, 16 + jsonLength).toString('utf8'));
  const dataStart = 8 + headerSize;
  if (dataStart > buffer.length) throw new Error('ASAR 文件数据区起点超出归档范围');

  const files = {};
  /** 递归遍历头部目录，并为每个文件记录数据区偏移和长度。 */
  function walk(node, base) {
    if (!node || typeof node !== 'object' || !node.files || typeof node.files !== 'object') {
      throw new Error(`ASAR 目录节点无效：${base || '/'}`);
    }
    for (const [name, entry] of Object.entries(node.files)) {
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        throw new Error(`ASAR 文件路径无效：${name}`);
      }
      const rel = base ? `${base}/${name}` : name;
      if (Object.prototype.hasOwnProperty.call(files, rel)) throw new Error(`ASAR 文件路径重复：${rel}`);
      if (entry && entry.files) {
        walk(entry, rel);
        continue;
      }
      const offset = Number(entry?.offset);
      const size = entry?.size;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0) {
        throw new Error(`ASAR 文件区间无效：${rel}`);
      }
      if (offset + size > buffer.length - dataStart) throw new Error(`ASAR 文件内容越界：${rel}`);
      files[rel] = { offset, size };
    }
  }
  walk(header, '');

  const ranges = Object.entries(files)
    .map(([rel, file]) => ({ rel, offset: file.offset, size: file.size }))
    .filter((range) => range.size > 0)
    .sort((a, b) => a.offset - b.offset || a.rel.localeCompare(b.rel));
  let cursor = 0;
  for (const range of ranges) {
    if (range.offset !== cursor) throw new Error(`ASAR 文件区间存在空洞或重叠：${range.rel}`);
    cursor += range.size;
  }
  if (dataStart + cursor !== buffer.length) throw new Error('ASAR 文件数据区长度与文件表不一致');
  return { header, dataStart, files };
}

/** 比较归档中的 plugin.json 与源元数据，并检查宿主安装必需字段。 */
function verifyMetadata(asarBuffer, dataStart, files, sourceConfig) {
  const pluginFile = files['plugin.json'];
  if (!pluginFile) throw new Error('ASAR 文件表缺少 plugin.json');
  const archivedConfig = JSON.parse(
    asarBuffer.subarray(dataStart + pluginFile.offset, dataStart + pluginFile.offset + pluginFile.size).toString('utf8')
  );
  if (!archivedConfig.name) throw new Error('归档 plugin.json 缺少 name 字段');
  if (!archivedConfig.version) throw new Error('归档 plugin.json 缺少 version 字段');
  const hasFeatures = Array.isArray(archivedConfig.features) && archivedConfig.features.length > 0;
  const hasTools = archivedConfig.tools && typeof archivedConfig.tools === 'object';
  if (!hasFeatures && !hasTools) throw new Error('归档 plugin.json 缺少 features/tools');
  if (archivedConfig.name !== sourceConfig.name || archivedConfig.version !== sourceConfig.version) {
    throw new Error('归档 plugin.json 的 name/version 与 src/plugin.json 不一致');
  }
  if ((archivedConfig.title || archivedConfig.name) !== (sourceConfig.title || sourceConfig.name)) {
    throw new Error('归档 plugin.json 的标题与 src/plugin.json 不一致');
  }
  return archivedConfig;
}

/** 对比归档与 src 的完整文件集合、文件大小和逐字节内容。 */
function verifySourceFiles(asarBuffer, dataStart, archivedFiles, sourceFiles) {
  const sourceByPath = new Map(sourceFiles.map((file) => [file.rel, file]));
  const archivedPaths = Object.keys(archivedFiles);
  let failures = 0;
  for (const rel of archivedPaths) {
    if (!sourceByPath.has(rel)) {
      console.error(`归档含有源目录不存在的文件：${rel}`);
      failures += 1;
    }
  }
  for (const file of sourceFiles) {
    const archived = archivedFiles[file.rel];
    if (!archived) {
      console.error(`归档缺少源文件：${file.rel}`);
      failures += 1;
      continue;
    }
    const expected = fs.readFileSync(file.abs);
    const actual = asarBuffer.subarray(dataStart + archived.offset, dataStart + archived.offset + archived.size);
    if (expected.length !== archived.size || Buffer.compare(expected, actual) !== 0) {
      console.error(`文件字节不一致：${file.rel}`);
      failures += 1;
    }
  }
  if (archivedPaths.length !== sourceFiles.length) {
    console.error(`文件数量不一致：归档 ${archivedPaths.length}，源目录 ${sourceFiles.length}`);
    failures += 1;
  }
  if (failures) throw new Error(`源文件核对失败，共 ${failures} 项`);
  console.log(`源文件逐字节核对通过：${sourceFiles.length} 个文件`);
}

/** 在安装了官方 @electron/asar 时交叉读取归档并核对文件内容。 */
function verifyOfficialAsar(asarBuffer, files, dataStart) {
  let asar;
  try {
    asar = require('@electron/asar');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log('[可选] 未安装 @electron/asar，跳过官方库交叉校验');
      return;
    }
    throw error;
  }

  const temporaryAsar = path.join(os.tmpdir(), `verify-zpx-${process.pid}-${Date.now()}.asar`);
  try {
    fs.writeFileSync(temporaryAsar, asarBuffer);
    const listedPaths = new Set(
      asar.listPackage(temporaryAsar).map((item) => item.replace(/^\\+/, '').replace(/\\/g, '/'))
    );
    const filePaths = [...listedPaths].filter((item) =>
      !Object.keys(files).some((rel) => rel.startsWith(`${item}/`))
    );
    const officialPaths = new Set(filePaths);
    for (const [rel, file] of Object.entries(files)) {
      if (!officialPaths.has(rel)) throw new Error(`官方库文件表缺少：${rel}`);
      const officialData = asar.extractFile(temporaryAsar, rel.split('/').join(path.sep));
      const expected = asarBuffer.subarray(dataStart + file.offset, dataStart + file.offset + file.size);
      if (Buffer.compare(officialData, expected) !== 0) throw new Error(`官方库读取内容不一致：${rel}`);
    }
    if (officialPaths.size !== Object.keys(files).length) throw new Error('官方库文件表存在额外文件');
    console.log(`[可选] 官方 @electron/asar 交叉校验通过：${officialPaths.size} 个文件`);
  } finally {
    try {
      fs.unlinkSync(temporaryAsar);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

/** 按源版本精确选包，解压并执行元数据、文件表及逐字节校验。 */
function main() {
  if (!fs.existsSync(SRC)) throw new Error(`插件源目录不存在：${SRC}`);
  const sourceConfig = JSON.parse(fs.readFileSync(path.join(SRC, 'plugin.json'), 'utf8'));
  const zpxPath = findZpx(sourceConfig);
  const sourceFiles = collectFiles(SRC);
  console.log('待校验文件：', zpxPath);

  const zpx = fs.readFileSync(zpxPath);
  if ((zpx[0] === 0x1f && zpx[1] === 0x8b) || (zpx[0] === 0x50 && zpx[1] === 0x4b && zpx[2] === 0x03 && zpx[3] === 0x04)) {
    throw new Error('.zpx 不是 Brotli 格式');
  }
  const asarBuffer = zlib.brotliDecompressSync(zpx);
  const { dataStart, files } = readAsar(asarBuffer);
  console.log(`ASAR 头部解析成功，共 ${Object.keys(files).length} 个文件`);

  const config = verifyMetadata(asarBuffer, dataStart, files, sourceConfig);
  console.log(`插件元数据：name=${config.name} version=${config.version} title=${config.title || ''}`);
  verifySourceFiles(asarBuffer, dataStart, files, sourceFiles);
  verifyOfficialAsar(asarBuffer, files, dataStart);
  console.log('全部校验通过');
}

try {
  main();
} catch (error) {
  console.error('校验失败：', error.message);
  process.exit(1);
}

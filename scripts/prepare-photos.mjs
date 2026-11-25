// 把源目录里的原图压成 Web 用的两档尺寸，并生成 photos.json 清单。
//
// 用法：
//   node scripts/prepare-photos.mjs <源目录> [--set=<题材>] [--q-thumb=80] [--q-mid=82]
//                                  [--thumb-edge=400] [--mid-edge=1600]
//   例：node scripts/prepare-photos.mjs ~/Pictures/今年的照片            # 自己的照片，输出到 public/photos/
//       node scripts/prepare-photos.mjs assets/demo-photos/xmas --set=xmas   # 题材自带的一套
//
// 产出（--set 给了就带题材名，免得两套互相覆盖）：
//   public/photos/<set>/thumb/<name>.jpg  长边 400，约 30-50KB   只给缩略图图集用
//   public/photos/<set>/mid/<name>.jpg    长边 1600，按需加载     卡片放大时用
//   public/photos/<set>.json              该题材的清单；不给 --set 时是 public/photos.json
//
// 为什么必须预处理：10M 的 JPEG 解码后占约 80MB 内存，几十张就会撑爆 canvas。
// 原图不进 public/，部署时不会被上传。
//
// 依赖：macOS 自带 sips，不需要装任何 npm 包。

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const args = process.argv.slice(2);
const SRC = args.find(a => !a.startsWith('--'));
const SET = (args.find(a => a.startsWith('--set=')) || '').split('=')[1] || '';
if (SET && (!/^[a-zA-Z0-9_-]+$/.test(SET) || SET === 'demo')) throw new Error('Use a simple photo-set name other than demo.');
const OUT = SET ? `public/photos/${SET}` : 'public/photos';
const MANIFEST = SET ? `public/photos/${SET}.json` : 'public/photos.json';

const num = (k, d) => {
  const a = args.find(x => x.startsWith(`--${k}=`));
  return a ? Number(a.split('=')[1]) : d;
};
const THUMB_EDGE = num('thumb-edge', 400);
const MID_EDGE = num('mid-edge', 1600);
const Q_THUMB = num('q-thumb', 80);
const Q_MID = num('q-mid', 82);
const CONCURRENCY = 6;

const EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.bmp', '.tif', '.tiff']);

if (!SRC) {
  console.error('用法：node scripts/prepare-photos.mjs <源目录> [--set=<题材>]');
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error(`源目录不存在：${SRC}`);
  process.exit(1);
}

/** 递归收集图片，按路径自然排序，保证每次生成的清单顺序一致 */
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
  return out;
}

const files = walk(SRC).sort((a, b) =>
  a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' }));

if (!files.length) {
  console.error(`源目录里没有图片：${SRC}`);
  process.exit(1);
}

fs.mkdirSync(path.join(OUT, 'thumb'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'mid'), { recursive: true });

/** 同名文件加序号，避免不同子目录里的同名照片互相覆盖 */
const used = new Map();
function uniqueName(file) {
  const base = path.basename(file, path.extname(file)).replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
  const n = (used.get(base) || 0) + 1;
  used.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

/** 读原图尺寸（用于判断要不要缩） */
async function imageSize(src) {
  const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src],
    { stdio: ['ignore', 'pipe', 'ignore'] });
  const w = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] || 0);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] || 0);
  return { w, h };
}

/**
 * 压到指定长边并转 JPEG。
 * 注意：`sips -Z` 会把**小于**目标的图也放大（1024 → 1600），
 * 结果是又糊又大。这里先读尺寸，已经够小的只转格式、不放大。
 */
async function sipsResize(src, dst, maxEdge, quality) {
  const { w, h } = await imageSize(src);
  const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality)];
  if (Math.max(w, h) > maxEdge) args.unshift('-Z', String(maxEdge));
  await run('sips', [...args, src, '--out', dst], { stdio: 'ignore' });
}

const entries = files.map(f => ({ src: f, name: uniqueName(f) }));

let done = 0;
let skipped = 0;
let failed = [];
const t0 = Date.now();

async function handle(entry) {
  const thumb = path.join(OUT, 'thumb', `${entry.name}.jpg`);
  const mid = path.join(OUT, 'mid', `${entry.name}.jpg`);

  // 增量：两档都已存在且不比源文件旧就跳过
  const fresh = [thumb, mid].every(dst =>
    fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(entry.src).mtimeMs);
  if (fresh) { entry.ok = true; skipped++; done++; return; }

  try {
    await sipsResize(entry.src, thumb, THUMB_EDGE, Q_THUMB);
    await sipsResize(entry.src, mid, MID_EDGE, Q_MID);
    entry.ok = true;
  } catch (e) {
    failed.push(`${path.basename(entry.src)}: ${e.message}`);
  } finally {
    done++;
    if (done % 20 === 0 || done === entries.length) {
      const pct = Math.round(done / entries.length * 100);
      process.stdout.write(`\r  处理中 ${done}/${entries.length} (${pct}%)  已跳过 ${skipped}  失败 ${failed.length}   `);
    }
  }
}

// 有限并发，避免一次 spawn 几百个 sips 把机器拖死
let cursor = 0;
async function worker() {
  while (cursor < entries.length) {
    const i = cursor++;
    await handle(entries[i]);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stdout.write('\n');

const ok = entries.filter(e => e.ok);
const photos = ok.map(e => ({
  name: e.name,
  thumb: `${path.relative('public', path.join(OUT, 'thumb', `${e.name}.jpg`)).split(path.sep).join('/')}`,
  mid: `${path.relative('public', path.join(OUT, 'mid', `${e.name}.jpg`)).split(path.sep).join('/')}`,
}));

const json = {
  count: photos.length,
  generatedAt: new Date().toISOString(),
  sizes: { thumb: THUMB_EDGE, mid: MID_EDGE },
  photos,
};
fs.writeFileSync(MANIFEST, JSON.stringify(json, null, 2) + '\n');

const sum = dir => fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
const MB = n => (n / 1048576).toFixed(1);

console.log(`\n完成：${photos.length} 张（跳过 ${skipped} 张已是最新，失败 ${failed.length} 张）`);
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`thumb ${MB(sum(path.join(OUT, 'thumb')))}MB（首屏要下的）`);
console.log(`mid   ${MB(sum(path.join(OUT, 'mid')))}MB（按需单张加载）`);
if (failed.length) {
  process.exitCode = 1;
  console.log(`\n失败的 ${failed.length} 张：`);
  for (const f of failed.slice(0, 10)) console.log('  ' + f);
}
console.log(`\n已写入 ${MANIFEST}`);

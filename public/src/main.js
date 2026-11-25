// 入口：装配 preset + engine，接摄像头与手势，跑主循环。
// 这个文件不应该出现任何题材细节（圣诞、配色、粒子数），那些全在 presets/<id>/ 里。

import { GestureScene, GestureFSM, measure, DEFAULT_CFG, buildPhotoAtlas, Sfx } from './engine/index.js';
import { fetchAllWithProgress, bufferToBlobUrl, formatBytes } from './engine/loader.js';
import { pickPreset, DEFAULT_PRESET } from './presets/index.js';

const qs = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

/**
 * 成品定制入口：public/config.json（可选）。
 * 非技术用户只改这一个文件，就能换题材、标题、提示语和照片来源 —— 不用碰代码。
 *   { "preset": "heart", "title": "我们的心动时刻",
 *     "hint": "张开手掌 → 心绽放", "photos": "./photos/heart.json" }
 * 优先级：URL 参数 > config.json > 内置默认。
 */
const CONFIG = (typeof __HAS_CONFIG__ !== 'undefined' && !__HAS_CONFIG__) ? {} : await (async () => {
  try {
    const r = await fetch('./config.json', { cache: 'no-cache' });
    if (!r.ok) return {};
    const j = await r.json();
    return (j && typeof j === 'object') ? j : {};
  } catch { return {}; }
})();

// 题材：?preset=heart / ?preset=xmas2026，不带参数看 config.json，再取默认。
// 打包成「单页应用」时由构建期注入固定值（__PRESET__），使 heart.html 永远是爱心。
const BUILD_PRESET = typeof __PRESET__ !== 'undefined' ? __PRESET__ : null;
const preset = pickPreset(BUILD_PRESET || qs.get('preset') || CONFIG.preset || DEFAULT_PRESET);

// 资源基址：源码里 main.js 在 src/ 下，引用 ../vendor；当代码被打包进 HTML 放在站点根目录时，
// 同一个引用要变成 ./vendor。由构建期注入。
const ASSET_BASE = new URL(typeof __ASSET_BASE__ !== 'undefined' ? __ASSET_BASE__ : '../', import.meta.url).href.replace(/\/$/, '');

// ---------- 0. 设备档位 ----------
// 触屏 + 小屏按手机处理：粒子数、缩略图数、像素比、检测频率全部降档
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);

const NO_CAM = qs.get('nocam') === '1';
const MAX_PHOTOS = 2000;  // 只是防呆上限，实际由图集容量决定挂几张

// 现场调参：不改代码就能在不同屏幕上找平衡
// ?flare=0.2&halo=0.06&alpha=0.42&fsize=2&dim=0.9&hot=1.2&bs=0.3&br=0.9&bt=0.8
const QN = k => (qs.has(k) && isFinite(+qs.get(k)) ? +qs.get(k) : undefined);
const TIER_OVERRIDE = {
  flare: QN('flare'), halo: QN('halo'), elemAlpha: QN('alpha'),
  flareSize: QN('fsize'), coreDim: QN('dim'), hot: QN('hot'),
  bloomStrength: QN('bs'), bloomRadius: QN('br'), bloomThreshold: QN('bt'),
};
for (const k of Object.keys(TIER_OVERRIDE)) {
  if (TIER_OVERRIDE[k] === undefined) delete TIER_OVERRIDE[k];
}

const TIER = { ...(IS_MOBILE ? preset.tier.mobile : preset.tier.desktop), ...TIER_OVERRIDE };
const UI = preset.interact;
// 缩略图散开倍数：太小会让所有缩略图在屏幕上挤成一条竖线，「手在哪抓哪里」就没区别了
if (QN('ps') !== undefined) UI.photoSpread = QN('ps');
const COPY = preset.copy;

// ---------- 1. 页面状态 ----------
let pickCount = 0;
let photoTotal = 0;
let allPhotoTotal = 0;

function setState(text, color = '#8fd3ff') {
  const el = $('state');
  el.textContent = text;
  el.style.color = color;
}
function bootMsg(s) { $('boot-msg').textContent = s; }
function bootErr(s) { $('boot-err').textContent = s; }
function bootDone() { $('boot').classList.add('gone'); }

/**
 * 更新启动进度条。
 * @param {number} pct 0~100
 * @param {number} loaded 已下载字节
 * @param {number} total 总字节（0 = 未知）
 */
function bootProgress(pct, loaded, total) {
  const bar = $('boot-bar');
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  const num = $('boot-num');
  if (num && total) num.textContent = `${formatBytes(loaded)} / ${formatBytes(total)}`;
}

/**
 * 后台加载角标：手势模型在后台下载时显示进度，不遮挡主体画面。
 * 启动遮罩撤掉之后，用户靠它知道「还要等多久、手势什么时候能用」。
 *
 * 照片和模型是并行加载的，两者都会往这个角标写。
 * 所以用「优先级」合并：模型进度优先（它决定手势何时可用），
 * 照片进度只在没有模型进度时显示，避免两个提示互相打架。
 */
const loadTipState = { model: null, photos: null };

function loadTipRender() {
  const el = $('loadtip');
  if (!el) return;
  const cur = loadTipState.model || loadTipState.photos;
  if (!cur) { el.classList.add('gone'); return; }
  el.classList.remove('gone');
  const t = $('loadtip-txt');
  if (t) t.textContent = cur.text;
  const b = $('loadtip-bar');
  if (b) b.style.width = `${Math.max(0, Math.min(100, cur.pct))}%`;
}

/** 更新某一类后台加载的进度 */
function loadTip(kind, text, pct) {
  loadTipState[kind] = text ? { text, pct } : null;
  loadTipRender();
}

/**
 * 某一类后台加载结束。
 * 只清自己那一路 —— 照片和模型是并行的，
 * 模型下完不该把「正在加载照片」的提示一起抹掉。
 */
function loadTipDone(kind) {
  loadTipState[kind] = null;
  loadTipRender();
}

// ---------- 2. 3D 场景 ----------
const canvas = $('gl');
const atlas0 = await buildPhotoAtlas([], 8, 8, 256);
const sfx = new Sfx(preset.audio);
if (qs.get('mute') === '1') sfx.setEnabled(false);
const tree = new GestureScene(canvas, atlas0, preset, TIER, sfx);
window.__tree = tree;
window.__preset = preset;

// 文案统一从 preset 注入，index.html 里只留占位；
// config.json 里的 title / hint 优先（成品给终端用户改的入口），
// 但只对它指定的那个题材生效 —— 否则同组里另一个主题的页面会显示错标题。
const cfgApplies = !CONFIG.preset || CONFIG.preset === preset.id;
const TITLE = (cfgApplies && CONFIG.title) || COPY.title || document.title;
document.title = TITLE;
const HINT_DESK = (cfgApplies && CONFIG.hint) || COPY.hintDesktop;
const HINT_TOUCH = (cfgApplies && CONFIG.hintMobile) || (cfgApplies && CONFIG.hint) || COPY.hintMobile;
const hintDesk = document.querySelector('#hint .desk');
const hintTouch = document.querySelector('#hint .touch');
if (hintDesk) hintDesk.textContent = HINT_DESK;
if (hintTouch) hintTouch.textContent = HINT_TOUCH;

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  tree.resize(w, h);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 280));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

// ---------- 2.5 音效开关 ----------
// 浏览器要求 AudioContext 在用户手势之后才能出声，所以第一次点击/按键时解锁。
function syncSoundLabel() {
  const el = $('m-sound');
  if (el) el.textContent = sfx.enabled ? '开' : '关';
  const btn = $('btn-sound');
  if (btn) btn.textContent = sfx.enabled ? '声音 开' : '声音 关';
}
function unlockAudio() {
  sfx.unlock();
  syncSoundLabel();
}
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
syncSoundLabel();

// ---------- 2.6 演示 / 实况 ----------
// 默认演示模式：不显示摄像头实况、按钮栏、提示文字、左上数据面板，给外人看的就是干净画面。
// 但必须有出口，否则切进去就出不来 —— 右上角保留一个几乎透明的工具坞，hover 才浮现，
// 另外 D 键随时切换、?ui=1 / ?ui=0 可以强制指定（分享链接或调试时用）。
const MODE_KEY = 'gt-mode';
const isDemo = () => document.body.classList.contains('demo');

function setMode(mode, save = true) {
  const demo = mode !== 'live';
  document.body.classList.toggle('demo', demo);
  const btn = $('btn-mode');
  if (btn) {
    btn.textContent = demo ? '实况' : '演示';
    btn.title = demo ? '切到实况模式（D 键）' : '切回演示模式（D 键）';
  }
  if (save) { try { localStorage.setItem(MODE_KEY, demo ? 'demo' : 'live'); } catch { /* 隐私模式 */ } }
}
const toggleMode = () => setMode(isDemo() ? 'live' : 'demo');

function bindMode() {
  const q = qs.get('ui');
  if (q === '1') setMode('live', false);
  else if (q === '0') setMode('demo', false);
  else {
    let saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch { /* 隐私模式 */ }
    setMode(saved === 'live' ? 'live' : 'demo', false);   // 没有记录时默认演示
  }
  $('btn-mode')?.addEventListener('click', toggleMode);
  $('btn-sound')?.addEventListener('click', () => {
    sfx.setEnabled(!sfx.enabled);
    syncSoundLabel();
  });
}

// ---------- 3. 照片加载 ----------
// 优先级：?photos=a.jpg,b.jpg → ./photos.json → 手动选择 / 拖拽
// 统一成 { name, thumb, mid } 的清单形式；只手写一串路径时 thumb/mid 相同
async function resolvePhotos() {
  const fromQuery = qs.get('photos');
  if (fromQuery) {
    return fromQuery.split(',').map(s => s.trim()).filter(Boolean)
      .map(p => ({ name: p, thumb: p, mid: p }));
  }

  // ① 显式指定了目录 → 先按序号探测这个目录。
  //    浏览器没有「列目录」的 API，页面不可能自己知道服务器上有哪些文件，
  //    所以要么靠清单，要么靠约定的文件名序号（001.jpg、002.png … 直到 404）。
  //    这样用户只要把图片按顺序命名传进目录就行，不用改任何配置。
  const explicitDir = qs.get('photosdir') || (cfgApplies && CONFIG.photosDir);
  if (explicitDir) {
    const found = await discoverPhotos(explicitDir);
    if (found.length) return found;
  }

  // ② 清单：config.json 里指定的，其次题材自带的
  const manifest = (cfgApplies && CONFIG.photos) || preset.photoManifest || './photos.json';
  try {
    const r = await fetch(manifest, { cache: 'no-cache' });
    if (r.ok) {
      const j = await r.json();
      const list = Array.isArray(j) ? j : (j.photos || []);
      const out = list.map(it => (typeof it === 'string'
        ? { name: it, thumb: it, mid: it }
        : { name: it.name || it.thumb, thumb: it.thumb, mid: it.mid || it.thumb }));
      if (out.length) return out;
    }
  } catch { /* 没有清单就往下走目录探测 */ }

  // ③ 最后兜底：探测题材自己的目录
  const dir = preset.photoManifest
    ? './photos/' + preset.photoManifest.replace(/^\.\/photos\//, '').replace(/\.json$/, '') + '/'
    : './photos/';
  return discoverPhotos(dir);
}

/** 探测一个 URL 是否存在（HEAD 优先，不支持就退回 GET） */
async function urlExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    if (r.ok || r.status === 404 || r.status === 403) return r.ok;
  } catch { /* 某些服务器不支持 HEAD */ }
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    return r.ok;
  } catch { return false; }
}

/** 按 001.jpg / 001.png … 的序号约定探测目录里的图片 */
async function discoverPhotos(dir) {
  const base = dir.endsWith('/') ? dir : dir + '/';
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  const out = [];
  for (let i = 1; i <= 500; i++) {
    const id = String(i).padStart(3, '0');
    let hit = null;
    for (const ext of exts) {
      const url = base + id + ext;
      if (await urlExists(url)) { hit = url; break; }
    }
    if (!hit) break;              // 序号断了就结束
    out.push({ name: id, thumb: hit, mid: hit });
  }
  return out;
}

/** 从全量里随机取 n 个下标（升序），决定这一轮挂哪几张到树上 */
function sampleMounted(total, n) {
  const idx = Array.from({ length: total }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(n, total)).sort((a, b) => a - b);
}

/**
 * @param {Array<{name,thumb,mid}>} photos 全量清单
 * 只在图集里挂 TIER.photoCount 张（首屏只下这批的 thumb），
 * 抽卡时内容从全量随机，所以几百张照片也能全部抽到。
 */
async function applyPhotos(photos) {
  if (!photos.length) return 0;
  const list = photos.slice(0, MAX_PHOTOS);
  try {
    const cap = TIER.photoCount;
    const mounted = sampleMounted(list.length, cap);
    // 并发拉取 + 渐进显示：第一张缩略图到位就上屏，
    // 剩下的一张张补进来，用户不用等整批下载完。
    let swapped = false;
    const atlas = await buildPhotoAtlas(
      mounted.map(i => list[i].thumb),
      8, 8, 256,
      (done, total) => {
        if (!swapped) return;
        loadTip('photos', `加载照片 ${done}/${total}`, (done / total) * 100);
      },
      (a) => {
        // 第一张就位：立刻换上去，让主体先有内容
        swapped = true;
        tree.replaceAtlas(a);
        tree.setPhotoList(list, mounted);
      },
    );
    tree.replaceAtlas(atlas);
    tree.setPhotoList(list, mounted);
    photoTotal = atlas.validIndices.length;
    allPhotoTotal = list.length;
    // 照片下完了，撤掉照片进度提示（模型进度还在就继续显示）
    loadTip('photos', null, 0);
    $('m-photo').textContent = allPhotoTotal > photoTotal
      ? `${photoTotal}/${allPhotoTotal} 张`
      : `${allPhotoTotal} 张`;
    return photoTotal;
  } catch (e) {
    console.error('[photos]', e);
    return 0;
  }
}

function bindPhotoInput() {
  const input = $('filepick');
  $('btn-photo').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const files = [...input.files].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    await applyPhotos(files.map(f => {
    const u = URL.createObjectURL(f);
    return { name: f.name, thumb: u, mid: u };
  }));
    input.value = '';
  });

  // 桌面：把图片拖进窗口即载入
  const drop = $('drop');
  let dragDepth = 0;
  window.addEventListener('dragenter', e => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault(); dragDepth++; drop.classList.add('on');
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('on'); }
  });
  window.addEventListener('drop', async e => {
    e.preventDefault(); dragDepth = 0; drop.classList.remove('on');
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) await applyPhotos(files.map(f => {
      const u = URL.createObjectURL(f);
      return { name: f.name, thumb: u, mid: u };
    }));
  });
}

// ---------- 3.5 直接读本地文件夹（File System Access API） ----------
// 适合「本机大屏」场景：不建目录、不跑脚本、不生成清单，浏览器直接读原图，
// 在内存里缩成两档尺寸后喂给图集。原图不会上传，也不会落盘。
// 只有 Chromium 系支持；Safari / Firefox 里按钮不显示。

/** 把一张图按最长边缩到 maxEdge，编码成 JPEG blob URL（解码一次，两档都从同一个 bitmap 出） */
async function bitmapToUrl(bmp, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const cv = new OffscreenCanvas(w, h);
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await cv.convertToBlob({ type: 'image/jpeg', quality });
  return URL.createObjectURL(blob);
}

async function makePair(file) {
  const bmp = await createImageBitmap(file);   // 自带 EXIF 方向修正
  try {
    return {
      thumb: await bitmapToUrl(bmp, 400, 0.80),
      mid: await bitmapToUrl(bmp, 1600, 0.82),
    };
  } finally {
    bmp.close();   // Release each decoded original before loading the next.
  }
}

async function* walkFiles(dir) {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') yield entry;
    else if (entry.kind === 'directory') yield* walkFiles(entry);
  }
}

function progress(text) {
  const boot = $('boot');
  if (boot.classList.contains('gone')) boot.classList.remove('gone');
  $('boot-msg').textContent = text;
  $('boot-err').textContent = '';
}

async function pickDirectory() {
  let dir;
  try {
    dir = await window.showDirectoryPicker({ mode: 'read' });
  } catch {
    return;   // 用户取消
  }

  const handles = [];
  for await (const f of walkFiles(dir)) {
    if (/\.(jpe?g|png|webp|avif|bmp)$/i.test(f.name)) handles.push(f);
  }
  if (!handles.length) {
    progress('这个文件夹里没有可用的图片');
    setTimeout(bootDone, 1800);
    return;
  }
  handles.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));

  const t0 = performance.now();
  const list = [];
  for (let i = 0; i < handles.length; i++) {
    try {
      const file = await handles[i].getFile();
      const pair = await makePair(file);
      list.push({ name: file.name, thumb: pair.thumb, mid: pair.mid });
    } catch (e) {
      console.warn('[dir] 跳过', handles[i].name, e);
    }
    if (i % 3 === 0 || i === handles.length - 1) {
      const used = ((performance.now() - t0) / 1000).toFixed(0);
      progress(`压缩中 ${i + 1}/${handles.length}…  已用 ${used}s（原图不上传，只在内存里处理）`);
    }
  }

  if (!list.length) {
    progress('没有成功读取到图片');
    setTimeout(bootDone, 1800);
    return;
  }
  await applyPhotos(list);
  bootDone();
}

function bindDirectoryInput() {
  const btn = $('btn-dir');
  if (!btn) return;
  if (!('showDirectoryPicker' in window)) return;   // 不支持就保持隐藏
  btn.hidden = false;
  btn.addEventListener('click', () => {
    pickDirectory().catch(e => {
      console.error('[dir]', e);
      bootErr('读取文件夹失败：' + e.message);
      setTimeout(bootDone, 2600);
    });
  });
}

// ---------- 4. 手势识别 ----------
let fsm = new GestureFSM(DEFAULT_CFG);
let landmarker = null;
const video = $('cam');
let stream = null;
let camReady = false;
let lastDetect = 0;
let lastVideoTime = -1;
let detectMs = 0;
let facing = 'user';

/**
 * 加载手势识别运行时。
 *
 * 为什么要自己下载而不交给 MediaPipe：
 *
 *   1) MediaPipe 内部是「先取 wasm、再取模型」的串行流程。这两个文件
 *      gzip 后还有 4.1MB + 5.8MB，串行排队要多等一整个文件的传输时间。
 *      自己并行下载，两个连接同时占满带宽。
 *   2) 它不暴露任何字节级进度，页面只能显示一句「加载中」，
 *      用户不知道到底卡在哪、还要多久。
 *
 * 拿到字节后直接喂给 MediaPipe：
 *   - 模型 → baseOptions.modelAssetBuffer（Uint8Array，原生支持）
 *   - wasm → 转 Blob URL 覆盖 wasmBinaryPath，MediaPipe 照常 fetch 它，
 *     但数据已在内存里，不会产生二次网络流量。
 */
async function initHandLandmarker() {
  bootMsg('加载手势运行时…');
  // 文件名可在构建期改：nginx 1.24 的默认 mime.types 没有 .mjs，
  // 会被当成 application/octet-stream，浏览器拒绝以模块加载（"Expected a JavaScript-or-Wasm module script"）。
  // 打包时统一改成 .js，就不需要动服务器的 MIME 配置。
  const VISION_FILE = 'vision_bundle.js';
  const { FilesetResolver, HandLandmarker } = await import(`${ASSET_BASE}/vendor/${VISION_FILE}`);
  const vision = await FilesetResolver.forVisionTasks(`${ASSET_BASE}/vendor/wasm`);

  const wasmUrl = new URL(vision.wasmBinaryPath, location.href).href;
  const modelUrl = `${ASSET_BASE}/models/hand_landmarker.task`;

  // The manifest comes from locked npm files. Match the resolver's WASM variant.
  const runtimeResponse = await fetch(`${ASSET_BASE}/vendor/runtime.json`, { signal: AbortSignal.timeout(5000) });
  if (!runtimeResponse.ok) throw new Error('运行时缺失，请先运行 npm run setup:runtime');
  const runtime = await runtimeResponse.json();
  const wasmFile = new URL(wasmUrl).pathname.split('/').pop();
  const wasmAsset = runtime.files[wasmFile];
  if (!wasmAsset) throw new Error(`运行时不匹配：${wasmFile}`);
  const CDN_WASM = `https://registry.npmmirror.com/@mediapipe/tasks-vision/${runtime.visionVersion}/files/wasm/${wasmFile}`;
  const CDN_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  const wasmUrls = [CDN_WASM, wasmUrl];
  const modelUrls = [modelUrl, CDN_MODEL];

  // Sizes and digests use the locked runtime and official model, not HEAD.
  window.__resourceLoads = {};
  const options = (key, sha256) => ({
    sha256, timeoutMs: 60000, fallbackDelayMs: 250,
    onWinner: url => { window.__resourceLoads[key] = url; },
  });
  const buffers = await fetchAllWithProgress([
    { key: 'wasm', urls: wasmUrls, label: '运行时', size: wasmAsset.size,
      options: options('wasm', wasmAsset.sha256) },
    { key: 'model', urls: modelUrls, label: '手势模型', size: 7819105,
      options: options('model', 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1') },
  ], (info) => {
    const pct = info.overallTotal
      ? Math.round((info.overall / info.overallTotal) * 100)
      : 0;
    const txt = `加载${info.label}（${pct}%）`;
    // 启动遮罩还在就更新遮罩上的进度条，已经撤掉就更新角落角标
    bootMsg(txt);
    bootProgress(pct, info.overall, info.overallTotal);
    loadTip('model', txt, pct);
  });

  const wasmBlob = bufferToBlobUrl(buffers.get('wasm'));
  // 让 MediaPipe 用内存里的 wasm，不再走网络
  vision.wasmBinaryPath = wasmBlob.url;

  // 下载完了，但 MediaPipe 还要编译 wasm、初始化推理图（几秒），
  // 这段时间进度条停在 100% 会让人以为卡住了 —— 换成一句「初始化中」。
  loadTip('model', '初始化手势模型…', 100);
  bootMsg('初始化手势模型…');
  const opts = {
    // modelAssetBuffer 传 Uint8Array，MediaPipe 原生支持，避免它自己再拉一次
    baseOptions: { modelAssetBuffer: new Uint8Array(buffers.get('model')), delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    const r = await HandLandmarker.createFromOptions(vision, opts);
    wasmBlob.dispose();
    return r;
  } catch (e) {
    console.warn('[gesture] GPU delegate 不可用，回退 CPU', e);
    opts.baseOptions.delegate = 'CPU';
    try {
      return await HandLandmarker.createFromOptions(vision, opts);
    } finally {
      wasmBlob.dispose();
    }
  }
}

async function startCamera(mode = facing) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('浏览器不支持 getUserMedia（需要 https 或 localhost）');
  }
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: mode, width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  video.classList.toggle('mirror-off', mode === 'environment');
  await video.play();
  await new Promise(r => (video.readyState >= 2 ? r() : (video.onloadeddata = r)));
  facing = mode;
  camReady = true;
  lastVideoTime = -1;
}

// ---------- 5. 主循环 ----------
let frames = 0, fpsT = 0;
let keyPinch = false;

// 手部移动 → 3D 旋转：连续两帧手掌中心的位移
let prevCx = null, prevCy = null;
let lastHandAt = -1e9;

function photoLabel() {
  if (!photoTotal) return '占位';
  const base = allPhotoTotal > photoTotal
    ? `挂 ${photoTotal}/${allPhotoTotal}`
    : `${allPhotoTotal} 张`;
  return base + (pickCount ? ' / 已抽 ' + pickCount : '');
}

function onDetect(now) {
  const t0 = performance.now();
  const res = landmarker.detectForVideo(video, now);
  const cost = performance.now() - t0;
  detectMs = detectMs ? detectMs * 0.9 + cost * 0.1 : cost;

  const hasHand = res.landmarks && res.landmarks.length > 0;
  const m = hasHand ? measure(res.landmarks[0], video.videoWidth / video.videoHeight) : null;
  const out = fsm.update(m, now);

  if (m) {
    lastHandAt = now;

    // ---- 手怎么动，主体就怎么转 ----
    // 预览是镜像的，所以「屏幕归一化 x」= 1 - 原始 landmark x（自拍镜头的等效处理）；
    // y 轴屏幕向下为正，取反得到「向上为正」。
    const sx = facing === 'user' ? 1 - m.cx : m.cx;
    if (prevCx != null) {
      tree.addHandMove(sx - prevCx, -(m.cy - prevCy));
    }
    prevCx = sx;
    prevCy = m.cy;

    // 手掌位置同时用于「就近抓取」：手在画面哪一侧，就抽那一侧挂着的缩略图
    tree.setHandPoint(sx, m.cy);
  } else {
    prevCx = prevCy = null;
    if (now - lastHandAt > UI.handLostMs) {
      // 手消失超过阈值 → 还原为静止形态：收拢、旋转偏移清零、照片收回、状态机复位。
      // 这里直接 return，避免下面再用「上一帧残留的 open 状态」把主体重新撑开。
      tree.setExpand(0);
      tree.clearHandMove();
      tree.setCardAmount(0);
      fsm.release();
      lastHandAt = now;   // 复位后重新计时，避免每帧都跑一遍
      setState(...COPY.noHand);
      $('m-open').textContent = '-';
      $('m-pinch').textContent = '-';
      $('m-photo').textContent = photoLabel();
      $('m-detect').textContent = detectMs.toFixed(1) + 'ms';
      return;
    }
  }

  // 手势 → 展开度（状态真正切换时才出声，避免连续帧重复）
  if (out.changed) {
    if (out.state === 'open') sfx.whoosh(1);
    else if (out.state === 'fist') sfx.whoosh(-1);
  }
  if (out.state === 'open') tree.setExpand(1);
  else if (out.state === 'fist') tree.setExpand(0);

  // 捏住 → 抽一张并放大；松手收回。只有主体展开到一定程度才允许
  const cardAllowed = tree.progress > UI.pickMinProgress;
  if (out.pick && cardAllowed) {
    pickCount++;
    tree.pickPhoto();
    sfx.chime();
  }
  tree.setCardAmount(cardAllowed ? out.pinchAmount : 0);

  if (m) {
    const [label, color] = COPY.state[out.state] || COPY.noHand;
    const holding = tree.cardAmount > 0.05;
    setState(
      label + (holding ? (cardAllowed ? COPY.holdingCard : COPY.needExpandFirst) : ''),
      holding && cardAllowed ? '#ffd27a' : color,
    );
    $('m-open').textContent = `${m.extendCount}/4  r=${m.fingers.map(f => f.ratio.toFixed(2)).join(' ')}`;
    $('m-pinch').textContent = m.pinch.toFixed(2);
  } else {
    setState(...COPY.noHand);
    $('m-open').textContent = '-';
    $('m-pinch').textContent = '-';
  }
  $('m-photo').textContent = photoLabel();
  $('m-detect').textContent = detectMs.toFixed(1) + 'ms';
}

function loop(now) {
  requestAnimationFrame(loop);

  // 检测按设备档位节流，渲染保持满帧
  const canDetect = camReady && landmarker && video.readyState >= 2;
  if (canDetect) {
    if (now - lastDetect > TIER.detectInterval && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      lastDetect = now;
      try { onDetect(now); } catch (e) { console.error('[detect]', e); }
    }
  } else {
    // 无摄像头时键盘模拟：「P」按住等效于捏住
    tree.setCardAmount(keyPinch && tree.progress > UI.pickMinProgress ? 1 : 0);
  }

  const dt = Math.min(0.05, (now - (loop._prev || now)) / 1000);
  loop._prev = now;
  tree.update(dt);

  $('m-prog').textContent = tree.progress.toFixed(2);
  frames++;
  if (now - fpsT > 500) {
    $('m-fps').textContent = Math.round(frames * 1000 / (now - fpsT));
    frames = 0; fpsT = now;
  }
}

// ---------- 6. 键盘与按钮 ----------
function bindKeyboard() {
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'o') { tree.setExpand(1); sfx.whoosh(1); }
    if (k === 'f') { tree.setExpand(0); sfx.whoosh(-1); }
    if (k === 'p' && !e.repeat) {
      keyPinch = true;
      if (tree.progress > UI.pickMinProgress) { pickCount++; tree.pickPhoto(); sfx.chime(); }
    }
    if (k === 'h') $('hud').classList.toggle('hidden');
    if (k === 'm') { sfx.setEnabled(!sfx.enabled); syncSoundLabel(); }
    if (k === 'd') toggleMode();
  });
  window.addEventListener('keyup', e => {
    if (e.key.toLowerCase() === 'p') keyPinch = false;
  });
}

// 鼠标 / 手指拖动也能转主体（无摄像头时演示用，手感与手势一致）
function bindPointer() {
  let px = null, py = null;
  const down = e => {
    px = e.clientX; py = e.clientY;
    // 无摄像头演示时，点哪就抓哪：把点击位置当成手掌位置
    tree.setHandPoint(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
  };
  const move = e => {
    if (px == null) return;
    const dx = (e.clientX - px) / window.innerWidth;
    const dy = -(e.clientY - py) / window.innerHeight;
    px = e.clientX; py = e.clientY;
    tree.addHandMove(dx * 2.2, dy * 2.2);
  };
  const up = () => { px = py = null; };
  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function bindButtons() {
  $('btn-hud').addEventListener('click', () => {
    const hidden = $('hud').classList.toggle('hidden');
    $('btn-hud').textContent = hidden ? '显示信息' : '隐藏信息';
  });
  $('btn-full').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
      setTimeout(resize, 150);
    } catch (e) { console.warn('[fullscreen]', e); }
  });
  $('btn-cam').addEventListener('click', async () => {
    try {
      await startCamera(facing === 'user' ? 'environment' : 'user');
    } catch (e) {
      console.warn('[camera switch]', e);
      bootErr('切换摄像头失败：' + e.message);
    }
  });
}

// ---------- 7. 启动 ----------
//
// 启动分两个阶段，刻意不把「等模型」放在关键路径上：
//
//   阶段一（立即）：建场景、跑渲染循环、加载照片、申请摄像头。
//                   用户马上就能看到主体在转、能用键盘/拖拽交互。
//   阶段二（后台）：下载 wasm + 模型（合计约 10MB gzip）。
//                   这段公网要几十秒，挡住了就没必要 ——
//                   进度显示在 HUD 角标里，不遮挡画面。
//
// 以前是「等模型 → 才显示画面」，在 350KB/s 的带宽下等于白屏一分多钟。
(async () => {
  resize();
  bindMode();
  bindKeyboard();
  bindPointer();
  bindButtons();
  bindPhotoInput();
  bindDirectoryInput();
  requestAnimationFrame(loop);

  // 照片先异步加载，失败就用占位卡
  resolvePhotos().then(list => { if (list.length) applyPhotos(list); });

  if (NO_CAM) {
    video.classList.add('hidden');
    bootDone();
    setState(...COPY.noCam);
    return;
  }

  // ---- 阶段一：摄像头（需要用户授权，可能弹窗）----
  try {
    bootMsg('请求摄像头权限…');
    await startCamera('user');
  } catch (e) {
    console.error('[camera]', e);
    bootMsg('摄像头不可用');
    bootErr(e.message + ' — 需要 https 或 localhost，且已授予摄像头权限');
    video.classList.add('hidden');
    camReady = false;
    setState(...COPY.keyboardFallback);
    setTimeout(bootDone, 3200);
    return;
  }

  // 场景已经能跑了，先撤掉启动遮罩，把画面还给用户
  bootDone();
  // 但手势模型还在后台下载 —— 状态栏要说清楚是「正在准备」，
  // 否则用户看到「待识别…」会以为摄像头坏了
  setState(...(COPY.loading || COPY.state.none));

  // ---- 阶段二：手势运行时（后台下载，不阻塞画面）----
  try {
    landmarker = await initHandLandmarker();
    loadTipDone('model');
    setState(...COPY.state.none);
  } catch (e) {
    console.error('[init]', e);
    loadTipDone('model');
    $('state').title = e.message;
    setState(...COPY.keyboardFallback);
  }
})();

// ---------------- 照片图集（引擎层） ----------------
// 所有缩略图合成一张 atlas，用单个 Points 一次画完（一个 draw call）。
//
// 加载策略：有限并发（默认 6）+ 逐张就绪即绘制。
//
// 为什么不是串行 await：
//   原来 20 张缩略图是 for 循环里逐张 await，每张都要等一个完整往返。
//   公网 RTT 约 190ms（实测），20 张串行光等待就接近 4 秒，
//   而这些图之间完全独立 —— 并发拉取能把这段等待压掉一个数量级。
//
// 为什么渐进显示：
//   图集是一张 8×8 的大 canvas，等 20 张全下完才 swap 的话，
//   用户会盯着空白主体好几秒。改成每张到位就画进 canvas 并刷新纹理，
//   缩略图一张张浮出来。

import * as THREE from 'three';
import { toLinearTexture } from './util.js';
import { loadImageEl } from './imgsrc.js';

const CONCURRENCY = 6;

/**
 * @param {string[]} urls 照片地址，最多 cols*rows 张
 * @param {number} cols
 * @param {number} rows
 * @param {number} cell
 * @param {(done:number, total:number)=>void} [onProgress] 每张到位回调
 * @param {(atlas:object)=>void} [onFirstReady] 第一张就位时回调（可提前上屏）
 */
export async function buildPhotoAtlas(urls, cols = 8, rows = 8, cell = 256, onProgress, onFirstReady) {
  const cv = document.createElement('canvas');
  cv.width = cols * cell;
  cv.height = rows * cell;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0b1a33';
  ctx.fillRect(0, 0, cv.width, cv.height);

  const total = cols * rows;
  const slots = new Array(total).fill(null);

  const drawPlaceholder = (i, x, y) => {
    const hue = (i * 47) % 360;
    const g = ctx.createLinearGradient(x, y, x + cell, y + cell);
    g.addColorStop(0, `hsl(${hue}, 55%, 44%)`);
    g.addColorStop(1, `hsl(${(hue + 50) % 360}, 50%, 30%)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cell, cell);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = `600 ${cell * 0.28}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i), x + cell / 2, y + cell / 2);
  };

  // 先把占位图铺满，用户立刻能看到有东西在加载
  for (let i = 0; i < total; i++) {
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * cell;
    drawPlaceholder(i, cx, cy);
  }

  const tex = toLinearTexture(THREE, cv);
  tex.needsUpdate = true;
  const atlas = {
    texture: tex,
    canvas: cv,
    cols,
    rows,
    cell,
    slots,
    validIndices: [],
  };

  let done = 0;
  let first = true;
  // 进度分母用「真实照片数」，而不是格子数 ——
  // 8×8 的图集有 64 格，但实际只挂了 20 张，按 64 算会显示「加载照片 61/64」这种误导数字。
  const realCount = urls.filter(Boolean).length;

  const paint = (i, img) => {
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * cell;
    if (img) {
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, cx, cy, cell, cell);
      slots[i] = { ok: true };
    } else {
      drawPlaceholder(i, cx, cy);
      slots[i] = { ok: false };
    }
    tex.needsUpdate = true;
  };

  const handle = async (i) => {
    const url = urls[i];
    let img = null;
    if (url) {
      try {
        img = await loadImageEl(url);
      } catch {
        img = null;
      }
    }
    paint(i, img);
    if (url) done++;
    onProgress?.(done, realCount);
    if (first && img) {
      first = false;
      // 第一张真实照片就位时先把图集交出去，主体不用等全部照片
      onFirstReady?.(atlas);
    }
  };

  // 有限并发：任务队列 + N 个 worker
  let cursor = 0;
  const worker = async () => {
    while (cursor < total) {
      const i = cursor++;
      await handle(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

  atlas.validIndices = slots.map((s, i) => (s && s.ok ? i : -1)).filter(i => i >= 0);
  return atlas;
}

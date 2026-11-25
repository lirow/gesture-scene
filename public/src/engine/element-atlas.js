// ---------------- 元素图集构建器（引擎层） ----------------
// 只负责「开画布、切格子、给绘图工具、收尾成纹理」，具体画什么由 preset 决定。
//
// 一条硬约定（踩过坑）：所有元素都按「颜色衰减到黑、alpha 恒为 1」画，
// 配加色混合天然发光，也不会出现透明像素解预乘带来的彩边。
// 因此 preset 的 draw 里应该把颜色渐变成 #000，而不是用 alpha 渐隐。

import * as THREE from 'three';
import { toLinearTexture } from './util.js';

/**
 * @param {object} spec
 * @param {number} spec.cols 图集列数
 * @param {number} spec.rows 图集行数
 * @param {number} [spec.cell=128] 单格像素
 * @param {(h: object) => void} spec.draw 绘图回调，收到绘图工具集
 * @returns {{texture, canvas, cols, rows, cell}}
 */
export function buildElementAtlas({ cols, rows, cell = 128, draw }) {
  const cv = document.createElement('canvas');
  cv.width = cols * cell;
  cv.height = rows * cell;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cv.width, cv.height);

  const S = cell * 0.5;   // 单格半径，元素按 ±S 作图

  /** 在某个格子里作画：黑底 + lighter 叠加 */
  const at = (i, fn) => {
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * cell;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cell, cell);
    ctx.clip();
    ctx.translate(cx + S, cy + S);
    ctx.globalCompositeOperation = 'lighter';
    fn();
    ctx.restore();
  };

  const grad = (x, y, r, stops) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
  };

  const circle = (x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  const starPath = (R, r, n = 5, rot = -Math.PI / 2) => {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const ang = rot + i * Math.PI / n;
      const rad = i % 2 === 0 ? R : r;
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  };

  draw({ ctx, S, cell, at, grad, circle, roundRect, starPath });

  return {
    texture: toLinearTexture(THREE, cv),
    canvas: cv,
    cols,
    rows,
    cell,
  };
}

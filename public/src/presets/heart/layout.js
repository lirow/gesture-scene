// Heart outline adapted from Google Material Icons "favorite" (Apache-2.0).
// Path converted to sampled coordinates, vertically stretched and extruded.
// See THIRD_PARTY_NOTICES.md and LICENSES/Apache-2.0.txt.
// ---------------- 心形与粒子分布（preset 配置） ----------------
// 这个文件决定「东西长成什么样」。
//
// 形状直接采用**设计过的图标心形路径**（Material Icons 的 favorite），不再自己拼接几何。
// 为什么：决定「像不像爱心」的其实是**凹口深度占高度的比例**。
//   Material 图标 11.4% / Lucide 图标 11.1% / 隐式 (x²+y²−1)³−x²y³ 10.3%
//   我上一版「两个相切圆 + 菱形」 = 29%  ← 凹口深了近 3 倍，两瓣被深谷分开，就是米老鼠耳朵
// 所以这次不调参，直接用一个被设计验证过的轮廓，再把 y 拉一点、加厚度做出饱满感。
//
// 轮廓采样成多边形后，用「点在多边形内 + 到边界距离」做填充与厚度；
// 同时用距离场的梯度算法线，交给着色器做「朝向越正越亮」，这是体积感的来源。

import { ELEM, ELEM_SIZE } from './elements.js';

export const W = 2.80;        // 心宽（世界单位）
export const THICK = 0.46;    // 半厚度：最厚处 0.92（心宽：厚度 ≈ 1 : 0.72，才像充了气）
const YS = 1.08;              // 纵向拉伸：图标本身偏扁，拉 8% 让宽高接近 1:1

// ---- Material Icons `favorite` 的路径（24×24，y 轴向下）----
// M12 21.35 l-1.45-1.32 C5.4 15.36 2 12.28 2 8.5 C2 5.42 4.42 3 7.5 3
//   c1.74 0 3.41 .81 4.5 2.09 C13.09 3.81 14.76 3 16.5 3 C19.58 3 22 5.42 22 8.5
//   c0 3.78-3.4 6.86-8.55 11.54 L12 21.35 Z
const START = [12, 21.35];
const SEGS = [
  ['L', [10.55, 20.03]],
  ['C', [5.4, 15.36], [2, 12.28], [2, 8.5]],
  ['C', [2, 5.42], [4.42, 3], [7.5, 3]],
  ['C', [9.24, 3], [10.91, 3.81], [12, 5.09]],
  ['C', [13.09, 3.81], [14.76, 3], [16.5, 3]],
  ['C', [19.58, 3], [22, 5.42], [22, 8.5]],
  ['C', [22, 12.28], [18.6, 15.36], [13.45, 20.04]],
  ['L', [12, 21.35]],
];

const SRC_W = 20;             // 路径宽（x 2..22）
const SRC_H = 18.35;          // 路径高（y 3..21.35）
const SRC_CX = 12;
const SRC_CY = (3 + 21.35) / 2;
const S = W / SRC_W;          // 路径坐标 → 世界

/** 采样成闭合多边形（世界坐标，y 向上） */
function buildOutline() {
  const pts = [];
  const push = (x, y) => pts.push([(x - SRC_CX) * S, (SRC_CY - y) * S * YS]);
  const N = 18;

  push(START[0], START[1]);
  let cur = START;
  for (const seg of SEGS) {
    if (seg[0] === 'L') {
      push(seg[1][0], seg[1][1]);
      cur = seg[1];
    } else {
      const [, c1, c2, p] = seg;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const u = 1 - t;
        const x = u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p[0];
        const y = u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p[1];
        push(x, y);
      }
      cur = p;
    }
  }
  return pts;
}

const OUTLINE = buildOutline();
const EDGES = OUTLINE.map((p, i) => {
  const q = OUTLINE[(i + 1) % OUTLINE.length];
  return [p[0], p[1], q[0], q[1]];
});

// 世界包围盒
let BX0 = Infinity, BX1 = -Infinity, BY0 = Infinity, BY1 = -Infinity;
for (const [x, y] of OUTLINE) {
  if (x < BX0) BX0 = x;
  if (x > BX1) BX1 = x;
  if (y < BY0) BY0 = y;
  if (y > BY1) BY1 = y;
}
const BXH = (BX1 - BX0) / 2;
const BYH = (BY1 - BY0) / 2;
const BCX = (BX0 + BX1) / 2;
const BCY = (BY0 + BY1) / 2;

/**
 * 一次遍历得到：是否在内部、到边界最近距离、以及最近点的方向（距离场梯度）。
 * 梯度用来算法线：缓冲垫表面 z = f(d)，法线 ∝ (−f'(d)·∇d, 1)。
 */
function probe(px, py) {
  let inside = false;
  let best = Infinity;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < EDGES.length; i++) {
    const e = EDGES[i];
    if ((e[1] > py) !== (e[3] > py)) {
      const xint = e[0] + ((py - e[1]) * (e[2] - e[0])) / (e[3] - e[1]);
      if (px < xint) inside = !inside;
    }
    // 点到线段距离 + 最近点
    const dx = e[2] - e[0];
    const dy = e[3] - e[1];
    let t = ((px - e[0]) * dx + (py - e[1]) * dy) / (dx * dx + dy * dy || 1e-9);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = e[0] + t * dx;
    const qy = e[1] + t * dy;
    const d2 = (qx - px) * (qx - px) + (qy - py) * (qy - py);
    if (d2 < best) { best = d2; nx = qx; ny = qy; }
  }
  const d = Math.sqrt(best);
  // 从边界点指向内的单位向量
  const gx = d > 1e-6 ? (px - nx) / d : 0;
  const gy = d > 1e-6 ? (py - ny) / d : 0;
  return { inside, d, gx, gy };
}

// 最大内切距离：把「到边界距离」归一化到 0..1
const DMAX = (() => {
  let m = 0;
  const N = 64;
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const x = BX0 + ((gx + 0.5) / N) * (BX1 - BX0);
      const y = BY0 + ((gy + 0.5) / N) * (BY1 - BY0);
      const r = probe(x, y);
      if (r.inside && r.d > m) m = r.d;
    }
  }
  return m || 1;
})();

/** 缓冲垫剖面：边缘收到 0，中部最厚。返回 z 与 dz/dd */
function cushion(d) {
  const u = Math.min(1, (d / DMAX) * 1.1);
  const k = Math.PI * 0.5;
  return {
    z: THICK * Math.sin(k * u),
    slope: THICK * k * 1.1 / DMAX * Math.cos(k * u),
  };
}

export const seed = {
  particles: 20260214,
  photos: 21414,
  ambient: 520,
};

/**
 * 粒子位置。r 是每颗粒子的随机数组，out 是复用的输出对象。
 * 写 pos（心形位置）、spread（炸开位置）与法线 nx/ny/nz。
 */
export function layout(r, out) {
  // 包围盒内取点，落在外面的重取（不能往中心收缩，那会把被拒点全挤到轮廓内侧）
  let x = 0;
  let y = 0;
  let pr = null;
  for (let k = 0; k < 7; k++) {
    x = BCX + (r[10 + (k % 6) * 2] * 2 - 1) * BXH * 0.995;
    y = BCY + (r[11 + (k % 6) * 2] * 2 - 1) * BYH * 0.995;
    pr = probe(x, y);
    if (pr.inside) break;
  }
  if (!pr.inside) { x = BCX; y = BCY * 0.4; pr = probe(x, y); }

  out.x = x;
  out.y = y;

  const { z: zSurf, slope } = cushion(pr.d);

  // 绝大多数粒子贴在表面，少数留在内部当灯芯（把「中间只有一层」的暗区补上）
  const shell = r[2] < 0.76;
  let side = 1;
  if (shell) {
    side = r[3] < 0.5 ? 1 : -1;
    // 留三成厚度：全贴表面时，转到侧面会让边缘粒子叠成一条过曝亮带
    out.z = side * zSurf * (0.70 + 0.30 * r[6]);
  } else {
    side = r[3] < 0.5 ? 1 : -1;
    out.z = (r[6] * 2 - 1) * zSurf * 0.92;
  }
  out.shell = shell;

  // 法线 ∝ (−f'(d)·∇d, ±1)：朝正面时 z 分量为正，背面为负
  let nx = -slope * pr.gx;
  let ny = -slope * pr.gy * 1.0;
  let nz = side;
  const len = Math.hypot(nx, ny, nz) || 1;
  out.nx = nx / len;
  out.ny = ny / len;
  out.nz = nz / len;

  // 炸开：球形星云（与其它题材同一套手感）
  const th = r[1] * Math.PI * 2 * 3;
  const ph = Math.acos(1 - 2 * r[2]);
  const rad = 1.45 + 2.0 * Math.pow(r[4], 0.55);
  out.sx = Math.sin(ph) * Math.cos(th) * rad;
  out.sy = Math.cos(ph) * rad * 0.88;
  out.sz = Math.sin(ph) * Math.sin(th) * rad;
}

/**
 * 每个位置挂什么元素。out 复用。
 * 表面以心形 + 粉球为主，内部是灯芯（压暗）。
 */
export function pickElement(r, out) {
  const shell = out.shell;
  let e;
  if (shell) {
    if (r[5] < 0.28) e = ELEM.HEART;
    else if (r[5] < 0.52) e = ELEM.BEAD;
    else if (r[5] < 0.66) e = ELEM.PEARL;
    else if (r[5] < 0.78) e = ELEM.PETAL;
    else if (r[5] < 0.88) e = ELEM.ROSE;
    else if (r[5] < 0.96) e = ELEM.SPARK;
    else e = ELEM.BOKEH;
  } else {
    if (r[5] < 0.60) e = ELEM.DOT;
    else if (r[5] < 0.76) e = ELEM.BEAD;
    else if (r[5] < 0.90) e = ELEM.HEART;
    else e = ELEM.PETAL;
  }
  out.index = e;

  // 粉色系微调：R 最高、B 次之、G 最低，乘上去仍然是粉而不发白。
  // 内部灯芯整体压暗到 0.34，避免穿透时把表面糊白。
  const m = (0.86 + 0.28 * r[7]) * (shell ? 1.0 : 0.34);
  out.r = m;
  out.g = m * (0.86 + 0.06 * r[8]);
  out.b = m * (0.93 + 0.05 * r[9]);

  // 表面元素更大（像贴在心上的实体），内部灯点更小
  out.size = ELEM_SIZE[e] * (shell ? 1.0 : 0.62) * (0.82 + 0.42 * r[9]);
}

/**
 * 缩略图挂在爱心表面：与粒子共用同一套轮廓与厚度，
 * 稍微外挂一点，别和粒子完全压在一起。
 * 随机数调用顺序必须稳定，否则每次刷新挂点都会变。
 */
export function photoLayout(rnd, out) {
  let x = 0;
  let y = 0;
  let pr = null;
  for (let i = 0; i < 8; i++) {
    x = BCX + (rnd() * 2 - 1) * BXH * 0.86;
    y = BCY + (rnd() * 2 - 1) * BYH * 0.86;
    pr = probe(x, y);
    // 留一点边距：贴到轮廓上厚度趋 0，卡片会浮在边缘外面
    if (pr.inside && pr.d > DMAX * 0.14) break;
  }
  if (!pr.inside) { x = BCX; y = BCY; pr = probe(x, y); }

  const side = rnd() < 0.5 ? 1 : -1;
  const { z: zSurf } = cushion(pr.d);
  out.x = x;
  out.y = y;
  out.z = side * (zSurf + 0.05);
  out.seed = rnd();
  out.tx = (rnd() - 0.5) * 0.5;
  out.ty = (rnd() - 0.5) * 0.7;
  out.tz = (rnd() - 0.5) * 0.5;
}

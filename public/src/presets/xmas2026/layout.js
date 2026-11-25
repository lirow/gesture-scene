// ---------------- 树形与粒子分布（preset 配置） ----------------
// 这个文件决定「东西长成什么样」：圣诞树是层叠圆锥 + 壳层挂件 + 内部灯串。
// 换成别的题材（烟花柱、灯笼串、月面）就换这一个文件的 layout 实现。

import { ELEM, ELEM_SIZE } from './elements.js';

export const H = 3.0;          // 树高（世界单位）
export const R = 1.15;         // 底部半径
export const LAYERS = 5.5;     // 树冠层数：半径按 |sin| 起落，形成一层层枝叶

/** 高度 h(0 底部..1 顶部) → 该层的树冠半径 */
export function coneRadius(h) {
  const wave = Math.abs(Math.sin(h * LAYERS * Math.PI));  // 1 在层中间，0 在层与层之间
  return (1 - h) * R * (0.70 + 0.30 * wave);
}

export const seed = {
  particles: 20261225,
  photos: 777001,
  ambient: 9182,
};

/**
 * 粒子位置。r 是长度 10 的随机数组，out 是复用的输出对象（避免每颗粒子分配内存）。
 * 写 pos（树形位置）与 spread（炸开后的星云位置）。
 */
export function layout(r, out) {
  // 层叠圆锥。高度按侧面积加权 h = 1 - sqrt(1-r)：底部密、顶部疏。
  // 直接按 r 均匀采样会把大量粒子挤在树尖（圆锥顶部体积极小），加法混合后过曝成白柱。
  const h = 1 - Math.sqrt(1 - r[0]);
  const y = -H / 2 + h * H;
  const layerR = coneRadius(h);

  // 大部分粒子贴在树冠「壳层」上：屏幕上看只有前后两层叠加，
  // 挂件颜色不会被无数层加色糊成白色；少部分留在内部当灯串。
  const shell = r[2] < 0.80;
  const rf = shell ? (0.90 + 0.10 * r[6]) : (0.12 + 0.70 * Math.pow(r[6], 0.70));
  const ang = r[1] * Math.PI * 2;
  const rr = layerR * rf;

  out.x = Math.cos(ang) * rr;
  out.y = y + (r[3] - 0.5) * 0.05;
  out.z = Math.sin(ang) * rr;
  out.shell = shell;

  // 炸开：球形星云
  const th = r[1] * Math.PI * 2 * 3.0;
  const ph = Math.acos(1 - 2 * r[2]);
  const rad = 1.45 + 2.05 * Math.pow(r[4], 0.55);
  out.sx = Math.sin(ph) * Math.cos(th) * rad;
  out.sy = Math.cos(ph) * rad * 0.88;
  out.sz = Math.sin(ph) * Math.sin(th) * rad;
}

/**
 * 每个位置挂什么元素。out 复用。
 * 壳层全是装饰挂件，内部是灯串（也掺一点彩色，透出去才有层次）。
 */
export function pickElement(r, out) {
  const shell = out.shell;
  let e;
  if (shell) {
    if (r[5] < 0.30) e = ELEM.GOLD_BALL;
    else if (r[5] < 0.47) e = ELEM.RED_BALL;
    else if (r[5] < 0.61) e = ELEM.PINE;
    else if (r[5] < 0.73) e = ELEM.STAR;
    else if (r[5] < 0.83) e = ELEM.GIFT;
    else if (r[5] < 0.88) e = ELEM.FLAKE;
    else if (r[5] < 0.95) e = ELEM.SPARK;
    else e = ELEM.DOT;
  } else {
    if (r[5] < 0.60) e = ELEM.DOT;
    else if (r[5] < 0.78) e = ELEM.GOLD_BALL;
    else if (r[5] < 0.90) e = ELEM.RED_BALL;
    else e = ELEM.PINE;
  }
  out.index = e;

  // 暖色微调；内部灯串整体压暗，突出壳层挂件
  const warm = (0.82 + 0.30 * r[7]) * (shell ? 1.0 : 0.46);
  out.r = warm;
  out.g = warm * (0.95 + 0.05 * r[8]);
  out.b = warm * (0.86 + 0.12 * r[9]);

  // 壳层挂件更大（像真挂在树上的球），内部灯点更小
  out.size = ELEM_SIZE[e] * (shell ? 1.0 : 0.62) * (0.80 + 0.45 * r[9]);
}

/**
 * 缩略图挂在树上：与粒子共用同一个圆锥半径，略微外挂一点。
 * 注意随机数调用顺序必须稳定，否则每次刷新挂点都会变。
 */
export function photoLayout(rnd, out) {
  const h = 0.10 + 0.84 * rnd();                 // 避开树尖和树底
  const layerR = coneRadius(h);
  const rr = layerR * (1.0 + 0.03 * rnd());
  const a = rnd() * Math.PI * 2;
  out.x = Math.cos(a) * rr;
  out.y = -H / 2 + h * H + (rnd() - 0.5) * 0.10;
  out.z = Math.sin(a) * rr;
  out.seed = rnd();
  out.tx = (rnd() - 0.5) * 0.5;
  out.ty = (rnd() - 0.5) * 0.7;
  out.tz = (rnd() - 0.5) * 0.5;
}

// ---------------- 圣诞树 2026（preset 组装） ----------------
// 这一份 preset = 这次交付的成品全部设定。换题材就照这个结构另开一个目录，
// 里面该改的是：elements（画什么挂件）、layout（长成什么形状）、theme（什么色调）、
// tier（性能与光效档位）、interact（手感）、copy（文案）。
//
// 引擎不会 import 这个目录以外的东西 —— 反向依赖只有 engine → preset，没有 preset → engine 的具体实现。

import { ELEM, ELEM_SIZE, atlasSpec } from './elements.js';
import { H, R, LAYERS, coneRadius, layout, pickElement, photoLayout, seed } from './layout.js';
import { theme } from './theme.js';
import { topStar } from './decor.js';
import { tier } from './tier.js';
import { interact } from './interact.js';
import { audio } from './audio.js';
import { copy } from './copy.js';

export const xmas2026 = {
  id: 'xmas2026',
  name: '粒子圣诞树 2026',

  seed,
  // 这个题材自带的一套照片（相对 public/）；没有就回落到 ./photos.json
  photoManifest: './photos/demo/xmas.json',
  theme,
  tier,
  interact,
  audio,
  copy,

  // 元素图集：画什么、每个多大
  elements: {
    atlas: atlasSpec,
    size: ELEM_SIZE,
    index: ELEM,
  },

  // 形状：粒子分布 + 元素挑选 + 缩略图挂点
  shape: {
    H, R, LAYERS,
    coneRadius,
    layout,
    pickElement,
    photoLayout,
  },

  // 顶部装饰（可关）
  decoration: topStar,
};

export default xmas2026;

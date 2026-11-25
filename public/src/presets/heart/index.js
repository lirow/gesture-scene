// ---------------- 粉色爱心（preset 组装） ----------------
// 与圣诞树同一套引擎，只换「长成什么形状、挂什么元素、什么色调」。
// 想看圣诞树：?preset=xmas2026；默认加载这个。

import { ELEM, ELEM_SIZE, atlasSpec } from './elements.js';
import { W, THICK, layout, pickElement, photoLayout, seed } from './layout.js';
import { theme } from './theme.js';
import { decor } from './decor.js';
import { tier } from './tier.js';
import { interact } from './interact.js';
import { audio } from './audio.js';
import { copy } from './copy.js';

export const heart = {
  id: 'heart',
  name: '粉色爱心',

  seed,
  // 这个题材自带的一套照片（相对 public/）；没有就回落到 ./photos.json
  photoManifest: './photos/demo/heart.json',
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
    W, THICK,
    layout,
    pickElement,
    photoLayout,
  },

  // 顶部装饰（爱心不需要）
  decoration: decor,

  /**
   * 心跳：整体缩放 + 亮度同相位脉动。
   * period 1.05s ≈ 57 bpm，是静息心率；scale 只给 5.5%，
   * 幅度再大就不像心跳、像镜头在推。展开成星云时按 expandDamp 衰减。
   */
  pulse: {
    enabled: true,
    period: 1.05,
    scale: 0.055,
    brightness: 0.28,
    expandDamp: 0.70,
  },
};

export default heart;

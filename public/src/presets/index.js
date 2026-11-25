// ---------------- 题材注册表 ----------------
// 新增一个题材：在 presets/<id>/ 建好，然后在这里加一行。
// 页面用 ?preset=<id> 选择，不带参数则用 DEFAULT_PRESET。

import xmas2026 from './xmas2026/index.js';
import heart from './heart/index.js';

export const PRESETS = { xmas2026, heart };
export const DEFAULT_PRESET = 'heart';

export function pickPreset(id) {
  return PRESETS[id] || PRESETS[DEFAULT_PRESET];
}

// ---------------- 引擎入口 ----------------
// 只导出机制，不导出任何题材内容。题材在 ../presets/<id>/ 里，由调用方注入。

export { GestureScene } from './scene.js';
export { Sfx } from './audio.js';
export { GestureFSM, measure, classify, pinchAmountOf, DEFAULT_CFG, LM } from './gesture.js';
export { buildElementAtlas } from './element-atlas.js';
export { buildPhotoAtlas } from './photo-atlas.js';
export { mulberry32, makeSoftDotTexture, toLinearTexture } from './util.js';

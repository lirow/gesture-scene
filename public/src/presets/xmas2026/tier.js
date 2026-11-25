// ---------------- 设备档位（preset 配置） ----------------
// 渲染与识别的全部性能/观感参数。某台机器卡就从这里往下调，改完刷新即可。
//
// 关于粒子数：数值是按「元素精灵」定的，不是按纯色点。单颗覆盖面积比小方块大得多，
// 所以 4200 比早期的 13000 更饱满。换题材时按「屏幕密度」重估，不要直接照抄。

export const tier = {
  desktop: {
    particleCount: 4200,
    photoCount: 48,
    maxPixelRatio: 2,
    detectInterval: 32,        // 手势检测节流（ms），渲染不受影响
    particlePointSize: 0.086,  // 元素本体尺寸（世界单位），点四边形会再乘 flareSize
    photoPointSize: 0.085,
    ambientCount: 950,

    // 散光：见 engine/shaders.js 顶部注释
    elemAlpha: 0.46,
    flareSize: 2.4,
    flare: 3.0,
    halo: 0.10,
    coreDim: 1.0,
    hot: 1.5,

    // 泛光
    bloom: true,
    bloomStrength: 0.26,
    bloomRadius: 0.88,
    bloomThreshold: 0.82,
  },

  mobile: {
    particleCount: 3400,
    photoCount: 28,
    maxPixelRatio: 1.5,
    detectInterval: 50,
    particlePointSize: 0.072,
    photoPointSize: 0.075,
    ambientCount: 320,

    elemAlpha: 0.46,
    flareSize: 2.4,
    flare: 3.0,
    halo: 0.10,
    coreDim: 1.0,
    hot: 1.5,

    bloom: true,
    bloomStrength: 0.22,
    bloomRadius: 0.88,
    bloomThreshold: 0.82,
  },
};

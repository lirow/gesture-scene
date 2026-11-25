// ---------------- 设备档位（preset 配置） ----------------
// 渲染与识别的全部性能/观感参数。某台机器卡就从这里往下调，改完刷新即可。
//
// 与圣诞树的差别：爱心是「一整片面」，粒子集中在投影面积里，
// 密度比锥体高，所以粒子数略减、点略大；粉色亮度天然高，hot 要收一档，
// 否则粉核会被推成纯白、丢掉颜色。

export const tier = {
  desktop: {
    particleCount: 11000,
    photoCount: 24,
    photoVisible: 16,
    maxPixelRatio: 2,
    detectInterval: 32,
    particlePointSize: 0.034,
    photoPointSize: 0.074,
    ambientCount: 700,
    expandGrow: 0.30,     // 展开成星云时粒子不放大，云才散得开
    faceFloor: 0.26,
    lightDir: [-0.45, 0.55, 0.70],   // 光从左上前方打过来，高光随自转移动
    photoAlpha: 0.72,     // 主体偏暗，白边小卡要淡一点才不抢      // 背向相机的那一面压到 30%，做出体积感

    // 散光：淡粉色的星芒 + 紧贴亮核的外晕
    elemAlpha: 0.30,
    flareSize: 2.2,
    flare: 2.2,
    halo: 0.10,
    coreDim: 1.0,
    hot: 0.50,
    flareTint: [1.00, 0.42, 0.68],   // 星芒的镜头色：淡粉，不是白

    bloom: true,
    bloomStrength: 0.30,
    bloomRadius: 0.86,
    bloomThreshold: 0.78,
  },

  mobile: {
    particleCount: 8000,
    photoCount: 16,
    photoVisible: 8,
    maxPixelRatio: 1.5,
    detectInterval: 50,
    particlePointSize: 0.030,
    photoPointSize: 0.066,
    ambientCount: 260,
    expandGrow: 0.45,

    elemAlpha: 0.30,
    flareSize: 2.2,
    flare: 2.2,
    halo: 0.10,
    coreDim: 1.0,
    hot: 0.50,
    flareTint: [1.00, 0.42, 0.68],

    bloom: true,
    bloomStrength: 0.24,
    bloomRadius: 0.86,
    bloomThreshold: 0.82,
  },
};

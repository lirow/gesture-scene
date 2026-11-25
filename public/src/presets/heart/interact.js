// ---------------- 交互手感（preset 配置） ----------------
// 手势/指针输入到画面反应的参数。爱心比圣诞树「轻」，自转慢一点更像在飘；
// 其余手感与圣诞树一致，直接沿用同一套数值。

export const interact = {
  // 展开/收拢的平滑速度（越大越快）
  expandLerp: 5.0,

  // 手部移动 → 旋转：位移喂角速度，不是位置映射角度
  handSpinGain: 42.0,
  handPitchGain: 20.0,
  handSpinDecay: 3.2,
  handPitchSpring: 2.2,
  handDeadZone: 0.0035,
  handMaxStep: 0.12,
  handMaxVel: 5.0,
  pitchLimit: 0.38,

  // 自转：比圣诞树慢一点（0.0026 对 0.0032）
  spin: 0.0026,
  spinIdleBoost: 0.5,

  // 照片卡片的尺寸策略
  card: {
    dist: 2.9,
    minW: 0.13, minH: 0.17,
    maxW: 0.34, maxH: 0.44,
    maxWPortrait: 0.62, maxHPortrait: 0.30,
    restXWide: 0.14,
    restXPortrait: 0.05,
    restYW: 0.02,
    growExp: 1.5,
    moveExp: 2.2,
    opacityGain: 4.0,
    opacityBase: 0.18,
  },

  // 甩出
  throwMinSpeed: 0.9,
  throwMaxSpeed: 3.0,
  throwGain: 0.75,
  throwLife: 0.50,

  // 展开时缩略图跟着散开的倍数。太小会让节点在屏幕上挤成一团，
  // 「手在哪抓哪里」就没有区分度；爱心宽度 2.6、节点半径 ≤1.3，
  // 乘 3.0 后 y 方向到 3.9，仍在相机后撤后的画面内。
  photoSpread: 3.0,

  // 抽卡前置条件：主体展开到这个程度才允许
  pickMinProgress: 0.45,

  // 手离开画面多久后还原（ms）
  handLostMs: 800,
};

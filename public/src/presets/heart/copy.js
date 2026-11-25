// ---------------- 文案（preset 配置） ----------------

export const copy = {
  // 浏览器标签页标题，也可用 config.json 的 title 覆盖
  title: '手势 3D 爱心',
  hintDesktop: '张开手掌 → 爱心绽放　握拳 → 收拢　移动手 → 跟着转　展开后拇指食指捏住 → 照片放大，松手收回',
  hintMobile: '张开绽放 · 握拳收拢 · 挥手转向 · 捏住放大照片',

  // HUD 状态标签：[文案, 颜色]
  state: {
    open: ['张开 · 爱心绽放', '#ff8ab8'],
    fist: ['握拳 · 聚拢成心', '#ffc2d8'],
    none: ['待识别…', '#ffa8c8'],
  },
  // 手势模型还在后台下载时的状态。跟「待识别」区分开 ——
  // 前者是「正在准备」，后者是「准备好了但没看到手」。
  loading: ['手势模型加载中…', '#c89ac0'],
  noHand: ['未检测到手', '#9c7a88'],
  noCam: ['无摄像头 · 键盘 O/F/P 模拟', '#a08070'],
  keyboardFallback: ['键盘 O/F/P 模拟', '#a08070'],

  holdingCard: ' · 照片放大',
  needExpandFirst: ' · 需先张开手掌',
};

// 手势判定 + 状态机（纯逻辑，不依赖 three / DOM，可单独单测）
// 输入：MediaPipe HandLandmarker 归一化关键点（21 点，x/y 在 0..1）
// 输出：稳定手势状态 { none | open | fist } 与 pinch 离散事件

export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_TIP: 20,
};

const FINGERS = [
  { name: 'index',  mcp: 5,  pip: 6,  tip: 8  },
  { name: 'middle', mcp: 9,  pip: 10, tip: 12 },
  { name: 'ring',   mcp: 13, pip: 14, tip: 16 },
  { name: 'pinky',  mcp: 17, pip: 18, tip: 20 },
];

export const DEFAULT_CFG = {
  // 伸直判定：dist(tip,wrist) / dist(pip,wrist)
  extendRatio: 1.16,
  // 四指全伸直 → open；全弯 → fist
  openMinCount: 4,
  fistMaxCount: 0,
  // 掌心尺度基准：max(dist(wrist,middleMCP), dist(indexMCP,pinkyMCP))
  // 捏合：dist(thumbTip,indexTip) / palmScale
  pinchEnter: 0.30,
  pinchExit: 0.40,
  // 捏合额外约束：至少 2 指伸直（避免握拳时拇指食指天然贴在一起被误触发）
  pinchMinExtend: 2,
  // 「捏住放大」的连续映射：distance >= pinchRelease 视为松开(0)，
  // <= pinchTight 视为捏到底(1)，中间线性。实测捏合 0.174、张开 0.385~0.463，
  // 所以 release 取 0.36 留出余量，tight 取 0.16 让真实捏合能接近满量程。
  pinchRelease: 0.36,
  pinchTight: 0.16,
  // 连续量迟滞：超过 on 开始（并抽一张），低于 off 完全收回
  pinchOn: 0.12,
  pinchOff: 0.05,
  // 稳定帧数（防抖滞回）
  stableFrames: 4,
  // pinch 重新触发的冷却（毫秒），防止松手瞬间抖动重复抽卡
  pinchCooldown: 350,
  minHandScore: 0.5,
};

function d(a, b, aspect) {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz * 0.35);
}

/**
 * 从 21 点算度量。aspect = 视频宽/高，用于修正归一化坐标各向异性。
 */
export function measure(landmarks, aspect = 1) {
  // 兼容 {x,y,z} 对象与 [x,y,z] 数组两种输入
  const p = i => {
    const v = landmarks[i];
    return Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] || 0 } : v;
  };
  const palmScale = Math.max(
    d(p(LM.WRIST), p(LM.MIDDLE_MCP), aspect),
    d(p(LM.INDEX_MCP), p(LM.PINKY_MCP), aspect),
  ) || 1e-6;

  const fingers = FINGERS.map(f => {
    const r = d(p(f.tip), p(LM.WRIST), aspect) / (d(p(f.pip), p(LM.WRIST), aspect) || 1e-6);
    return { name: f.name, ratio: r, extended: r > 0, thumbDist: 0 };
  });

  // 掌心中心（腕 + 四个掌指关节的均值），用作「手在画面里的位置」，
  // 驱动 3D 旋转，让手像在拨动这棵树。
  const palmIdx = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let cx = 0, cy = 0;
  for (const i of palmIdx) { cx += p(i).x; cy += p(i).y; }
  cx /= palmIdx.length;
  cy /= palmIdx.length;

  // extended 用相对阈值标注（下面统一用 extendRatio）
  return {
    palmScale,
    cx,
    cy,
    fingers: fingers.map(f => ({ ...f, extended: f.ratio > DEFAULT_CFG.extendRatio })),
    extendCount: fingers.filter(f => f.ratio > DEFAULT_CFG.extendRatio).length,
    pinch: d(p(LM.THUMB_TIP), p(LM.INDEX_TIP), aspect) / palmScale,
    // 拇指是否外张：thumbTip 到 indexMCP 距离 / palmScale
    thumbOpen: d(p(LM.THUMB_TIP), p(LM.INDEX_MCP), aspect) / palmScale,
  };
}

export function classify(m, cfg = DEFAULT_CFG) {
  const extended = m.fingers.filter(f => f.ratio > cfg.extendRatio).length;
  if (extended >= cfg.openMinCount) return 'open';
  if (extended <= cfg.fistMaxCount) return 'fist';
  return 'none';
}

/**
 * 捏合程度 → 0..1 连续量。张开手为 0，捏到底为 1。
 */
export function pinchAmountOf(pinchDist, cfg = DEFAULT_CFG) {
  const { pinchRelease, pinchTight } = cfg;
  const t = (pinchRelease - pinchDist) / (pinchRelease - pinchTight);
  return Math.max(0, Math.min(1, t));
}

/**
 * 手势状态机：帧级 raw 结果 → 稳定手势状态 + 捏合连续量
 */
export class GestureFSM {
  constructor(cfg = DEFAULT_CFG) {
    this.cfg = cfg;
    this.raw = 'none';
    this.stable = 'none';
    this.candidate = 'none';
    this.count = 0;
    this.pinchAmount = 0;      // 0..1 连续量，直接驱动卡片缩放
    this.pinchActive = false;  // 是否处于「按住」区间
    this.lastPickAt = -1e9;
    this.lastMeasure = null;
  }

  /**
   * @returns {{state:string, pinchAmount:number, pick:boolean, active:boolean, changed:boolean, measure:any}}
   *   state: 稳定手势（none/open/fist）
   *   pinchAmount: 0..1 捏合程度（渲染层自己做平滑）
   *   pick: 本次帧是否要抽一张新照片（每次捏下只抽一次）
   */
  update(measureResult, now = performance.now()) {
    const cfg = this.cfg;
    this.lastMeasure = measureResult;

    if (!measureResult) {
      // 丢手：raw 归 none，但状态不立刻清（避免抖动）
      this.raw = 'none';
    } else {
      this.raw = classify(measureResult, cfg);
    }

    // 稳定帧滞回
    if (this.raw === this.candidate) {
      this.count++;
    } else {
      this.candidate = this.raw;
      this.count = 1;
    }
    let changed = false;
    if (this.count >= cfg.stableFrames && this.stable !== this.candidate) {
      this.stable = this.candidate;
      changed = true;
    }

    // 捏合连续量
    let amount = 0;
    if (measureResult) {
      const canPinch = measureResult.extendCount >= cfg.pinchMinExtend;
      // 握拳时拇指食指天然贴近，必须靠「伸长指数」拦住
      amount = canPinch ? pinchAmountOf(measureResult.pinch, cfg) : 0;
    }
    this.pinchAmount = amount;

    // press / release 迟滞：按下时抽一张，松手后清空
    let pick = false;
    const wasActive = this.pinchActive;
    if (!wasActive && amount >= cfg.pinchOn) {
      this.pinchActive = true;
      if (now - this.lastPickAt > cfg.pinchCooldown) {
        this.lastPickAt = now;
        pick = true;
      }
    } else if (wasActive && amount <= cfg.pinchOff) {
      this.pinchActive = false;
    }

    return {
      state: this.stable,
      pinchAmount: amount,
      pick,
      active: this.pinchActive,
      changed,
      measure: measureResult,
    };
  }

  /**
   * 手离开画面过久后强制复位：稳定态归 none、捏合归零。
   * 避免「手没了但状态还停在张开」导致树一直散着不还原。
   */
  release() {
    this.raw = 'none';
    this.stable = 'none';
    this.candidate = 'none';
    this.count = 0;
    this.pinchAmount = 0;
    this.pinchActive = false;
    this.lastMeasure = null;
  }
}

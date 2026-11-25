// ---------------- 粉色爱心元素精灵（preset 配置） ----------------
// 题材语言：主元素是「小心形」，配珠光粉球、花瓣、亮核、四角闪光和一层虚焦光斑。
// 8 个元素排成 4×2 图集，每个粒子按索引取一格。
//
// 画法约定（引擎层的硬要求）：颜色一律渐变到 #000、不用 alpha 渐隐 ——
// 配加色混合天然发光，也不会出现透明像素解预乘的彩边。作图半径 S 是格子的一半。

/** 元素索引。改这里的编号要同步改下面 at(...) 的格子号。 */
export const ELEM = {
  HEART: 0,    // 粉色小心形（主元素）
  BEAD: 1,     // 珠光粉球
  ROSE: 2,     // 深玫红球（压住整体色，给层次）
  PETAL: 3,    // 花瓣
  DOT: 4,      // 内部灯芯（淡粉光点）
  SPARK: 5,    // 四角闪光
  PEARL: 6,    // 珠光白点（高光点缀）
  BOKEH: 7,    // 虚焦光斑（只加一层薄雾感，不抢主体）
};

/** 每个元素的相对尺寸。心形最大，光点最小；光斑面积大但本身很暗。 */
export const ELEM_SIZE = [1.58, 1.02, 0.88, 1.10, 0.54, 0.86, 0.62, 1.22];

/** 心形路径：以 (0,0) 为心形中心，w 为半宽。 */
function heartPath(ctx, cx, cy, w) {
  const h = w * 0.92;
  ctx.beginPath();
  ctx.moveTo(cx, cy + h * 0.72);
  ctx.bezierCurveTo(cx - w * 1.06, cy - h * 0.10, cx - w * 0.66, cy - h * 0.95, cx, cy - h * 0.34);
  ctx.bezierCurveTo(cx + w * 0.66, cy - h * 0.95, cx + w * 1.06, cy - h * 0.10, cx, cy + h * 0.72);
  ctx.closePath();
}

export const atlasSpec = {
  cols: 4,
  rows: 2,
  cell: 128,
  draw({ ctx, S, at, grad, circle, starPath }) {
    // ---- 0 粉色小心形：玫粉球体感 + 左侧高光 ----
    at(ELEM.HEART, () => {
      ctx.fillStyle = grad(0, S * 0.05, S * 1.02, [
        [0, '#ff7fb2'], [0.28, '#ff2f77'], [0.58, '#a80b40'],
        [0.82, '#2c0411'], [1, '#000'],
      ]);
      heartPath(ctx, 0, -S * 0.04, S * 0.90);
      ctx.fill();
      // 左上高光，让心形有体积而不是一块平色
      ctx.fillStyle = grad(-S * 0.20, -S * 0.26, S * 0.40, [
        [0, '#ffe1ee'], [0.42, '#ff9dc6'], [0.80, '#ff2f77'], [1, '#000'],
      ]);
      heartPath(ctx, -S * 0.10, -S * 0.14, S * 0.42);
      ctx.fill();
    });

    // ---- 1 珠光粉球：球体 + 亮核 + 点高光 ----
    at(ELEM.BEAD, () => {
      ctx.fillStyle = grad(0, 0, S, [
        [0, '#ff8dbe'], [0.24, '#ff3d84'], [0.46, '#b00f4a'],
        [0.72, '#3c0418'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.98);
      ctx.fillStyle = grad(0, 0, S * 0.44, [
        [0, '#fff2f8'], [0.44, '#ff9cc8'], [0.80, '#a01248'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.44);
      ctx.fillStyle = grad(-S * 0.24, -S * 0.26, S * 0.18, [
        [0, '#ffe8f2'], [0.55, '#ffb0d0'], [1, '#000'],
      ]);
      circle(-S * 0.24, -S * 0.26, S * 0.18);
    });

    // ---- 2 深玫红球：小一号、更沉，用来压住粉色的甜度 ----
    at(ELEM.ROSE, () => {
      ctx.fillStyle = grad(0, 0, S * 0.92, [
        [0, '#c2205c'], [0.30, '#8e0a3c'], [0.60, '#42051c'],
        [0.84, '#120207'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.92);
      ctx.fillStyle = grad(-S * 0.16, -S * 0.18, S * 0.16, [
        [0, '#ff9dc4'], [0.6, '#a01248'], [1, '#000'],
      ]);
      circle(-S * 0.16, -S * 0.18, S * 0.16);
    });

    // ---- 3 花瓣：细长、略带倾斜，比心形柔 ----
    at(ELEM.PETAL, () => {
      ctx.save();
      ctx.rotate(-0.55);
      ctx.fillStyle = grad(0, 0, S * 0.9, [
        [0, '#ffd6e8'], [0.32, '#ff7cae'], [0.66, '#a31048'],
        [0.86, '#2a0511'], [1, '#000'],
      ]);
      ctx.beginPath();
      ctx.moveTo(0, S * 0.88);
      ctx.bezierCurveTo(S * 0.64, S * 0.34, S * 0.52, -S * 0.58, 0, -S * 0.94);
      ctx.bezierCurveTo(-S * 0.52, -S * 0.58, -S * 0.64, S * 0.34, 0, S * 0.88);
      ctx.fill();
      // 中脉提亮
      ctx.fillStyle = grad(0, 0, S * 0.34, [
        [0, '#fff6fa'], [0.5, '#ff9ec4'], [1, '#000'],
      ]);
      ctx.beginPath();
      ctx.ellipse(0, -S * 0.06, S * 0.10, S * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // ---- 4 内部灯芯：白到粉的柔和光点 ----
    at(ELEM.DOT, () => {
      ctx.fillStyle = grad(0, 0, S, [
        [0, '#fffdfe'], [0.14, '#ffe6f1'], [0.30, '#ff9ec6'],
        [0.52, '#a81c52'], [0.78, '#24030f'], [1, '#000'],
      ]);
      circle(0, 0, S);
    });

    // ---- 5 四角闪光 ----
    at(ELEM.SPARK, () => {
      ctx.fillStyle = grad(0, 0, S * 0.85, [
        [0, '#7a2440'], [0.4, '#3a0a1c'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.85);
      starPath(S * 0.94, S * 0.12, 4, -Math.PI / 2);
      ctx.fillStyle = grad(0, 0, S * 0.9, [
        [0, '#ffe9f2'], [0.34, '#ffb6d2'], [0.74, '#ff3d84'], [1, '#5c0a24'],
      ]);
      ctx.fill();
    });

    // ---- 6 珠光白点：极亮的小核，只在少数位置点缀 ----
    at(ELEM.PEARL, () => {
      ctx.fillStyle = grad(0, 0, S * 0.78, [
        [0, '#4a1028'], [0.45, '#1a0410'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.78);
      ctx.fillStyle = grad(0, 0, S * 0.42, [
        [0, '#fff2f8'], [0.34, '#ffd9e8'], [0.72, '#ff8fba'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.42);
    });

    // ---- 7 虚焦光斑：面积大、本身很暗，只用来铺一层薄雾与景深 ----
    at(ELEM.BOKEH, () => {
      ctx.fillStyle = grad(0, 0, S * 0.96, [
        [0, '#5c1a35'], [0.42, '#380e20'], [0.74, '#14040a'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.96);
    });
  },
};

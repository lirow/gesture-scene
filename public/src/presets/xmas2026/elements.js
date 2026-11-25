// ---------------- 圣诞元素精灵（preset 配置） ----------------
// 参考帧里粒子不是纯色点，而是「圣诞球 / 五角星 / 礼物盒 / 松枝 / 灯点 / 雪花」这些具体挂件。
// 8 个元素排成 4×2 图集，每个粒子按索引取一格。
//
// 画法约定：颜色一律渐变到 #000、不用 alpha 渐隐 —— 配加色混合天然发光，
// 也不会出现透明像素解预乘的彩边。作图半径 S 是格子的一半。

/** 元素索引。改这里的编号要同步改下面 at(...) 的格子号。 */
export const ELEM = {
  GOLD_BALL: 0,   // 金色圣诞球
  RED_BALL: 1,    // 红色圣诞球
  PINE: 2,        // 绿松枝
  STAR: 3,        // 金色五角星
  GIFT: 4,        // 金色礼物盒
  DOT: 5,         // 亮金光点
  FLAKE: 6,       // 雪花
  SPARK: 7,       // 四角闪光
};

/** 每个元素的相对尺寸。红球、松枝放大一点，才压得住金色的密度。 */
export const ELEM_SIZE = [0.96, 1.16, 1.50, 1.18, 1.14, 0.58, 0.92, 0.80];

export const atlasSpec = {
  cols: 4,
  rows: 2,
  cell: 128,
  draw({ ctx, S, at, grad, circle, roundRect, starPath }) {
    // ---- 0 金色圣诞球：亮核 + 金色球体 + 左上高光 ----
    at(ELEM.GOLD_BALL, () => {
      ctx.fillStyle = grad(0, 0, S, [
        [0, '#8a5f00'], [0.22, '#c98900'], [0.40, '#8a5200'],
        [0.62, '#2e1a00'], [1, '#000'],
      ]);
      circle(0, 0, S);
      ctx.fillStyle = grad(0, 0, S * 0.46, [
        [0, '#ffeda6'], [0.42, '#ffc247'], [0.78, '#a86000'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.46);
      ctx.fillStyle = grad(-S * 0.20, -S * 0.22, S * 0.20, [
        [0, '#ffffff'], [0.55, '#ffeec0'], [1, '#000'],
      ]);
      circle(-S * 0.20, -S * 0.22, S * 0.20);
    });

    // ---- 1 红色圣诞球：深红球体 + 白高光 + 金帽 ----
    at(ELEM.RED_BALL, () => {
      ctx.fillStyle = grad(0, 0, S, [
        [0, '#ff4d4d'], [0.26, '#ff1e2e'], [0.48, '#c00d1e'],
        [0.72, '#4a0410'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.96);
      ctx.fillStyle = grad(-S * 0.16, -S * 0.18, S * 0.24, [
        [0, '#fff4f0'], [0.40, '#ffb0a6'], [0.80, '#a01420'], [1, '#000'],
      ]);
      circle(-S * 0.16, -S * 0.18, S * 0.24);
      // 金色小帽
      ctx.fillStyle = '#c98a10';
      roundRect(-S * 0.14, -S * 0.96, S * 0.28, S * 0.20, S * 0.06);
      ctx.fill();
    });

    // ---- 2 绿松枝：从底部散开的针叶 ----
    at(ELEM.PINE, () => {
      const sprig = (ang, len, w, c0) => {
        ctx.save();
        ctx.translate(0, S * 0.46);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(w, -len * 0.55, 0, -len);
        ctx.quadraticCurveTo(-w, -len * 0.55, 0, 0);
        ctx.fillStyle = c0;
        ctx.fill();
        ctx.restore();
      };
      sprig(-0.62, S * 0.80, S * 0.14, '#1d8f3e');
      sprig(0.62, S * 0.80, S * 0.14, '#1d8f3e');
      sprig(-0.30, S * 0.98, S * 0.16, '#29b052');
      sprig(0.30, S * 0.98, S * 0.16, '#29b052');
      sprig(0, S * 1.12, S * 0.18, '#3ad86c');
      // 中心针叶提亮，让松枝有层次
      ctx.fillStyle = grad(0, -S * 0.2, S * 0.5, [
        [0, '#8dffb4'], [0.5, '#2aa04c'], [1, '#000'],
      ]);
      sprig(0, S * 0.62, S * 0.09, ctx.fillStyle);
    });

    // ---- 3 金色五角星 ----
    at(ELEM.STAR, () => {
      ctx.fillStyle = grad(0, 0, S, [
        [0, '#5c3d00'], [0.35, '#2a1c00'], [0.7, '#0e0a00'], [1, '#000'],
      ]);
      circle(0, 0, S);
      starPath(S * 0.82, S * 0.34);
      ctx.fillStyle = grad(0, 0, S * 0.85, [
        [0, '#fffbe6'], [0.40, '#ffe066'], [0.72, '#e8941a'], [1, '#7a4200'],
      ]);
      ctx.fill();
    });

    // ---- 4 金色礼物盒 + 红缎带 ----
    at(ELEM.GIFT, () => {
      ctx.fillStyle = grad(0, 0, S * 0.9, [
        [0, '#6b4a08'], [0.55, '#2a1c00'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.9);
      const w = S * 0.78, h = S * 0.68;
      ctx.fillStyle = grad(0, -S * 0.2, S * 0.8, [
        [0, '#ffe27a'], [0.55, '#d99422'], [1, '#6b3f00'],
      ]);
      roundRect(-w / 2, -h / 2, w, h, S * 0.08);
      ctx.fill();
      // 缎带
      ctx.fillStyle = '#c8202e';
      ctx.fillRect(-S * 0.07, -h / 2, S * 0.14, h);
      ctx.fillRect(-w / 2, -S * 0.07, w, S * 0.14);
      // 蝴蝶结
      ctx.fillStyle = '#ff4a4a';
      ctx.beginPath();
      ctx.ellipse(-S * 0.15, -h / 2 - S * 0.04, S * 0.15, S * 0.09, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(S * 0.15, -h / 2 - S * 0.04, S * 0.15, S * 0.09, 0.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // ---- 5 亮金光点（树内部灯串） ----
    at(ELEM.DOT, () => {
      ctx.fillStyle = grad(0, 0, S, [
        [0, '#fffdf2'], [0.13, '#fff0b8'], [0.28, '#ffcf5a'],
        [0.48, '#b06a00'], [0.75, '#2a1800'], [1, '#000'],
      ]);
      circle(0, 0, S);
    });

    // ---- 6 雪花 ----
    at(ELEM.FLAKE, () => {
      ctx.fillStyle = grad(0, 0, S * 0.8, [
        [0, '#8fc4ff'], [0.35, '#2a5c92'], [0.7, '#0c1828'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.8);
      ctx.strokeStyle = '#eaf4ff';
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate(i * Math.PI / 3);
        ctx.lineWidth = S * 0.075;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -S * 0.74);
        ctx.stroke();
        ctx.lineWidth = S * 0.05;
        ctx.beginPath();
        ctx.moveTo(0, -S * 0.36);
        ctx.lineTo(-S * 0.20, -S * 0.54);
        ctx.moveTo(0, -S * 0.36);
        ctx.lineTo(S * 0.20, -S * 0.54);
        ctx.stroke();
        ctx.restore();
      }
    });

    // ---- 7 四角闪光 ----
    at(ELEM.SPARK, () => {
      ctx.fillStyle = grad(0, 0, S * 0.85, [
        [0, '#8a6a18'], [0.4, '#3a2a06'], [1, '#000'],
      ]);
      circle(0, 0, S * 0.85);
      starPath(S * 0.92, S * 0.13, 4, -Math.PI / 2);
      ctx.fillStyle = grad(0, 0, S * 0.9, [
        [0, '#ffffff'], [0.35, '#ffe9a8'], [0.75, '#e0a020'], [1, '#5c3800'],
      ]);
      ctx.fill();
    });
  },
};

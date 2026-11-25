// ---------------- 场景装饰（preset 配置） ----------------
// 圣诞树的树顶五角星。不想要顶部装饰的题材把 enabled 设成 false 即可。

export const topStar = {
  enabled: true,
  canvasSize: 256,
  color: '#ffe27a',
  size: 0.46,          // 世界单位
  position: [0, 1.62, 0],
  opacity: 0.85,
  // 随时间轻微脉动
  pulse: 0.04,
  // 展开时淡出多少（0 = 不淡出）
  expandFade: 0.30,

  /** canvas 上画一颗带光晕的五角星，坐标原点在画布中心。不依赖 this，方便引擎直接调用。 */
  draw({ ctx, s, color }) {
    const cx = s / 2, cy = s / 2;
    const R = s * 0.40, r = R * 0.44;

    // 外发光
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.5);
    halo.addColorStop(0, 'rgba(255,244,200,0.95)');
    halo.addColorStop(0.30, 'rgba(255,206,74,0.55)');
    halo.addColorStop(0.62, 'rgba(255,170,30,0.18)');
    halo.addColorStop(1, 'rgba(255,150,20,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, s, s);

    // 五角星
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / 5;
      const rad = i % 2 === 0 ? R : r;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    const fill = ctx.createRadialGradient(cx, cy * 0.9, 0, cx, cy, R);
    fill.addColorStop(0, '#fffdf0');
    fill.addColorStop(0.45, color || '#ffe27a');
    fill.addColorStop(1, '#ffb020');
    ctx.fillStyle = fill;
    ctx.fill();
  },
};

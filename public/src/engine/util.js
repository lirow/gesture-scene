// ---------------- 通用工具 ----------------

/**
 * 确定性伪随机。不要用「线性同余 + 连续种子取模」：
 * 相邻索引的输出单调递增，几万个粒子会排成一条螺旋线。
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 软圆点贴图（雪花用）。默认 PointsMaterial 的点是硬方块，
 * 直接放大能看到方块边缘，所以必须换径向渐变纹理。
 */
export function makeSoftDotTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(190,210,250,0)') {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, 'rgba(226,238,255,0.85)');
  g.addColorStop(0.7, 'rgba(200,218,250,0.25)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return cv;
}

/** '#ff4d8a' → 'rgba(255,77,138,a)' */
function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * 大范围柔光（氛围光）贴图：中心亮、向外按指数衰减到 0。
 * 最后一档必须是 alpha 0，否则 Sprite 的四条边会露出一个方框。
 */
export function makeGlowTexture(color = '#ff4d8a', size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, hexToRgba(color, 0.95));
  g.addColorStop(0.14, hexToRgba(color, 0.62));
  g.addColorStop(0.32, hexToRgba(color, 0.28));
  g.addColorStop(0.55, hexToRgba(color, 0.09));
  g.addColorStop(0.78, hexToRgba(color, 0.02));
  g.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return cv;
}

/** canvas → THREE 纹理的统一收尾（线性过滤、不生成 mipmap） */
export function toLinearTexture(THREE, canvas, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * 脉动包络：一个周期内「两次搏动 + 一段舒张」。
 *
 * 为什么不用正弦：sin 的升降是对称的，看起来像呼吸/漂浮；真实心跳是
 * 一次强搏（lub）紧接一次弱搏（dub），然后停一段时间。用两个高斯脉冲叠出来
 * 才有「咚·哒……」的节奏。
 *
 * @param {number} p 周期相位 0..1
 * @returns {number} 0..1，峰值 1
 */
export function doubleBeat(p) {
  const ph = p - Math.floor(p);
  const lobe = (c, w) => {
    const d = (ph - c) / w;
    return Math.exp(-d * d);
  };
  return Math.min(1, lobe(0.10, 0.070) + 0.55 * lobe(0.30, 0.085));
}

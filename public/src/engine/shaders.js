// ---------------- 着色器（引擎层，不含题材） ----------------
// 这一层的约定：shader 代码属于引擎，shader 的 uniform 值属于 preset。
// 强度类参数（uFlare/uHalo/uHot/uDim/uCore）开放给 preset；
// 形状类参数（星芒粗细、长度、六芒比例）是这套光效的表现手法，跨题材不需要改，写死在这里。

// 粒子：按 aCell 从元素图集取一格 + 程序化散光（外晕 + 放射星芒）
// 点四边形要比可见元素大一圈，多出来的空间全给星芒用。
export const PARTICLE_VERT = /* glsl */`
  attribute vec3 aSpread;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  attribute float aRot;
  attribute vec2 aCell;
  attribute vec3 aNormal;   // 表面法线（预设给了才有意义，没给是 (0,0,1)）
  uniform float uProgress;
  uniform float uSize;
  uniform float uTime;
  uniform float uPixelScale;
  uniform float uSizeMul;
  uniform float uGrow;     // 展开时粒子放大的倍数：云团要散得开就别放大
  uniform float uFace;     // 背光面压到多暗（1 = 不做明暗）
  uniform vec3 uLight;     // 光照方向（世界空间，已归一化）
  varying vec2 vCell;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRot;
  varying float vSeed;
  void main() {
    float t = clamp((uProgress - aSeed * 0.32) / 0.68, 0.0, 1.0);
    t = smoothstep(0.0, 1.0, t);
    vec3 pos = mix(position, aSpread, t);
    pos.x += sin(uTime * 1.3 + aSeed * 40.0) * 0.02 * t;
    pos.y += cos(uTime * 1.1 + aSeed * 27.0) * 0.02 * t;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uSizeMul * aSize * (1.0 + t * uGrow) * uPixelScale / -mv.z;

    // 体积明暗：用一盏固定方向光做法线漫反射。主体旋转时高光会在表面上移动，
    // 这才像「一个鼓起来的实体」；用视线方向（头部光）会显得平，因为左右对称。
    vec3 wn = normalize(mat3(modelMatrix) * aNormal);
    float lam = clamp(dot(wn, uLight), 0.0, 1.0);

    vCell = aCell;
    vColor = aColor;
    vAlpha = mix(0.92, 0.74, t) * mix(uFace, 1.0, lam);
    vRot = aRot;
    vSeed = aSeed;
  }
`;

export const PARTICLE_FRAG = /* glsl */`
  uniform sampler2D uAtlas;
  uniform vec2 uCellSize;
  uniform float uAlpha;
  uniform float uCore;    // 精灵在点里的占比系数（== flareSize，使元素本体维持原尺寸）
  uniform float uFlare;   // 星芒强度
  uniform float uHalo;    // 外晕强度
  uniform float uDim;     // 元素本体的压暗系数（散光的能量从这里来）
  uniform float uHot;     // 亮部增益：只把亮核推到削顶，压暗的部分不动
  uniform vec3 uFlareTint; // 星芒的镜头色：金色题材给暖白，粉色题材给淡粉
  varying vec2 vCell;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRot;
  varying float vSeed;

  mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  // 沿 y 轴的一根星芒：横向指数衰减做细度，纵向线性衰减做长度
  float ray(vec2 P, float ang, float thin, float len) {
    vec2 q = rot2(ang) * P;
    return exp(-abs(q.x) * thin) * (1.0 - smoothstep(0.0, len, abs(q.y)));
  }

  void main() {
    vec2 P = gl_PointCoord * 2.0 - 1.0;        // -1..1，边缘为 1
    vec2 pr = rot2(vRot) * (gl_PointCoord - 0.5);

    // 元素本体：整张精灵铺在点中心（占比 1/flareSize），四周留白给星芒。
    // clamp 很关键——uv 越过本格会采到图集里相邻的元素。
    vec2 cuv = clamp(vec2(0.5) + vec2(pr.x, -pr.y) * uCore, 0.0, 1.0);
    vec3 core = texture2D(uAtlas, vCell + cuv * uCellSize).rgb;

    float r = length(P);

    // 紧贴亮核的软光晕：衰减要陡（r*r*7），否则相邻粒子的光晕会连成一层雾，
    // 整体看着发白但又不亮。陡衰减下它只是把灯芯向外洇开一圈。
    float halo = exp(-r * r * 7.0) * uHalo;

    // 放射星芒：两轴（十字）为主，部分粒子再叠一轴成六芒
    float a0 = vSeed * 6.2832;
    // 星芒粗细按点尺寸算：太细会落到亚像素，能量被摊没、肉眼看不见
    float thin = 6.0 + 5.0 * fract(vSeed * 7.13);
    float len = 0.42 + 0.26 * fract(vSeed * 3.31);
    float flare = ray(P, a0, thin, len) + ray(P, a0 + 1.5708, thin, len);
    float six = step(0.55, fract(vSeed * 11.7));
    flare += six * ray(P, a0 + 0.7854, thin * 1.15, len * 0.72);

    // 关键一：散光只在元素本体「之外」出现。ray/halo 在中心也都等于 1，
    // 直接叠加等于给每颗粒子再套一个亮核，整体必然过曝。
    float coreR = 1.0 / uCore;                       // 精灵半径（P 单位）
    float mask = smoothstep(coreR * 0.92, coreR * 1.45, r);
    // 外晕单独用一条更宽的过渡：外晕衰减很快，窄掩膜会在本体外围留下一道亮环
    float haloMask = smoothstep(coreR * 0.90, coreR * 2.60, r);

    // 关键二：只有一部分粒子闪星芒。每颗都有的话，1x 下相邻粒子的星芒会连成一张亮网，
    // 糊成雾；挑一部分出来加亮，才有「有几颗在闪」的散光质感。
    flare *= smoothstep(0.55, 0.80, fract(vSeed * 5.31));

    // 星芒偏白（镜头散射近白），带一点点粒子本身的色与题材的镜头色
    vec3 fcol = mix(vColor, uFlareTint, 0.38);

    // 亮核增益：真实灯泡/镜头下的高光会削顶成纯白，边缘保留颜色。
    // 按「亮度」而不是最大通道判断——否则红球的 R 通道也是 1.0，会被一起推成白点。
    float lum = dot(core, vec3(0.299, 0.587, 0.114));
    core *= 1.0 + uHot * smoothstep(0.60, 0.97, lum);

    vec3 col = core * vColor * uDim + fcol * flare * uFlare * mask + fcol * halo * haloMask;
    if (max(col.r, max(col.g, col.b)) < 0.010) discard;
    gl_FragColor = vec4(col, vAlpha * uAlpha);
  }
`;

// 缩略图：从照片图集取一格，画成带白边的小方卡
export const PHOTO_VERT = /* glsl */`
  attribute vec2 aUvOff;
  attribute float aSeed;
  attribute float aOn;
  uniform float uProgress;
  uniform float uSize;
  uniform float uPixelScale;
  uniform float uSpread;   // 展开时缩略图跟着散开的倍数（要够大，屏幕上才分得开）
  uniform float uPhotoAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float t = clamp((uProgress - aSeed * 0.32) / 0.68, 0.0, 1.0);
    t = smoothstep(0.0, 1.0, t);
    vec3 pos = position * mix(1.0, uSpread, t);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * mix(1.0, 1.15, t) * uPixelScale / -mv.z * aOn;
    vUv = aUvOff;
    vAlpha = (0.50 - 0.24 * t) * aOn * uPhotoAlpha;
  }
`;

export const PHOTO_FRAG = /* glsl */`
  uniform sampler2D uAtlas;
  uniform vec2 uCellSize;
  varying vec2 vUv;
  varying float vAlpha;
  float roundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    // 挂件是个小方卡：白边 + 圆角，跟放大后的卡片同一套语言
    float sd = roundedBox(p, vec2(0.90), 0.12);
    if (sd > 0.0) discard;
    vec2 pc = gl_PointCoord;
    pc.y = 1.0 - pc.y;
    vec3 col = texture2D(uAtlas, vUv + pc * uCellSize).rgb;
    float edge = smoothstep(-0.34, -0.20, sd);
    gl_FragColor = vec4(mix(col, vec3(0.97), edge), vAlpha);
  }
`;

// 抽中的照片：白细边 + 圆角
export const CARD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const CARD_FRAG = /* glsl */`
  uniform sampler2D uAtlas;
  uniform vec2 uUvOff;
  uniform vec2 uCellSize;
  uniform float uOpacity;
  varying vec2 vUv;
  float roundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 uv = uUvOff + vUv * uCellSize;
    vec3 col = texture2D(uAtlas, uv).rgb;
    vec2 p = (vUv - 0.5) * 2.0;
    float sd = roundedBox(p, vec2(0.97), 0.07);
    if (sd > 0.0) discard;
    // 只在外圈画一道细白边，内部保持原图
    float edge = smoothstep(-0.048, -0.016, sd);
    vec3 outCol = mix(col, vec3(0.94), edge);
    gl_FragColor = vec4(outCol, uOpacity);
  }
`;

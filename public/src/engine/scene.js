// ---------------- 3D 粒子场景（引擎层） ----------------
// 这一层只管机制：怎么把 preset 给的「形状 / 元素 / 主题 / 手感」变成能跑的场景。
// 它不认识圣诞树、不认识任何具体题材 —— 所有题材相关的决定都在 preset 里。
//
// 依赖方向只有 engine → preset，没有反向。换题材不该需要改这个文件。

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
  PARTICLE_VERT, PARTICLE_FRAG,
  PHOTO_VERT, PHOTO_FRAG,
  CARD_VERT, CARD_FRAG,
} from './shaders.js';
import { buildElementAtlas } from './element-atlas.js';
import { mulberry32, makeSoftDotTexture, makeGlowTexture, toLinearTexture, doubleBeat } from './util.js';
import { loadImageEl } from './imgsrc.js';

/** 背景：径向渐变画布，配色由 preset 给 */
function makeSkyTexture(stops, size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size * 0.5, size * 0.42, 0, size * 0.5, size * 0.5, size * 0.72);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // 大面积渐变在 8bit 下会出现同心圆色带（暗背景上尤其明显）。
  // 加一点 ±2 的随机抖动，肉眼看不出来但足以把色带打散。
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const rnd = mulberry32(20260101);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 4;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  return toLinearTexture(THREE, cv);
}

/** 装饰 sprite：preset 提供 draw(ctx, s, color) */
function makeSpriteTexture(spec) {
  const s = spec.canvasSize || 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  spec.draw({ ctx, s, color: spec.color });
  return toLinearTexture(THREE, cv);
}

export class GestureScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} photoAtlas buildPhotoAtlas 的产物
   * @param {object} preset 题材配置（elements / shape / theme / tier / interact）
   * @param {object} tier 选中的档位（desktop 或 mobile），可被 URL 参数覆盖
   */
  constructor(canvas, photoAtlas, preset, tier, sfx = null) {
    this.preset = preset;
    this.tier = tier;
    this.sfx = sfx;
    this.ui = preset.interact;
    this.theme = preset.theme;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxPixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.theme.exposure;

    this.scene = new THREE.Scene();
    this.scene.background = makeSkyTexture(this.theme.sky, this.theme.skySize);
    this.scene.fog = new THREE.FogExp2(this.theme.fog.color, this.theme.fog.density);

    this.camera = new THREE.PerspectiveCamera(this.theme.camera.fov, 1, 0.1, 100);
    this.baseCamZ = this.theme.camera.z;
    this.camera.position.set(0, this.theme.camera.y, this.baseCamZ);

    // rig 负责整体俯仰（手感 3D），group 负责自转 + 缩放
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.group = new THREE.Group();
    this.rig.add(this.group);

    this.atlas = photoAtlas;
    this.progress = 0;
    this.target = 0;
    this.time = 0;
    this.spinAngle = 0;
    this.cardAmount = 0;
    this.cardTarget = 0;
    this.photoList = [];
    this.mountedPhotoIdx = [];
    this._texCache = new Map();
    this._cardToken = 0;
    this._cardMinScale = 0.3;
    this._cardMaxScale = 1.2;
    this._cardRestX = 0;
    this._cardRestY = 0;
    this._cardZ = this.baseCamZ - this.ui.card.dist;
    this.cardDist = this.ui.card.dist;

    // 手部操控：手的位移 → 角速度（像用手拨动）
    this.handSpinY = 0;
    this.handPitchV = 0;
    this.pitchAngle = 0;
    this.steerActive = false;

    // 整体脉动（呼吸 / 心跳）。题材可关，见 preset.pulse
    this.pulseCfg = preset.pulse || null;
    this.pulseMul = 1;
    this.pulseEnv = 0;

    // 抽卡飞行动画
    this._flyFrom = new THREE.Vector3(0, 0, 0);
    this._flyRot = new THREE.Vector3();
    this._flyOn = false;
    this._hiddenNode = -1;

    // 手掌在画面里的位置（0..1）与瞬时速度（归一化屏幕/秒），用于「就近抓取」和「甩出」
    this._handPt = { x: 0.5, y: 0.5, t: -1e9, vx: 0, vy: 0 };
    // 甩出状态：松手时手够快就把卡片甩出去，而不是淡出缩回
    this._throw = null;
    this._tmpVec = new THREE.Vector3();

    this.elemAtlas = buildElementAtlas(preset.elements.atlas);

    this._buildParticles();
    this._buildPhotos();
    this._buildDecoration();
    this._buildAura();
    this._buildAmbient();
    this._buildCard();

    this._setupComposer();
    this.resize();
  }

  // ---------------- 粒子主体 ----------------

  _buildParticles() {
    const COUNT = this.tier.particleCount;
    const pos = new Float32Array(COUNT * 3);
    const spread = new Float32Array(COUNT * 3);
    const color = new Float32Array(COUNT * 3);
    const size = new Float32Array(COUNT);
    const seed = new Float32Array(COUNT);
    const rot = new Float32Array(COUNT);
    const cell = new Float32Array(COUNT * 2);
    const nrm = new Float32Array(COUNT * 3);

    const { cols, rows } = this.elemAtlas;
    const shape = this.preset.shape;
    const rnd = mulberry32(this.preset.seed.particles);

    // 一次取够随机数，主循环里不再调 rnd()，保证 preset 的 layout 可复现。
    // 预算 24 个：前 10 个够常规分布用，多出来的给需要拒绝采样（在形状内取点）的题材。
    const RV = new Float32Array(COUNT * 24);
    for (let k = 0; k < RV.length; k++) RV[k] = rnd();

    // 复用一个输出对象，避免每颗粒子分配内存
    const out = {
      x: 0, y: 0, z: 0, sx: 0, sy: 0, sz: 0, shell: false,
      index: 0, r: 1, g: 1, b: 1, size: 1,
      nx: undefined, ny: undefined, nz: undefined,
    };

    for (let i = 0; i < COUNT; i++) {
      const r = RV.subarray(i * 24, i * 24 + 24);

      shape.layout(r, out);
      pos[i * 3 + 0] = out.x;
      pos[i * 3 + 1] = out.y;
      pos[i * 3 + 2] = out.z;
      spread[i * 3 + 0] = out.sx;
      spread[i * 3 + 1] = out.sy;
      spread[i * 3 + 2] = out.sz;

      shape.pickElement(r, out);
      cell[i * 2 + 0] = (out.index % cols) / cols;
      cell[i * 2 + 1] = (rows - 1 - Math.floor(out.index / cols)) / rows;

      color[i * 3 + 0] = out.r;
      color[i * 3 + 1] = out.g;
      color[i * 3 + 2] = out.b;
      size[i] = out.size;
      seed[i] = r[3];
      rot[i] = r[4] * Math.PI * 2;
      // 预设没给法线就默认朝向相机（等于关闭朝向明暗）
      nrm[i * 3 + 0] = out.nx ?? 0;
      nrm[i * 3 + 1] = out.ny ?? 0;
      nrm[i * 3 + 2] = out.nz ?? 1;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSpread', new THREE.BufferAttribute(spread, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aRot', new THREE.BufferAttribute(rot, 1));
    g.setAttribute('aCell', new THREE.BufferAttribute(cell, 2));
    g.setAttribute('aNormal', new THREE.BufferAttribute(nrm, 3));

    this.pMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uSize: { value: this.tier.particlePointSize },
        uSizeMul: { value: this.tier.flareSize },
        uGrow: { value: this.tier.expandGrow ?? 1.15 },
        uFace: { value: this.tier.faceFloor ?? 1.0 },
        uLight: { value: new THREE.Vector3().fromArray(this.tier.lightDir || [0, 0, 1]).normalize() },
        uCore: { value: this.tier.flareSize },
        uFlare: { value: this.tier.flare },
        uHalo: { value: this.tier.halo },
        uDim: { value: this.tier.coreDim },
        uHot: { value: this.tier.hot },
        uFlareTint: { value: new THREE.Vector3().fromArray(this.tier.flareTint || [1, 1, 1]) },
        uTime: { value: 0 },
        uPixelScale: { value: 1000 },
        uAtlas: { value: this.elemAtlas.texture },
        uCellSize: { value: new THREE.Vector2(1 / this.elemAtlas.cols, 1 / this.elemAtlas.rows) },
        uAlpha: { value: this.tier.elemAlpha },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._elemAlphaBase = this.tier.elemAlpha;
    this.points = new THREE.Points(g, this.pMat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  // ---------------- 照片缩略图 ----------------

  _buildPhotos() {
    const N = Math.min(this.tier.photoCount, this.atlas.cols * this.atlas.rows);
    const pos = new Float32Array(N * 3);
    const uvOff = new Float32Array(N * 2);
    const seed = new Float32Array(N);
    const on = new Float32Array(N).fill(1);
    const tilt = new Float32Array(N * 3);

    const rnd = mulberry32(this.preset.seed.photos);
    const out = { x: 0, y: 0, z: 0, seed: 0, tx: 0, ty: 0, tz: 0 };
    for (let i = 0; i < N; i++) {
      this.preset.shape.photoLayout(rnd, out);
      pos[i * 3 + 0] = out.x;
      pos[i * 3 + 1] = out.y;
      pos[i * 3 + 2] = out.z;
      seed[i] = out.seed;
      tilt[i * 3 + 0] = out.tx;
      tilt[i * 3 + 1] = out.ty;
      tilt[i * 3 + 2] = out.tz;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aUvOff', new THREE.BufferAttribute(uvOff, 2));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aOn', new THREE.BufferAttribute(on, 1));
    this._photoUvAttr = g.getAttribute('aUvOff');
    this._photoOnAttr = g.getAttribute('aOn');
    this._photoNodes = pos;
    this._photoTilt = tilt;
    this._photoCells = new Array(N).fill(-1);
    this._assignPhotoUv();

    this.phMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uAtlas: { value: this.atlas.texture },
        uCellSize: { value: new THREE.Vector2(1 / this.atlas.cols, 1 / this.atlas.rows) },
        uSize: { value: this.tier.photoPointSize },
        uPixelScale: { value: 1000 },
        uSpread: { value: this.ui.photoSpread },
        uPhotoAlpha: { value: this.tier.photoAlpha ?? 1 },
      },
      vertexShader: PHOTO_VERT,
      fragmentShader: PHOTO_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.photoPoints = new THREE.Points(g, this.phMat);
    this.photoPoints.frustumCulled = false;
    this.group.add(this.photoPoints);
  }

  // ---------------- 装饰 / 环境粒子 / 卡片 ----------------

  _buildDecoration() {
    const dec = this.preset.decoration;
    if (!dec?.enabled) { this.decorationSprite = null; return; }
    const mat = new THREE.SpriteMaterial({
      map: makeSpriteTexture(dec),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: dec.opacity,
    });
    this.decorationSprite = new THREE.Sprite(mat);
    this.decorationSprite.scale.setScalar(dec.size);
    this.decorationSprite.position.set(dec.position[0], dec.position[1], dec.position[2]);
    this.group.add(this.decorationSprite);
  }

  /**
   * 氛围光：一张大范围柔光贴图挂在 rig 上（不跟自转，否则会绕着转）。
   * 它不发光源，只是给主体垫一层同色系的雾 —— 让「光」变成画面的一部分，
   * 而不是只有一颗颗粒子在亮。
   */
  _buildAura() {
    const cfg = this.theme.aura;
    if (!cfg?.enabled) { this.auraLayers = null; return; }

    // 支持多层：一层小而亮当「光源」，一层大而淡当「空气里的雾」。
    // 只有一层时要么像贴纸、要么像脏镜头，两层才有发光体的体积感。
    const layers = cfg.layers?.length
      ? cfg.layers
      : [{ size: cfg.size ?? 4, opacity: cfg.opacity ?? 0.5, z: cfg.z ?? -1.4, y: cfg.y ?? 0 }];

    const tex = new THREE.CanvasTexture(makeGlowTexture(cfg.color || '#ffffff', 256));
    tex.colorSpace = THREE.SRGBColorSpace;

    this.auraLayers = layers.map((l) => {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: l.opacity ?? 0.4,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(0, l.y ?? cfg.y ?? 0, l.z ?? -1.4);
      sp.scale.setScalar(l.size ?? 4);
      this.rig.add(sp);
      return { sprite: sp, size: l.size ?? 4, opacity: l.opacity ?? 0.4 };
    });
  }

  _buildAmbient() {
    const N = this.tier.ambientCount;
    const cfg = this.theme.ambient;
    if (!N || !cfg) { this.ambient = null; return; }

    const pos = new Float32Array(N * 3);
    const spd = new Float32Array(N);
    const rnd = mulberry32(this.preset.seed.ambient);
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 0] = (rnd() - 0.5) * cfg.spreadX;
      pos[i * 3 + 1] = (rnd() - 0.5) * cfg.spreadY;
      pos[i * 3 + 2] = cfg.zFrom + rnd() * cfg.zDepth;
      spd[i] = cfg.speedMin + rnd() * cfg.speedRange;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // 雪花贴图保持 three 的默认过滤（带 mipmap），缩小显示时才不会闪
    const flakeTex = new THREE.CanvasTexture(makeSoftDotTexture());
    this.ambient = new THREE.Points(g, new THREE.PointsMaterial({
      color: cfg.color, size: cfg.size, map: flakeTex,
      transparent: true, opacity: cfg.opacity, alphaTest: 0.01,
      depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    }));
    this.ambient.frustumCulled = false;
    this.ambient.userData.spd = spd;
    this.ambient.userData.span = cfg.spreadY;
    this.scene.add(this.ambient);
  }

  _buildCard() {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: this.atlas.texture },
        uUvOff: { value: new THREE.Vector2(0, 0) },
        uCellSize: { value: new THREE.Vector2(1, 1) },   // 卡片用独立整张纹理，不再从图集取格
        uOpacity: { value: 0 },
      },
      vertexShader: CARD_VERT,
      fragmentShader: CARD_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), m);
    this.card.position.set(0, this._cardRestY, this._cardZ);
    this.card.visible = false;
    this.scene.add(this.card);
  }

  _setupComposer() {
    const w = window.innerWidth, h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.tier.bloom) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        this.tier.bloomStrength,    // strength
        this.tier.bloomRadius,      // radius
        this.tier.bloomThreshold,   // threshold：只让亮部泛光
      );
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
  }

  // ---------------- 照片 atlas 与抽卡 ----------------

  /**
   * 缩略图节点与图集格子一一对应（第 i 个节点 = 第 i 格）。
   * 不再循环复用：照片总数可以远超图集容量，这一点交给 pickPhoto 处理
   * （位置从节点来、内容从全量里随机），而不是把缩略图重复挂满。
   */
  _assignPhotoUv() {
    const attr = this._photoUvAttr;
    if (!attr) return;
    const { cols, rows } = this.atlas;
    const arr = attr.array;
    const total = arr.length / 2;
    const mounted = this.mountedPhotoIdx.length;
    // 可见数量默认取节点数的一半：全部挂上会让主体被白边小卡糊住（尤其实拍照片多是浅色底）。
    // 主体越小、卡片越显眼，题材可以用 tier.photoVisible 指定更少。
    const want = this.tier.photoVisible ?? Math.max(8, Math.round(total / 2));
    const visible = Math.min(total, mounted, want);
    const on = this._photoOnAttr;
    for (let i = 0; i < total; i++) {
      const cell = i;
      const cx = cell % cols;
      const cy = Math.floor(cell / cols);
      arr[i * 2 + 0] = cx / cols;
      arr[i * 2 + 1] = (rows - 1 - cy) / rows;
      this._photoCells[i] = cell;
      if (on) on.array[i] = i < visible ? 1 : 0;
    }
    attr.needsUpdate = true;
    if (on) on.needsUpdate = true;
    this.visiblePhotoCount = visible;
    this._hiddenNode = -1;
  }

  replaceAtlas(atlas) {
    if (this.atlas?.texture) this.atlas.texture.dispose();
    this.atlas = atlas;
    // 只更新缩略图那个 Points；卡片用独立纹理，不能被换掉
    this.phMat.uniforms.uAtlas.value = atlas.texture;
    this.phMat.uniforms.uCellSize.value.set(1 / atlas.cols, 1 / atlas.rows);
    this._assignPhotoUv();
  }

  /**
   * 记录全量照片清单与本次实际挂到树上的那批。
   * @param {Array<{name?,thumb,mid}>} list 全量清单（可以远超图集容量）
   * @param {number[]} mounted 本次挂载的照片在全量里的下标；不传则用前 N 张
   */
  setPhotoList(list, mounted) {
    this.photoList = Array.isArray(list) ? list : [];
    const cap = this._photoOnAttr ? this._photoOnAttr.array.length : 0;
    this.mountedPhotoIdx = Array.isArray(mounted) && mounted.length
      ? mounted.slice(0, cap)
      : Array.from({ length: Math.min(cap, this.photoList.length) }, (_, i) => i);
    this._assignPhotoUv();
  }

  /**
   * 缩略图当前的世界坐标。必须复现 shader 里的展开位移，否则「卡片从缩略图起飞」
   * 和「就近抓取」都会用错位置 —— 展开后缩略图实际在 position * uSpread 处。
   */
  _photoWorldPos(ni, out) {
    const s = this.photoPoints.geometry.attributes.aSeed.array[ni];
    let t = (this.progress - s * 0.32) / 0.68;
    t = Math.max(0, Math.min(1, t));
    t = t * t * (3 - 2 * t);                       // smoothstep，与 shader 一致
    const k = 1 + (this.ui.photoSpread - 1) * t;
    return out.set(
      this._photoNodes[ni * 3] * k,
      this._photoNodes[ni * 3 + 1] * k,
      this._photoNodes[ni * 3 + 2] * k,
    );
  }

  /**
   * 手掌在画面里的归一化位置（0..1，左上为原点，调用方需已处理镜像）。
   * 抓取时用它挑「离手最近的那张」，而不是随机抽 —— 手在左上就抓左上，才有「我在抓这张」的实感。
   */
  setHandPoint(nx, ny) {
    if (!isFinite(nx) || !isFinite(ny)) return;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));
    const now = performance.now();
    const dt = (now - this._handPt.t) / 1000;
    // dt 太小时除去会炸出巨大速度；太大说明中间丢帧了，那个平均速度没有意义
    if (dt > 0.012 && dt < 0.35) {
      const k = 0.55;   // 指数平滑，抹掉单帧抖动
      this._handPt.vx = this._handPt.vx * (1 - k) + ((nx - this._handPt.x) / dt) * k;
      this._handPt.vy = this._handPt.vy * (1 - k) + ((ny - this._handPt.y) / dt) * k;
    }
    this._handPt.x = nx;
    this._handPt.y = ny;
    this._handPt.t = now;
  }

  /**
   * 手掌的手势速度（归一化屏幕/秒）。
   * 按空闲时间线性衰减：手停住 200ms 就视为 0 —— 否则「挥手后停住再松手」
   * 会拿几分钟前的速度去甩卡片，那不是用户想要的。
   */
  _handSpeed() {
    const idle = performance.now() - this._handPt.t;
    if (idle > 200) return 0;
    return Math.hypot(this._handPt.vx, this._handPt.vy) * (1 - idle / 200);
  }

  /**
   * 选离手掌最近的缩略图节点。
   * 从最近的前 3 个里按距离反比加权随机：最近的那张概率最高，
   * 但手不动时连续两次捏不会总是同一张。
   * 手部位置过期（默认 0.5s）或没有手时返回 -1，由调用方回退到随机。
   */
  _pickByHand() {
    const on = this._photoOnAttr;
    if (!on) return -1;
    if (performance.now() - this._handPt.t > 500) return -1;

    const n = on.array.length;
    const pool = [];
    for (let i = 0; i < n; i++) if (on.array[i] > 0.5) pool.push(i);
    if (!pool.length) return -1;

    const aspect = this.camera.aspect || 1;
    const hx = this._handPt.x;
    const hy = this._handPt.y;

    this.group.updateMatrixWorld(true);
    const scored = [];
    for (const i of pool) {
      const v = this._photoWorldPos(i, this._tmpVec)
        .applyMatrix4(this.group.matrixWorld)
        .project(this.camera);
      const sx = v.x * 0.5 + 0.5;
      const sy = 0.5 - v.y * 0.5;
      // 展开后部分缩略图会散到画面外。抽中它，卡片就是从屏幕外飞进来的，
      // 用户看不到「抓的是哪张」—— 直接排除出候选。
      if (sx < -0.02 || sx > 1.02 || sy < -0.02 || sy > 1.02) continue;
      // 按屏幕宽高比加权，否则横向距离会被低估、总是抓竖方向上更远的
      const dx = (sx - hx) * aspect;
      const dy = sy - hy;
      scored.push({ i, d: Math.hypot(dx, dy) });
    }
    if (!scored.length) return -1;   // 全在屏幕外，交给调用方回退随机
    scored.sort((a, b) => a.d - b.d);

    const top = scored.slice(0, Math.min(3, scored.length));
    let sum = 0;
    const w = top.map(o => { const x = 1 / (o.d + 0.02); sum += x; return x; });
    let r = Math.random() * sum;
    for (let k = 0; k < top.length; k++) {
      r -= w[k];
      if (r <= 0) return top[k].i;
    }
    return top[top.length - 1].i;
  }

  /**
   * 抽一张：从「当前可见的缩略图节点」里随机挑一个，
   * 卡片从该节点的屏幕位置放大飞出 —— 保证「从挂着的缩略图放大而来」的因果感。
   */
  pickPhoto(forceNode, forcePhoto) {
    this._throw = null;
    const on = this._photoOnAttr;
    if (!on || !this._photoNodes) return -1;
    const n = on.array.length;

    let ni = typeof forceNode === 'number' ? ((forceNode % n) + n) % n : -1;
    if (ni < 0 || on.array[ni] < 0.5) {
      ni = this._pickByHand();
      if (ni < 0) {
        const pool = [];
        for (let i = 0; i < n; i++) if (on.array[i] > 0.5) pool.push(i);
        if (!pool.length) return -1;
        ni = pool[Math.floor(Math.random() * pool.length)];
      }
    }

    // 照片内容从「全量清单」里随机 —— 不再受图集容量限制，243 张也能全部抽到。
    // 节点只决定「从哪儿飞出来」，内容与位置解耦。
    const total = this.photoList.length;
    const idx = typeof forcePhoto === 'number'
      ? ((forcePhoto % total) + total) % total
      : (total ? Math.floor(Math.random() * total) : -1);

    // 节点世界坐标 → 沿视线投到卡片所在平面，卡片就从「那个缩略图的位置」开始放大
    this.group.updateMatrixWorld(true);
    const w = this._photoWorldPos(ni, new THREE.Vector3())
      .applyMatrix4(this.group.matrixWorld);

    const cam = this.camera.position;
    const dir = w.clone().sub(cam);
    const targetZ = cam.z - this.cardDist;
    const k = Math.abs(dir.z) < 1e-3 ? 1 : (targetZ - cam.z) / dir.z;
    this._flyFrom.copy(cam).add(dir.multiplyScalar(Math.max(0.30, k)));
    this._flyRot.set(
      this._photoTilt[ni * 3 + 0],
      this._photoTilt[ni * 3 + 1],
      this._photoTilt[ni * 3 + 2],
    );
    this._flyOn = true;

    // 该缩略图暂时从树上隐去，卡片就是「它」变大后的样子
    if (this._hiddenNode >= 0) on.array[this._hiddenNode] = 1;
    this._hiddenNode = ni;
    on.array[ni] = 0;
    on.needsUpdate = true;

    this.card.visible = true;
    this.currentPhoto = idx;
    this.currentNode = ni;

    // 卡片纹理由这里异步加载：先 thumb（36KB，立刻可见）再 mid（1600px）
    this._loadPhotoForCard(idx);
    return idx;
  }

  /**
   * 加载卡片纹理。裁成正方形（卡片是正方形 plane，不裁会被拉伸）。
   *
   * 两级缓存，解决「捏合时反复重新拉图」：
   *   - 解码层（imgsrc.js 的 LRU）：留住已解码的图片元素。
   *     纹理被显存上限逐出后，重建纹理直接复用它 —— 不重新下载，也不重新解码。
   *     这是关键：原来这里每次都 new Image()，用户捏同一张照片两次就会再走一次网络。
   *   - 纹理层（本方法的 LRU）：只管显存。1600px 纹理一张约 10MB，
   *     必须卡上限，否则抽几十张就是几百 MB 显存。
   *
   * @param {string} url
   * @param {number} maxCount 纹理层上限
   * @param {number} size 纹理边长
   */
  _tex(url, maxCount, size) {
    const hit = this._texCache.get(url);
    if (hit) {
      this._texCache.delete(url);
      this._texCache.set(url, hit);          // 提到最近使用
      return Promise.resolve(hit);
    }
    return loadImageEl(url).then((im) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      const s0 = Math.min(im.width, im.height);
      ctx.drawImage(im, (im.width - s0) / 2, (im.height - s0) / 2, s0, s0, 0, 0, size, size);
      const tex = toLinearTexture(THREE, cv);
      this._texCache.set(url, tex);
      while (this._texCache.size > maxCount) {
        const oldest = this._texCache.keys().next();
        if (oldest.done) break;
        const dead = this._texCache.get(oldest.value);
        this._texCache.delete(oldest.value);
        if (dead && dead.dispose) dead.dispose();
      }
      return tex;
    });
  }

  _applyCardTexture(tex) {
    const u = this.card.material.uniforms;
    u.uAtlas.value = tex;
    u.uUvOff.value.set(0, 0);
    u.uCellSize.value.set(1, 1);
  }

  /** 先 thumb 后 mid：thumb 36KB 几乎立刻可见，mid 到了再替换 */
  async _loadPhotoForCard(idx) {
    const photo = this.photoList[idx];
    if (!photo) return;
    const token = ++this._cardToken;
    try {
      const thumb = await this._tex(photo.thumb, 12, 320);
      if (token !== this._cardToken) return;
      this._applyCardTexture(thumb);
      const mid = await this._tex(photo.mid, 8, 1600);
      if (token !== this._cardToken) return;
      this._applyCardTexture(mid);
    } catch { /* 加载失败就保留上一张，不闪 */ }
  }

  // ---------------- 状态接口 ----------------

  setCardAmount(v) {
    const next = Math.max(0, Math.min(1, v));
    // 松手瞬间：之前是捏住的，现在松开了；手还在快速移动就甩出去
    if (this.cardTarget > 0.30 && next <= 0.08 &&
        this._handSpeed() >= this.ui.throwMinSpeed) {
      this._startThrow();
    }
    // 甩出途中又捏住 → 取消甩出，回到正常捏合
    if (this._throw && next > 0.15) this._throw = null;
    this.cardTarget = next;
  }

  /**
   * 甩出：松手时手在快速移动，卡片沿手势方向飞出去并自转淡出，
   * 比"松手就原地缩回"更像真的把照片甩开了。
   */
  _startThrow() {
    const { vx, vy } = this._handPt;
    const sp = Math.hypot(vx, vy) || 1;
    const tanHalf = this._tanHalf || Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const worldH = 2 * tanHalf * this.cardDist;
    const worldW = worldH * (this.camera.aspect || 1);
    const gain = this.ui.throwGain;

    // 手速限幅后再换算成世界速度：不限的话一次猛挥能让卡片瞬移到屏幕外几十个单位，
    // 看起来是"闪没了"而不是"甩出去"。
    const spEff = Math.min(this.ui.throwMaxSpeed, sp);
    const ux = vx / sp;
    const uy = vy / sp;

    this._throw = {
      t: 0,
      life: this.ui.throwLife,
      vx: ux * spEff * worldW * gain,
      vy: -uy * spEff * worldH * gain,   // 屏幕 y 向下，世界 y 向上
      vz: 0.45,                          // 略微朝相机，有"甩出手"的感觉
      spin: (vx >= 0 ? 1 : -1) * (1.4 + Math.min(2.2, spEff) * 0.75),
    };
    this.sfx?.swish();
  }

  /** 把因抽卡而隐去的缩略图挂回主体 */
  _restoreHiddenNode() {
    if (this._hiddenNode < 0) return;
    this._photoOnAttr.array[this._hiddenNode] = 1;
    this._photoOnAttr.needsUpdate = true;
    this._hiddenNode = -1;
    this._flyOn = false;
  }

  setExpand(v) { this.target = v; }

  /**
   * 手部移动驱动旋转：dx 为手掌「向右」的归一化位移，dy 为「向上」的位移。
   * 用位移喂角速度（拨动感），而不是把手的绝对位置映射成固定角度 ——
   * 手停住就停，手离开画面角速度自然衰减、俯仰弹簧回中。
   */
  addHandMove(dx, dy) {
    if (!isFinite(dx) || !isFinite(dy)) return;
    const ui = this.ui;
    // 抖动死区：真机关键点逐帧抖动约 0.002~0.008，不设死区会让主体自己慢慢晃
    if (Math.abs(dx) < ui.handDeadZone) dx = 0;
    if (Math.abs(dy) < ui.handDeadZone) dy = 0;
    const lim = ui.handMaxStep;
    dx = Math.max(-lim, Math.min(lim, dx));
    dy = Math.max(-lim, Math.min(lim, dy));

    this.handSpinY += dx * ui.handSpinGain;
    this.handPitchV -= dy * ui.handPitchGain;   // 手往上 → 顶部向后仰，看到更多顶面
    const vmax = ui.handMaxVel;
    this.handSpinY = Math.max(-vmax, Math.min(vmax, this.handSpinY));
    this.handPitchV = Math.max(-vmax, Math.min(vmax, this.handPitchV));
    this.steerActive = true;
  }

  /** 手离开画面：角速度立刻衰减，俯仰回中 */
  clearHandMove() {
    this.steerActive = false;
  }

  // ---------------- 尺寸与自适应 ----------------

  resize(w = window.innerWidth, h = window.innerHeight) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    const tanHalf = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    this._tanHalf = tanHalf;
    const px = h / (2 * tanHalf);
    this.pMat.uniforms.uPixelScale.value = px;
    this.phMat.uniforms.uPixelScale.value = px;

    // 卡片尺寸按「相机前方 cardDist 处的可见范围」算：刚捏住是小卡，捏紧后放大到能看清。
    // 竖屏时横向空间最宝贵，按短边放大，否则照片太小看不清。
    const c = this.ui.card;
    const worldH = 2 * tanHalf * this.cardDist;
    const worldW = worldH * this.camera.aspect;
    const narrow = this.camera.aspect < 1;
    this._cardMinScale = Math.min(worldW * c.minW, worldH * c.minH);
    this._cardMaxScale = narrow
      ? Math.min(worldW * c.maxWPortrait, worldH * c.maxHPortrait)
      : Math.min(worldW * c.maxW, worldH * c.maxH);
    this._cardRestX = worldW * (narrow ? c.restXPortrait : c.restXWide);
    this._cardRestY = worldH * c.restYW;
    // 起始尺寸 = 树上缩略图在屏幕上看起来的大小（按两个不同距离换算），
    // 这样第一帧和缩略图严丝合缝，视觉上就是「那颗缩略图被捏起来了」。
    this._cardStartScale = this.tier.photoPointSize * this.cardDist / this.baseCamZ;

    if (this.composer) this.composer.setSize(w, h);

    this._applyFit();
  }

  _applyFit() {
    const tanHalf = this._tanHalf;
    const camZ = this.baseCamZ + this.progress * this.theme.expandCamZ;
    const halfW = tanHalf * camZ * (this.camera?.aspect || 1);
    const halfH = tanHalf * camZ;
    const f = this.theme.fit;
    const needW = f.halfW[0] + (f.halfW[1] - f.halfW[0]) * this.progress;
    const needH = f.halfH[0] + (f.halfH[1] - f.halfH[0]) * this.progress;
    const fit = Math.max(0.3, Math.min(1, halfW / needW, halfH / needH));
    this.fitScale = fit;
    this.group.scale.setScalar(fit * (this.pulseMul || 1));
  }

  /**
   * 脉动：整数缩放 + 亮度同相位调制。
   * 展开状态下（星云）按 expandDamp 衰减 —— 星云整体缩放会让人晕。
   */
  _updatePulse(dt) {
    const cfg = this.pulseCfg;
    if (!cfg?.enabled) { this.pulseMul = 1; return; }
    const period = cfg.period || 1.05;
    const env = doubleBeat(this.time / period);
    const damp = 1 - this.progress * (cfg.expandDamp ?? 0.65);
    this.pulseEnv = env;
    this.pulseMul = 1 + env * (cfg.scale || 0) * damp;
    if (this.pMat && cfg.brightness) {
      this.pMat.uniforms.uAlpha.value = this._elemAlphaBase * (1 + env * cfg.brightness * damp);
    }
  }

  // ---------------- 每帧 ----------------

  update(dt) {
    const ui = this.ui;
    const th = this.theme;

    this.time += dt;
    this.progress += (this.target - this.progress) * Math.min(1, dt * ui.expandLerp);
    this.pMat.uniforms.uProgress.value = this.progress;
    this.pMat.uniforms.uTime.value = this.time;
    this.phMat.uniforms.uProgress.value = this.progress;

    // ---- 手部操控：位移喂角速度 → 自转 + 俯仰，手停下就停、手离开自动回中 ----
    const decay = Math.exp(-dt * ui.handSpinDecay);
    this.handSpinY *= decay;
    this.handPitchV *= decay;
    if (!this.steerActive) { this.handSpinY *= 0.35; this.handPitchV *= 0.35; }
    this.steerActive = false;

    const spinScale = 1.0 + (1 - this.progress) * ui.spinIdleBoost;
    this.spinAngle += (ui.spin * spinScale * 60 + this.handSpinY) * dt;
    this.pitchAngle += this.handPitchV * dt;
    this.pitchAngle *= Math.exp(-dt * ui.handPitchSpring);        // 弹簧回中
    this.pitchAngle = Math.max(-ui.pitchLimit, Math.min(ui.pitchLimit, this.pitchAngle));

    this.group.rotation.y = this.spinAngle;
    this.rig.rotation.x = this.pitchAngle;

    this.camera.position.z = this.baseCamZ + this.progress * th.expandCamZ;
    this.camera.lookAt(th.camera.lookAt[0], th.camera.lookAt[1], th.camera.lookAt[2]);

    // ---- 整体脉动：缩放 + 亮度一起呼吸 ----
    // 只缩放会让画面像「镜头推进」，配上同相位的亮度才像「这颗心在跳」。
    this._updatePulse(dt);

    this._applyFit();

    // 氛围光：跟着自适应缩放，展开时变大变淡，并随心跳微微呼吸
    if (this.auraLayers) {
      const cfg = this.theme.aura;
      const grow = 1 + this.progress * (cfg.expandGrow ?? 0.6);
      const pulseK = 1 + (this.pulseEnv || 0) * (cfg.pulse ?? 0.08);
      const fade = 1 - this.progress * (cfg.expandFade ?? 0.5);
      for (const l of this.auraLayers) {
        l.sprite.scale.setScalar(l.size * this.fitScale * grow * pulseK);
        l.sprite.material.opacity = l.opacity * fade * (0.86 + 0.14 * pulseK);
      }
    }

    // 顶部装饰：轻微脉动，展开时淡一点但保留
    if (this.decorationSprite) {
      const dec = this.preset.decoration;
      const pulse = 1 + Math.sin(this.time * 2.2) * (dec.pulse || 0);
      this.decorationSprite.scale.setScalar(dec.size * pulse * (1 - this.progress * 0.12));
      this.decorationSprite.material.opacity = dec.opacity - this.progress * (dec.expandFade || 0);
    }

    // 雪花下落，出界回到顶部
    if (this.ambient) {
      const p = this.ambient.geometry.attributes.position;
      const spd = this.ambient.userData.spd;
      const span = this.ambient.userData.span;
      const arr = p.array;
      for (let i = 0; i < spd.length; i++) {
        arr[i * 3 + 1] -= spd[i] * dt;
        if (arr[i * 3 + 1] < -span / 2) arr[i * 3 + 1] += span;
      }
      p.needsUpdate = true;
    }

    // ---- 照片卡片 ----
    this._cardZ = this.camera.position.z - this.cardDist;

    if (this._throw) {
      // 甩出中：位置/自转按初速积分，0.4 秒左右淡出到消失
      const th = this._throw;
      th.t += dt;
      const k = Math.min(1, th.t / th.life);
      if (k >= 1) {
        this._throw = null;
        this.cardAmount = 0;
        this.cardTarget = 0;
        this.card.visible = false;
        this.card.material.uniforms.uOpacity.value = 0;
        this._restoreHiddenNode();
      } else {
        this.card.visible = true;
        this.card.position.x += th.vx * dt;
        this.card.position.y += th.vy * dt;
        this.card.position.z += th.vz * dt;
        this.card.rotation.z += th.spin * dt;
        this.card.scale.multiplyScalar(1 + dt * 0.9);
        // 慢起快落：前半程还看得清，后半程迅速消失，像飞出了视野
        this.card.material.uniforms.uOpacity.value = 1 - k * k;
      }
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
      return;
    }

    this.cardAmount += (this.cardTarget - this.cardAmount) * Math.min(1, dt * 9.0);

    const amount = Math.max(0, Math.min(1, this.cardAmount));
    // 放大比位移更早启动：先原地长大，长到一定规模再滑向静止位
    const easeS = Math.pow(amount, ui.card.growExp);
    const easeP = Math.pow(amount, ui.card.moveExp);

    const restX = this._cardRestX;
    const restY = this._cardRestY;
    if (this._flyOn) {
      this.card.position.set(
        this._flyFrom.x + (restX - this._flyFrom.x) * easeP,
        this._flyFrom.y + (restY - this._flyFrom.y) * easeP,
        this._cardZ,
      );
    } else {
      this.card.position.set(restX, restY, this._cardZ);
    }

    // 尺寸：从缩略图大小 → 小卡 → 大卡（连续，捏得越紧越大）
    const start = this._cardStartScale || this._cardMinScale * 0.42;
    this.card.scale.setScalar(start + (this._cardMaxScale - start) * easeS);

    // 姿态：开始时带着它在主体上挂着的倾斜角，放大过程中摆正
    const settle = Math.min(1, amount * 1.25);
    const baseX = 0.075 + Math.sin(this.time * 0.9) * 0.012 * amount;
    const baseY = -0.16 + Math.sin(this.time * 0.7) * 0.02 * amount;
    const baseZ = 0.02 + Math.sin(this.time * 1.1) * 0.01 * amount;
    if (this._flyOn) {
      const inv = 1 - settle;
      this.card.rotation.set(
        this._flyRot.x * inv + baseX * settle,
        this._flyRot.y * inv + baseY * settle,
        this._flyRot.z * inv + baseZ * settle,
      );
    } else {
      this.card.rotation.set(baseX, baseY, baseZ);
    }

    if (amount < 0.008) {
      this.card.visible = false;
      this.card.material.uniforms.uOpacity.value = 0;
      this._restoreHiddenNode();   // 卡片收起 → 被隐去的缩略图重新挂回去
    } else {
      this.card.visible = true;
      this.card.material.uniforms.uOpacity.value =
        Math.min(1, ui.card.opacityBase + amount * ui.card.opacityGain);
    }

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

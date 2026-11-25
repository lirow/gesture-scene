// ---------------- 音效（引擎层，WebAudio 现场合成） ----------------
// 不依赖任何音频素材：全部用振荡器 + 噪声 + 包络合成，避免多几个 MP3 拖大首屏。
//
// 浏览器自动播放策略：AudioContext 必须在**用户手势**之后才能出声，
// 所以调用方要在一次 click / keydown 里 unlock()，否则一直静音。

export class Sfx {
  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    this.volume = opts.volume ?? 0.22;
    this.ctx = null;
    this.master = null;
    this._noise = null;
  }

  /** 已经能出声了吗 */
  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** 必须在一次用户交互里调用（浏览器策略），重复调用安全 */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
    if (this.enabled) this.unlock();
    return this.enabled;
  }

  _noiseBuffer() {
    if (this._noise) return this._noise;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  /** 正弦音，可做扫频。指数包络，短促不刺耳。 */
  _tone({ f0, f1 = f0, type = 'sine', dur = 0.35, peak = 0.3, delay = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** 噪声带通扫频，做"呼/咻"这类气声 */
  _noiseSweep({ f0, f1, q = 1.2, dur = 0.3, peak = 0.16, delay = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  /** 抽到一张：清亮的泛音，像铃 */
  chime() {
    this._tone({ f0: 880, dur: 0.42, peak: 0.28 });
    this._tone({ f0: 1320, dur: 0.36, peak: 0.15, delay: 0.02 });
    this._tone({ f0: 1760, dur: 0.30, peak: 0.07, delay: 0.04 });
  }

  /** 展开(1) / 收拢(-1) */
  whoosh(dir = 1) {
    if (dir > 0) this._noiseSweep({ f0: 220, f1: 1500, q: 0.9, dur: 0.45, peak: 0.15 });
    else this._noiseSweep({ f0: 1300, f1: 170, q: 0.9, dur: 0.40, peak: 0.13 });
  }

  /** 甩出：短促的"咻" */
  swish() {
    this._noiseSweep({ f0: 1700, f1: 300, q: 2.4, dur: 0.22, peak: 0.20 });
  }
}

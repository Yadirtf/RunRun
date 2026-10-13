/**
 * Audio con Web Audio API, sin archivos: el sonido de motor es un buffer
 * sintetizado (armónicos de un 4 tiempos) en bucle cuyo playbackRate sigue a
 * las RPM con cambios de marcha simulados; derrape = ruido filtrado; los
 * coches remotos usan PannerNode para atenuarse con la distancia.
 */
const GEARS = [0, 45, 80, 115, 150, 185, 999];

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.remote = new Map();
  }

  /** Debe llamarse tras un gesto del usuario (política de autoplay). */
  async start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);
    this.engineBuffer = this.makeEngineBuffer();
    this.noiseBuffer = this.makeNoiseBuffer();
    this.local = this.createEngineVoice(this.master, 0.5);

    const screechFilter = this.ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1800;
    screechFilter.Q.value = 3;
    this.screechGain = this.ctx.createGain();
    this.screechGain.gain.value = 0;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    noise.connect(screechFilter).connect(this.screechGain).connect(this.master);
    noise.start();
    this.screechSrc = noise;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  makeEngineBuffer() {
    const sr = this.ctx.sampleRate;
    const base = 55; // Hz a playbackRate = 1
    const len = Math.round(sr / base) * 40;
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const harmonics = [[1, 1], [2, 0.6], [3, 0.35], [4, 0.25], [6, 0.12], [0.5, 0.5]];
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let v = 0;
      for (const [h, a] of harmonics) v += Math.sin(2 * Math.PI * base * h * t) * a;
      // Pulsos de combustión para dar "grano".
      v *= 0.75 + 0.25 * Math.sin(2 * Math.PI * base * 0.5 * t) ** 2;
      d[i] = Math.tanh(v * 0.6) * 0.8;
    }
    return buf;
  }

  makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  createEngineVoice(destination, volume) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.engineBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = this.ctx.createGain();
    gain.gain.value = volume * 0.4;
    src.connect(filter).connect(gain).connect(destination);
    src.start();
    return { src, filter, gain, volume };
  }

  /** Marcha engranada (1..6) para una velocidad, con la misma tabla que el sonido. */
  static gearFor(speedKmh) {
    let g = 1;
    while (speedKmh > GEARS[g] && g < GEARS.length - 1) g++;
    return g;
  }

  static rpmFor(speedKmh) {
    let g = 1;
    while (speedKmh > GEARS[g] && g < GEARS.length - 1) g++;
    const lo = GEARS[g - 1];
    const hi = Math.min(GEARS[g], 215);
    const t = Math.min(1, Math.max(0, (speedKmh - lo) / (hi - lo)));
    return 0.18 + t * 0.82 - (g > 1 ? 0.1 * (1 - t) : 0);
  }

  updateVoice(voice, speedKmh, throttle) {
    const rpm = AudioManager.rpmFor(speedKmh);
    const now = this.ctx.currentTime;
    voice.src.playbackRate.setTargetAtTime(0.8 + rpm * 2.6, now, 0.05);
    voice.filter.frequency.setTargetAtTime(600 + rpm * 2600 + throttle * 800, now, 0.08);
    voice.gain.gain.setTargetAtTime(voice.volume * (0.3 + throttle * 0.35 + rpm * 0.35), now, 0.08);
  }

  update({ speedKmh, throttle, slip, listener, remotes }) {
    if (!this.ctx) return;
    this.updateVoice(this.local, speedKmh, throttle);
    this.screechGain.gain.setTargetAtTime(slip * 0.35, this.ctx.currentTime, 0.05);
    if (listener) {
      const l = this.ctx.listener;
      const { position: p, forward: f } = listener;
      if (l.positionX) {
        l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
        l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
        l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
      } else {
        l.setPosition(p.x, p.y, p.z);
        l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
      }
    }
    for (const r of remotes ?? []) {
      let v = this.remote.get(r.id);
      if (!v) {
        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 6;
        panner.rolloffFactor = 1.4;
        panner.connect(this.master);
        v = { panner, voice: this.createEngineVoice(panner, 0.45) };
        this.remote.set(r.id, v);
      }
      v.panner.positionX.value = r.position.x;
      v.panner.positionY.value = r.position.y;
      v.panner.positionZ.value = r.position.z;
      this.updateVoice(v.voice, r.speed, 0.6);
    }
  }

  removeRemote(id) {
    const v = this.remote.get(id);
    if (!v) return;
    v.voice.src.stop();
    v.panner.disconnect();
    this.remote.delete(id);
  }

  beep(freq = 440, duration = 0.18, volume = 0.3) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration);
  }

  impact(strength) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.8, strength), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.3);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  dispose() {
    if (!this.ctx) return;
    this.ctx.close();
    this.ctx = null;
    this.remote.clear();
  }
}

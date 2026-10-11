// Audio sintetizado con Web Audio (sin archivos de sonido): motor según RPM y carga,
// chirrido de neumáticos, golpes y pitidos de salida. Los coches remotos usan audio 3D.

let ctx = null;
let master = null;
let noiseBuffer = null;

export function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

/** Debe llamarse desde un gesto del usuario (clic) para que el navegador permita sonar. */
export function unlockAudio() {
  const c = audioContext();
  if (c && c.state === 'suspended') c.resume();
}

export function setMuted(muted) {
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.05);
}

function distortionCurve(amount) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

export class CarSound {
  /** @param {{spatial?: boolean, volume?: number}} opts */
  constructor({ spatial = false, volume = 1 } = {}) {
    const c = audioContext();
    this.ok = !!c;
    if (!c) return;
    this.out = c.createGain();
    this.out.gain.value = 0;
    if (spatial) {
      this.panner = c.createPanner();
      this.panner.panningModel = 'HRTF';
      this.panner.distanceModel = 'inverse';
      this.panner.refDistance = 6;
      this.panner.rolloffFactor = 1.3;
      this.panner.maxDistance = 400;
      this.out.connect(this.panner).connect(master);
    } else {
      this.out.connect(master);
    }
    this.volume = volume;

    // Motor: dos osciladores + distorsión + filtro paso bajo.
    this.osc1 = c.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = c.createOscillator(); this.osc2.type = 'square';
    this.osc3 = c.createOscillator(); this.osc3.type = 'triangle';
    const g1 = c.createGain(); g1.gain.value = 0.35;
    const g2 = c.createGain(); g2.gain.value = 0.18;
    const g3 = c.createGain(); g3.gain.value = 0.3;
    this.shaper = c.createWaveShaper(); this.shaper.curve = distortionCurve(30); this.shaper.oversample = '2x';
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = 2.5;
    this.engineGain = c.createGain(); this.engineGain.gain.value = 0.3;
    this.osc1.connect(g1).connect(this.shaper);
    this.osc2.connect(g2).connect(this.shaper);
    this.osc3.connect(g3).connect(this.shaper);
    this.shaper.connect(this.filter).connect(this.engineGain).connect(this.out);

    // Neumáticos: ruido filtrado.
    this.noise = c.createBufferSource();
    this.noise.buffer = noiseBuffer;
    this.noise.loop = true;
    this.tireFilter = c.createBiquadFilter(); this.tireFilter.type = 'bandpass'; this.tireFilter.frequency.value = 1800; this.tireFilter.Q.value = 6;
    this.tireGain = c.createGain(); this.tireGain.gain.value = 0;
    this.noise.connect(this.tireFilter).connect(this.tireGain).connect(this.out);

    // Viento/rodadura a alta velocidad.
    this.wind = c.createBufferSource();
    this.wind.buffer = noiseBuffer; this.wind.loop = true; this.wind.playbackRate.value = 0.5;
    this.windFilter = c.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 500;
    this.windGain = c.createGain(); this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.out);

    const t = c.currentTime;
    for (const node of [this.osc1, this.osc2, this.osc3, this.noise, this.wind]) node.start(t);
    this.out.gain.setTargetAtTime(volume, t, 0.3);
  }

  /** rpm, carga 0..1, derrape 0..1, velocidad m/s */
  update(rpm, load, slip, speed) {
    if (!this.ok) return;
    const t = ctx.currentTime;
    const f = (rpm / 60) * 4; // V8: 4 explosiones por vuelta
    this.osc1.frequency.setTargetAtTime(f, t, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.osc3.frequency.setTargetAtTime(f * 2.01, t, 0.03);
    this.filter.frequency.setTargetAtTime(500 + load * 2200 + rpm * 0.25, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.16 + load * 0.22, t, 0.05);
    this.tireGain.gain.setTargetAtTime(Math.min(slip, 1) * 0.35, t, 0.04);
    this.tireFilter.frequency.setTargetAtTime(1400 + Math.min(Math.abs(speed), 60) * 12, t, 0.1);
    const w = Math.min(Math.abs(speed) / 80, 1);
    this.windGain.gain.setTargetAtTime(w * w * 0.25, t, 0.2);
  }

  setPosition(x, y, z) {
    if (!this.panner) return;
    const t = ctx.currentTime;
    this.panner.positionX.setTargetAtTime(x, t, 0.05);
    this.panner.positionY.setTargetAtTime(y, t, 0.05);
    this.panner.positionZ.setTargetAtTime(z, t, 0.05);
  }

  impact(strength) {
    if (!this.ok || strength < 0.1) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(strength, 1) * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }

  dispose() {
    if (!this.ok) return;
    const t = ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.1);
    const nodes = [this.osc1, this.osc2, this.osc3, this.noise, this.wind];
    setTimeout(() => { nodes.forEach((n) => { try { n.stop(); } catch { /* ya parado */ } }); this.out.disconnect(); }, 400);
  }
}

/** Pitido corto (semáforo de salida). */
export function beep(freq = 660, duration = 0.18, volume = 0.3) {
  const c = audioContext();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + duration + 0.05);
}

/** Coloca al oyente donde está la cámara. */
export function updateListener(camera) {
  if (!ctx) return;
  const l = ctx.listener;
  const p = camera.position;
  const fwd = camera.getWorldDirection(camera.userData._dir ??= camera.position.clone());
  const t = ctx.currentTime;
  if (l.positionX) {
    l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
    l.forwardX.setTargetAtTime(fwd.x, t, 0.02); l.forwardY.setTargetAtTime(fwd.y, t, 0.02); l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    l.setPosition(p.x, p.y, p.z);
    l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
  }
}

// Orquestador de una carrera: escena, física, coche local, coches remotos, cámara,
// efectos, audio, vueltas y envío de estado por red.
import * as THREE from 'three';
import { getCar, getTrackLayout, LapTracker, NET_SEND_HZ } from '@ranran/shared';
import { assets } from './Assets.js';
import { initRapier, PhysicsWorld, FIXED_DT } from './Physics.js';
import { buildTrack } from './TrackBuilder.js';
import { createCarVisual } from './CarModel.js';
import { Vehicle, createCarState } from './Vehicle.js';
import { RemoteCar } from './RemoteCar.js';
import { CameraRig } from './CameraRig.js';
import { Input } from './Input.js';
import { Effects } from './Effects.js';
import { CornerGuide } from './CornerGuide.js';
import { CarSound, beep, updateListener, setMuted } from './Audio.js';

const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 0 },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024 },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048 },
};

export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {string} opts.trackId
   * @param {number} opts.laps
   * @param {{id:string, carId:string, color:string, nickname:string}} opts.local
   * @param {Array<{id:string, carId:string, color:string, nickname:string}>} opts.others
   * @param {Array<{id:string, x:number, z:number, yaw:number}>} opts.grid
   * @param {number} opts.goAt  instante de salida en reloj del servidor
   * @param {{serverNow:()=>number, sendState:(s:object)=>void}|null} opts.net
   * @param {'low'|'medium'|'high'} opts.quality
   * @param {(hud:object)=>void} opts.onHud
   * @param {(ev:object)=>void} opts.onEvent
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts;
    this.layout = getTrackLayout(opts.trackId);
    this.quality = QUALITY[opts.quality] ?? QUALITY.high;
    this.remotes = new Map();
    this.standings = new Map(); // id -> {pos, lap, fin}
    this.running = false;
    this.muted = false;
    this.lastSend = 0;
    this.lastHud = 0;
    this.accumulator = 0;
    this.lightsShown = -1;
    this.raceStarted = false;
    this.finished = false;
    this.resetCooldown = 0;
    this.state = createCarState();
    this.spectating = !opts.grid.some((g) => g.id === opts.local.id);
    this.lastLapTime = null;
  }

  serverNow() { return this.opts.net ? this.opts.net.serverNow() : Date.now(); }

  async init(onProgress = () => {}) {
    const off = assets.onProgress(onProgress);
    try {
      await initRapier();
      const carUrls = [...new Set([this.opts.local, ...this.opts.others].map((p) => getCar(p.carId).model.url))];
      await assets.preload(carUrls);

      // ---------- Render ----------
      const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 0.95;
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.shadowMap.enabled = this.quality.shadows;
      r.shadowMap.type = THREE.PCFShadowMap;
      this.renderer = r;

      const scene = new THREE.Scene();
      this.scene = scene;
      const [hdr, bg] = await Promise.all([assets.skyHdr(), assets.skyBackground()]);
      const pmrem = new THREE.PMREMGenerator(r);
      this.envMap = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      scene.environment = this.envMap;
      scene.environmentIntensity = 0.9;
      scene.background = bg;
      scene.backgroundIntensity = 1;
      scene.fog = new THREE.Fog(0xc4d2de, 450, 2600);

      this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);
      this.cameraRig = new CameraRig(this.camera);

      const sunDir = new THREE.Vector3(...(this.layout.data.env?.sun ?? [0.5, 0.6, 0.3])).normalize();
      this.sunDir = sunDir;
      const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
      sun.castShadow = this.quality.shadows;
      if (sun.castShadow) {
        sun.shadow.mapSize.set(this.quality.shadowMap, this.quality.shadowMap);
        const c = sun.shadow.camera;
        c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 1; c.far = 400;
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.03;
      }
      scene.add(sun, sun.target);
      this.sun = sun;
      scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4b5a2f, 0.35));

      // ---------- Física y pista ----------
      this.physics = new PhysicsWorld();
      this.track = await buildTrack(this.layout, this.physics, { quality: this.opts.quality });
      scene.add(this.track.group);
      // Velocidad recomendada según el agarre del coche propio (un poco conservadora).
      const myPhys = getCar(this.opts.local.carId).physics;
      this.cornerGuide = new CornerGuide(this.layout, 0.85 * myPhys.frictionSlip * Math.min(1, myPhys.rearGripScale));
      this.markerDisposables = [];
      this.cornerGuide.buildMarkers(this.track.group, (o) => { this.markerDisposables.push(o); return o; });
      this.effects = new Effects(scene);

      // ---------- Coche local ----------
      const mySlot = this.opts.grid.find((g) => g.id === this.opts.local.id) ?? this.opts.grid[0] ?? this.layout.gridSlots(1)[0];
      if (!this.spectating) {
        const def = getCar(this.opts.local.carId);
        this.visual = await createCarVisual(def, this.opts.local.color, { shadows: this.quality.shadows });
        scene.add(this.visual.root);
        const dims = {
          bounds: this.visual.bounds,
          wheels: this.visual.wheels.map((w) => ({ x: w.center.x, y: w.center.y, z: w.center.z, radius: w.radius })),
        };
        this.vehicle = new Vehicle(this.physics, def, dims, mySlot);
        this.vehicle.setFrozen(true);
        this.tracker = new LapTracker(this.layout, this.opts.laps);
        this.tracker.place(mySlot.x, mySlot.z, 0);
        this.sound = new CarSound({ volume: 0.9 });
      }

      // ---------- Rivales ----------
      await Promise.all(this.opts.others.map((p) => this.addRemote(p)));
      for (const g of this.opts.grid) {
        const rc = this.remotes.get(g.id);
        if (rc) {
          // Pose inicial en parrilla hasta que lleguen instantáneas.
          const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, g.yaw);
          rc.push({ ts: 1, p: [g.x, 0.05, g.z], q: [q.x, q.y, q.z, q.w], v: 0 });
        }
      }

      // ---------- Entrada ----------
      this.input = new Input();
      this.input.on('camera', () => this.cameraRig.cycle());
      this.input.on('reset', () => this.resetToTrack());
      this.input.on('mute', () => { this.muted = !this.muted; setMuted(this.muted); });

      this.onResize = () => this.resize();
      window.addEventListener('resize', this.onResize);
      this.resize();
      this.updateVisuals(0);
      r.compile(scene, this.camera);
    } finally {
      off();
    }
  }

  async addRemote(player) {
    if (player.id === this.opts.local.id || this.remotes.has(player.id)) return;
    const rc = await RemoteCar.create(this.physics, this.scene, player);
    if (this.disposed) { rc.dispose(); return; }
    this.remotes.set(player.id, rc);
  }

  removeRemote(id) {
    const rc = this.remotes.get(id);
    if (rc) { rc.dispose(); this.remotes.delete(id); }
  }

  /** Instantánea del servidor: posiciones de todos los coches y clasificación. */
  applySnapshot(snap) {
    for (const car of snap.cars) {
      this.standings.set(car.id, { pos: car.pos, lap: car.lap, fin: car.fin });
      if (car.id !== this.opts.local.id) this.remotes.get(car.id)?.push(car);
    }
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    // En práctica la cuenta atrás empieza cuando todo está cargado.
    if (!this.opts.net) this.opts.goAt = Date.now() + 4000;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min((t - this.lastFrame) / 1000, 0.1);
      this.lastFrame = t;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  resetToTrack() {
    if (!this.vehicle || this.resetCooldown > 0 || !this.raceStarted) return;
    const t = this.vehicle.body.translation();
    const p = this.layout.project(t.x, t.z, this.tracker?.hint ?? -1);
    const s = this.layout.sampleAt(p.s);
    this.vehicle.teleport(s.x, s.z, Math.atan2(s.tx, s.tz));
    this.resetCooldown = 2;
    this.opts.onEvent?.({ type: 'reset' });
  }

  frame(dt) {
    const now = this.serverNow();
    const raceTime = now - this.opts.goAt;
    this.updateStartLights(raceTime);

    if (!this.raceStarted && raceTime >= 0) {
      this.raceStarted = true;
      this.vehicle?.setFrozen(false);
      this.opts.onEvent?.({ type: 'go' });
    }
    if (this.resetCooldown > 0) this.resetCooldown -= dt;

    // ---------- Física a paso fijo ----------
    const input = this.input.read(dt);
    if (this.finished) { input.throttle = Math.min(input.throttle, 0.3); }
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 5) {
      if (this.vehicle) {
        const t = this.vehicle.body.translation();
        const proj = this.layout.project(t.x, t.z, this.tracker.hint);
        this.vehicle.setSurface(this.layout.surfaceAt(proj.lateral));
        this.vehicle.update(input);
      }
      for (const rc of this.remotes.values()) rc.syncBody();
      this.physics.step();
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === 5) this.accumulator = 0;

    // ---------- Vueltas (cliente: respuesta inmediata en el HUD) ----------
    if (this.vehicle) {
      this.vehicle.readState(this.state);
      if (this.raceStarted && !this.finished) {
        for (const ev of this.tracker.update(this.state.position.x, this.state.position.z, raceTime)) {
          if (ev.type === 'lap') { this.lastLapTime = ev.lapTime; this.opts.onEvent?.({ type: 'lap', ...ev }); }
          if (ev.type === 'finish') { this.finished = true; this.opts.onEvent?.({ type: 'finish', time: ev.time }); }
        }
      }
      if (this.raceStarted && (this.vehicle.upsideDownTime > 2.5 || this.state.position.y < -5)) this.resetToTrack();
      if (this.vehicle.impact > 0.15) this.sound?.impact(this.vehicle.impact);
    }

    for (const rc of this.remotes.values()) rc.update(now, dt);
    this.updateVisuals(dt);

    // ---------- Red ----------
    if (this.vehicle && this.opts.net && now - this.lastSend >= 1000 / NET_SEND_HZ) {
      this.lastSend = now;
      const s = this.state;
      const r2 = (v) => Math.round(v * 100) / 100;
      const r3 = (v) => Math.round(v * 1000) / 1000;
      this.opts.net.sendState({
        t: Math.round(raceTime),
        p: [r2(s.position.x), r2(s.position.y), r2(s.position.z)],
        q: [r3(s.quaternion.x), r3(s.quaternion.y), r3(s.quaternion.z), r3(s.quaternion.w)],
        v: r2(s.speed),
        st: r2(s.steer),
        r: Math.round(s.rpm),
        g: s.gear,
        b: s.braking ? 1 : 0,
        sl: r2(s.slip),
      });
    }

    // ---------- HUD ----------
    if (now - this.lastHud > 66) {
      this.lastHud = now;
      this.opts.onHud?.(this.hudState(raceTime));
    }

    this.renderer.render(this.scene, this.camera);
  }

  updateVisuals(dt) {
    let focus = null;
    if (this.vehicle) {
      const s = this.state;
      this.visual.root.position.copy(s.position);
      this.visual.root.quaternion.copy(s.quaternion);
      this.visual.setWheels(s.wheelSteer, s.wheelSpin.map((a) => -a));
      this.visual.wheels.forEach((w, i) => { if (w) w.steer.position.y = s.wheelY[i]; });
      this.visual.setBraking(s.braking);
      focus = s;

      // Marcas y humo por rueda
      const onAsphalt = this.vehicle.surface !== 'grass';
      const c = this.vehicle.controller;
      for (let i = 2; i < 4; i++) {
        if (!c.wheelIsInContact(i)) continue;
        const cp = c.wheelContactPoint(i);
        if (cp) this.effects.wheel(`me${i}`, new THREE.Vector3(cp.x, cp.y, cp.z), s.slip, onAsphalt, dt);
      }
      const load = this.raceStarted ? Math.max(this.input.state.throttle, 0) : this.input.state.throttle;
      this.sound?.update(s.rpm, load, s.slip, s.speed);
    } else {
      // Espectador: sigue al primero de la clasificación.
      const leader = [...this.remotes.values()].sort((a, b) => (this.standings.get(a.id)?.pos ?? 99) - (this.standings.get(b.id)?.pos ?? 99))[0];
      if (leader?.hasPose) focus = { position: leader.position, quaternion: leader.quaternion, speed: leader.speed };
    }
    for (const rc of this.remotes.values()) {
      if (rc.hasPose && rc.slip > 0.3) {
        const fwd = new THREE.Vector3(0, 0, -1.3).applyQuaternion(rc.quaternion).add(rc.position);
        this.effects.wheel(`r${rc.id}`, fwd, rc.slip, true, dt);
      }
    }
    this.effects.update(dt);

    if (focus) {
      this.cameraRig.update(dt, focus, this.vehicle?.impact ?? 0);
      // La sombra sigue al coche para tener resolución donde importa.
      this.sun.position.copy(focus.position).addScaledVector(this.sunDir, 150);
      this.sun.target.position.copy(focus.position);
    } else {
      const s = this.layout.sampleAt(0);
      this.cameraRig.orbit(new THREE.Vector3(s.x, 0, s.z), performance.now() / 1000, 30, 12);
    }
    updateListener(this.camera);
  }

  updateStartLights(raceTime) {
    const lights = this.track.startLights;
    // 5 luces se encienden cada 0,7 s y se apagan todas a la salida.
    let on = 0;
    if (raceTime < 0) on = Math.max(0, Math.min(5, Math.floor((raceTime + 3500) / 700) + 1));
    if (raceTime < -3500) on = 0;
    if (on !== this.lightsShown) {
      lights.forEach((m, i) => { m.emissiveIntensity = i < on ? 6 : 0; });
      if (on > this.lightsShown && on > 0) beep(520, 0.2, 0.25);
      if (on === 0 && this.lightsShown === 5) beep(1040, 0.5, 0.35);
      this.lightsShown = on;
    }
  }

  hudState(raceTime) {
    const s = this.state;
    const tr = this.tracker;
    const me = this.standings.get(this.opts.local.id);
    let position = me?.pos ?? 1;
    const total = Math.max(1 + this.remotes.size, this.standings.size || 1);
    if (!this.opts.net) position = 1;
    return {
      spectating: this.spectating,
      countdown: raceTime < 0 ? Math.ceil(-raceTime / 1000) : 0,
      raceTime: Math.max(raceTime, 0),
      speedKmh: Math.abs(s.speed) * 3.6,
      rpm: s.rpm,
      redline: this.vehicle?.p.redline ?? 8000,
      gear: s.gear,
      lap: tr ? tr.currentLap : 0,
      laps: this.opts.laps,
      lapTime: tr && this.raceStarted && !tr.finished ? raceTime - tr.lapStart : null,
      lastLap: this.lastLapTime,
      bestLap: tr?.bestLap ?? null,
      position,
      total,
      wrongWay: (tr?.wrongWay ?? 0) > 1.2,
      offTrack: this.vehicle?.surface === 'grass',
      finished: this.finished,
      cameraMode: this.cameraRig.modeName,
      corner: this.vehicle && !this.finished ? this.cornerGuide.next(this.layout.project(s.position.x, s.position.z, tr.hint).s, s.speed) : null,
      muted: this.muted,
    };
  }

  /** Posiciones para el minimapa. */
  mapCars() {
    const out = [];
    for (const rc of this.remotes.values()) {
      if (rc.hasPose) out.push({ id: rc.id, x: rc.position.x, z: rc.position.z, color: rc.player.color, me: false });
    }
    if (this.vehicle) out.push({ id: this.opts.local.id, x: this.state.position.x, z: this.state.position.z, color: this.opts.local.color, me: true });
    return out;
  }

  /** Controles táctiles (pantallas móviles). */
  setTouch(partial) { Object.assign(this.input.touch, partial); }

  dispose() {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input?.dispose();
    this.sound?.dispose();
    for (const rc of this.remotes.values()) rc.dispose();
    this.remotes.clear();
    this.effects?.dispose();
    this.vehicle?.dispose();
    this.visual?.dispose();
    this.markerDisposables?.forEach((o) => o.dispose?.());
    this.track?.dispose();
    this.physics?.dispose();
    this.envMap?.dispose();
    this.renderer?.dispose();
  }
}

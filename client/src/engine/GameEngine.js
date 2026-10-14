import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { getTrack } from '@runrun/shared/tracks';
import { getCar } from '@runrun/shared/cars';
import { buildTrackPath, projectToTrack, gridSlot, forwardDistance } from '@runrun/shared/trackPath';
import { encodeTransform, TRANSFORM_HZ, COUNTDOWN_MS } from '@runrun/shared/protocol';
import { SceneSetup } from './SceneSetup.js';
import { TrackLoader } from './TrackLoader.js';
import { Landscape } from './environment/Landscape.js';
import { getTheme } from './environment/themes.js';
import { VehicleController } from './VehicleController.js';
import { createCar, poseWheels, disposeCar } from './CarFactory.js';
import { RemotePlayer } from './RemotePlayer.js';
import { ChaseCamera } from './ChaseCamera.js';
import { InputController } from './InputController.js';
import { CheckpointSystem } from './CheckpointSystem.js';
import { ParticleSystem } from './ParticleSystem.js';
import { AudioManager } from './AudioManager.js';
import { disposeTextures } from './textures.js';
import { qualityPreset } from './quality.js';
import { PowerupSystem, applyHitAnim } from './powerups/PowerupSystem.js';
import { WRECK_MS } from '@runrun/shared/powerups';

const STEP = 1 / 60;
const HUD_INTERVAL = 1 / 15;


let rapierReady = null;
function initRapier() {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

/**
 * Orquestador del juego en carrera. Conecta físicas, render, entrada, audio y
 * red sin conocer Socket.io ni React: recibe un puerto de red (`net`) y
 * publica telemetría para el HUD mediante `onHud`.
 *
 * @typedef {{ sendTransform(buf: ArrayBuffer): void, sendCheckpoint(id: number): void,
 *   pickupPowerup?(pad: number): void, firePowerup?(shot: object): void }} NetPort
 */
export class GameEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {string} opts.trackId
   * @param {string} opts.myId
   * @param {Array} opts.players jugadores de la sala ({id, nickname, carModel, color, slot})
   * @param {number|null} opts.startTime hora de salida en reloj de servidor (ms); null = esperando al resto
   * @param {() => number} opts.serverNow reloj de servidor estimado
   * @param {NetPort} opts.net
   * @param {(hud: object) => void} opts.onHud
   * @param {(p: {progress: number, label: string}) => void} [opts.onProgress]
   * @param {(event: object) => void} [opts.onEvent]
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts;
    this.trackDef = getTrack(opts.trackId);
    this.theme = getTheme(this.trackDef.theme);
    this.remotes = new Map();
    this.standings = new Map();
    this.running = false;
    this.accumulator = 0;
    this.hudTimer = 0;
    this.netTimer = 0;
    this.time = 0;
    this.wrongWayTimer = 0;
    this.resetCooldown = 0;
    this.lastLapTime = null;
    this.bestLapTime = null;
    this.finished = false;
    this.stuckTimer = 0;
    this.lastLit = null;
    this.prev = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.curr = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.renderPos = new THREE.Vector3();
    this.renderQuat = new THREE.Quaternion();
    /** Destrozado por poderes: segundos hasta reaparecer en pista. */
    this.wreckTimer = 0;
    this.hitAnim = null;
  }

  progress(progress, label) {
    if (this.disposed) throw new Error('disposed');
    this.opts.onProgress?.({ progress, label });
    // Ceder el hilo para que la pantalla de carga se repinte entre fases.
    return new Promise((r) => setTimeout(r, 0));
  }

  async init() {
    await this.progress(0.05, 'Iniciando motor de físicas');
    await initRapier();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;

    await this.progress(0.15, 'Preparando cielo e iluminación');
    this.quality = qualityPreset(this.opts.quality ?? 'auto');
    this.setup = new SceneSetup(this.canvas, this.theme, { quality: this.quality });
    this.scene = this.setup.scene;
    this.camera = this.setup.camera;

    await this.progress(0.3, 'Trazando la pista');
    this.path = buildTrackPath(this.trackDef, 2);
    this.track = new TrackLoader(RAPIER, this.world, this.scene);
    await this.track.load(this.trackDef, this.path, this.theme);

    await this.progress(0.45, 'Esculpiendo el paisaje');
    this.landscape = new Landscape(this.path, this.theme, {
      outerOffset: this.track.layout.outerOffset,
      quality: this.quality,
      sunDir: this.setup.sunDir,
    });
    this.scene.add(this.landscape.group);

    await this.progress(0.65, 'Capturando reflejos del entorno');
    const p0 = this.path.points[0];
    this.setup.bakeSceneEnvironment(new THREE.Vector3(p0[0], p0[1], p0[2]));

    await this.progress(0.75, 'Preparando los coches');
    const players = this.opts.players;
    const me = players.find((p) => p.id === this.opts.myId);
    const carDef = getCar(me?.carModel);
    this.spawn = gridSlot(this.path, me?.slot ?? 0);
    this.vehicle = new VehicleController(RAPIER, this.world, carDef, this.spawn);
    this.car = await createCar(carDef, me?.color ?? carDef.defaultColor, { detail: this.quality.carDetail });
    this.scene.add(this.car.root);
    if (this.theme.headlights) this.addHeadlights(this.car);
    for (const p of players) if (p.id !== this.opts.myId) this.addRemote(p);
    this.snapshotState();
    this.snapshotState();

    this.chase = new ChaseCamera(this.camera);
    this.input = new InputController();
    this.particles = new ParticleSystem(this.scene);
    this.audio = new AudioManager();
    if (this.opts.powerups) {
      this.sparks = new ParticleSystem(this.scene, { additive: true, growth: -0.8, rise: -2, opacity: 1 });
      this.power = new PowerupSystem(this);
      // Lo que llegó del servidor mientras se cargaba la pista (cliente lento).
      if (this.powerInventory) this.power.setInventory(this.powerInventory);
      for (const events of this.powerBacklog ?? []) this.power.onEvents(events);
      this.powerBacklog = null;
    }
    this.checkpoints = new CheckpointSystem(this.path, this.trackDef, {
      onCheckpoint: (id) => this.handleCheckpoint(id),
    });
    this.projHint = -1;

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();

    await this.progress(0.9, 'Compilando sombreadores');
    this.setup.follow(this.renderPos.copy(this.vehicle.position));
    this.chase.update(STEP, this.renderPos, this.renderQuat.copy(this.vehicle.rotation), 0);
    this.setup.renderer.compile(this.scene, this.camera);
    this.setup.render();
    await this.progress(1, 'Listo');
    return this;
  }

  /** Faros reales (focos) para las pistas nocturnas: solo el coche propio. */
  addHeadlights(car) {
    for (const side of [-1, 1]) {
      const spot = new THREE.SpotLight('#fff1d6', 220, 90, 0.55, 0.5, 1.4);
      spot.position.set(side * 0.6, -0.05, car.dim.length / 2 - 0.2);
      spot.target.position.set(side * 1.2, -1.6, car.dim.length / 2 + 22);
      car.root.add(spot, spot.target);
    }
  }

  addRemote(p) {
    if (this.remotes.has(p.id)) return;
    this.remotes.set(p.id, new RemotePlayer({
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      carDef: getCar(p.carModel),
      scene: this.scene,
      detail: this.quality?.carDetail,
    }));
  }

  removePlayer(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.dispose();
    this.remotes.delete(id);
    this.audio?.removeRemote(id);
  }

  onRemoteTransform(id, transform) {
    this.remotes.get(id)?.pushSnapshot(transform, performance.now());
  }

  /** Tabla del servidor: checkpoints superados por jugador. */
  setStandings(leaderboard) {
    // El servidor ordena primero a los que ya terminaron, por orden de llegada.
    leaderboard.forEach((row, i) => this.standings.set(row.id, { ...row, finishOrder: i }));
  }

  onLapCompleted({ playerId, lapTime }) {
    if (playerId !== this.opts.myId) return;
    this.lastLapTime = lapTime;
    if (this.bestLapTime === null || lapTime < this.bestLapTime) this.bestLapTime = lapTime;
  }

  /** Arranca el audio tras un gesto del usuario. */
  enableAudio() {
    this.audio?.start();
  }

  start() {
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.max(0, Math.min(0.1, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      this.frame(dt, now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  snapshotState() {
    this.prev.p.copy(this.curr.p);
    this.prev.q.copy(this.curr.q);
    const t = this.vehicle.position;
    const r = this.vehicle.rotation;
    this.curr.p.set(t.x, t.y, t.z);
    this.curr.q.set(r.x, r.y, r.z, r.w);
  }

  raceClock() {
    if (this.opts.startTime == null) return -Infinity;
    return this.opts.serverNow() - this.opts.startTime;
  }

  /** Hora de salida (reloj de servidor) cuando todos han cargado. */
  setStartTime(startTime) {
    this.opts.startTime = startTime;
  }

  frame(dt, now) {
    this.time += dt;
    const raceMs = this.raceClock();
    const locked = raceMs < 0;
    const actions = this.input.consumeActions();
    if (actions.includes('camera')) this.chase.cycle();
    if (actions.includes('mute')) this.audio.toggleMute();
    if (this.power && this.canUsePower()) {
      if (actions.includes('cycle')) this.power.cycle();
      if (actions.includes('fire')) this.power.fire(false);
      if (actions.includes('fire_back')) this.power.fire(true);
    }

    let input = this.input.read(dt);
    if (this.finished) input = { throttle: 0, brake: 0.3, steer: 0, handbrake: false };
    this.lastInput = input;

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 5) {
      for (const r of this.remotes.values()) r.update(now);
      const flipped = this.vehicle.update(STEP, input, locked);
      this.vehicle.collideWith(this.remotes.values());
      this.world.step();
      const broken = !this.vehicle.sanitize();
      this.snapshotState();
      if (broken || (flipped && this.wreckTimer <= 0)) this.resetToTrack();
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === 5) this.accumulator = 0;
    const alpha = this.accumulator / STEP;
    this.renderPos.lerpVectors(this.prev.p, this.curr.p, alpha);
    this.renderQuat.slerpQuaternions(this.prev.q, this.curr.q, alpha);

    this.updateTrackState(dt, locked, actions);
    if (this.wreckTimer > 0) {
      this.wreckTimer -= dt;
      if (this.wreckTimer <= 0) this.resetToTrack();
    }
    this.power?.update(dt, { canPickup: !locked && !this.finished && this.wreckTimer <= 0 });
    this.updateVisuals(dt, input);
    this.updateCountdown(raceMs);

    this.netTimer += dt;
    if (this.netTimer >= 1 / TRANSFORM_HZ) {
      this.netTimer = 0;
      this.sendTransform();
    }
    this.hudTimer += dt;
    if (this.hudTimer >= HUD_INTERVAL) {
      this.hudTimer = 0;
      this.publishHud(raceMs);
    }
    this.setup.render();
  }

  updateTrackState(dt, locked, actions) {
    const p = this.vehicle.position;
    const proj = projectToTrack(this.path, p.x, p.z, this.projHint);
    this.projHint = proj.index;
    this.proj = proj;
    if (!locked) this.checkpoints.update(p.x, p.z, this.raceClock());

    // Sentido contrario: el morro apunta contra el trazado durante >1.5 s.
    const fwd = tmpV.set(0, 0, 1).applyQuaternion(this.renderQuat);
    const t = this.path.tangents[proj.index];
    const dot = fwd.x * t[0] + fwd.z * t[2];
    this.wrongWayTimer = dot < -0.4 && this.vehicle.speedKmh > 8 ? this.wrongWayTimer + dt : 0;

    // Recolocar: tecla R, caída o salida muy lejos de la pista.
    this.resetCooldown = Math.max(0, this.resetCooldown - dt);
    const lost = p.y < proj.y - 8 || proj.distance > this.track.layout.outerOffset + 12;
    // Atascado: sin ruedas en el suelo o acelerando sin moverse durante 3 s. Igual
    // que el vuelco, el contador se descarga despacio: los rebotes no lo reinician.
    const v = this.vehicle;
    const unsupported = v.contacts < 2;
    const pinned = !locked && !this.finished && this.lastInput?.throttle > 0 && v.speedKmh < 2;
    this.stuckTimer = unsupported || pinned ? this.stuckTimer + dt : Math.max(0, this.stuckTimer - dt * 0.5);
    const stuck = this.stuckTimer > 3;
    // Destrozado: quieto hasta reaparecer (ni R ni el vigilante de atasco).
    if (this.wreckTimer > 0) {
      this.stuckTimer = 0;
      if (lost) this.resetToTrack();
      return;
    }
    if ((actions.includes('reset') && this.resetCooldown === 0) || lost || stuck) this.resetToTrack();
  }

  resetToTrack() {
    if (!this.proj) return;
    this.resetCooldown = 1.5;
    this.stuckTimer = 0;
    const idx = this.proj.index;
    const p = this.path.points[idx];
    const t = this.path.tangents[idx];
    this.vehicle.reset({ position: [p[0], p[1] + 1.2, p[2]], yaw: Math.atan2(t[0], t[2]) });
    this.snapshotState();
    this.snapshotState();
    this.chase.initialized = false;
  }

  // ---- Poderes (ver powerups/PowerupSystem.js) ----

  onPowerEvents(events) {
    if (this.power) this.power.onEvents(events);
    else if (this.opts.powerups) (this.powerBacklog ??= []).push(events);
  }

  onPowerInventory(items) {
    if (this.power) this.power.setInventory(items);
    else this.powerInventory = items;
  }

  canUsePower() {
    return this.raceClock() >= 0 && !this.finished && this.wreckTimer <= 0;
  }

  /** Posición y orientación (de dibujo) de cualquier coche de la carrera. */
  carState(id) {
    if (id === this.opts.myId) return this.car ? { position: this.car.root.position, quaternion: this.car.root.quaternion } : null;
    const r = this.remotes.get(id);
    return r?.ready ? { position: r.position, quaternion: r.quaternion } : null;
  }

  nameOf(id) {
    return this.opts.players.find((p) => p.id === id)?.nickname ?? 'Alguien';
  }

  /** Impacto confirmado por el servidor sobre el coche propio. */
  applyLocalHit(e) {
    const kind = e.wrecked ? 'wreck' : e.type;
    this.vehicle.applyHit(kind, e.dir, Math.random() < 0.5 ? -1 : 1);
    this.chase.shake = e.wrecked || e.type === 'shunt' || e.type === 'mine' ? 2.2 : 1.2;
    if (e.wrecked) this.wreckTimer = WRECK_MS / 1000 + 0.05; // nunca antes que el servidor
    navigator.vibrate?.(e.wrecked ? [60, 40, 120] : 50);
  }

  localNitro(brake, seconds) {
    if (brake) this.vehicle.startNitroBrake(seconds);
    else {
      this.vehicle.startBoost(seconds);
      this.chase.boost = seconds;
    }
  }

  /** Vuelco visual del modelo al recibir un misil o una mina. */
  flipCar(id, kind) {
    const anim = { kind, t0: this.time, sign: Math.random() < 0.5 ? -1 : 1 };
    if (id === this.opts.myId) this.hitAnim = anim;
    else {
      const r = this.remotes.get(id);
      if (r) r.hitAnim = { ...anim, t0: performance.now() / 1000 };
    }
  }

  handleCheckpoint(id) {
    this.opts.net.sendCheckpoint(id);
    if (id === 0 && this.checkpoints.finished) {
      this.finished = true;
      this.opts.onEvent?.({ type: 'local_finish' });
    }
  }

  updateVisuals(dt, input) {
    const root = this.car.root;
    root.position.copy(this.renderPos);
    root.quaternion.copy(this.renderQuat);
    if (this.hitAnim && !applyHitAnim(root, this.hitAnim, this.time)) this.hitAnim = null;
    const v = this.vehicle;
    const susp = [0, 1, 2, 3].map((i) => v.wheelState(i).suspension);
    const spin = v.wheelState(0).rotation;
    poseWheels(this.car.wheels, this.car.dim, { steer: v.steer, spin, suspension: susp });
    if (this.car.reverseMat) this.car.reverseMat.emissiveIntensity = v.reversing ? 2.5 : 0;
    if (this.car.tailMat) this.car.tailMat.emissiveIntensity = (input.brake > 0 && !v.reversing) || (input.throttle > 0 && v.forwardSpeed < -1) ? 3.5 : 0.6;

    this.emitParticles(dt);
    this.particles.update(dt);
    this.sparks?.update(dt);
    this.landscape.update(this.time);

    if (this.opts.startTime == null) {
      this.chase.orbit(dt, this.renderPos, this.time, 8);
    } else {
      this.chase.update(dt, this.renderPos, this.renderQuat, v.speedKmh, v.steer);
    }
    this.setup.follow(this.renderPos, this.time);

    const camFwd = this.camera.getWorldDirection(tmpV2);
    this.audio.update({
      speedKmh: v.speedKmh,
      throttle: input.throttle,
      slip: v.slip,
      listener: { position: this.camera.position, forward: camFwd },
      remotes: [...this.remotes.values()].map((r) => ({ id: r.id, position: r.position, speed: r.speed })),
    });
  }

  emitParticles(dt) {
    const v = this.vehicle;
    const offTrack = this.proj && Math.abs(this.proj.lateral) > this.path.width / 2 + 1.2;
    const dusty = offTrack && v.speedKmh > 15;
    if (v.slip < 0.15 && !dusty) return;
    const vel = v.body.linvel();
    const rate = Math.min(4, Math.ceil((v.slip + (dusty ? 0.6 : 0)) * 4));
    const color = dusty ? (this.theme.runoff === 'sand' ? dustSand : dustGrass) : smoke;
    for (const i of [2, 3]) {
      const ws = v.wheelState(i);
      if (!ws.contact) continue;
      const c = ws.connection;
      const world = v.localToWorld({ x: c.x, y: c.y - ws.suspension - 0.3, z: c.z });
      const pos = v.position;
      for (let k = 0; k < rate; k++) {
        this.particles.emit(
          { x: pos.x + world.x, y: pos.y + world.y, z: pos.z + world.z },
          { color, velocity: { x: vel.x * 0.15, y: 0.4, z: vel.z * 0.15 }, life: dusty ? 1.6 : 1.3, size: dusty ? 1.4 : 1.1 },
        );
      }
    }
  }

  updateCountdown(raceMs) {
    if (raceMs >= 1500) {
      if (this.lastLit !== 'off') {
        this.track.setStartLights(0);
        this.lastLit = 'off';
      }
      return;
    }
    let lit;
    if (raceMs === -Infinity) lit = 0;
    else if (raceMs >= 0) lit = -1;
    else lit = Math.max(0, Math.min(5, Math.floor((COUNTDOWN_MS + raceMs) / (COUNTDOWN_MS / 5)) + 1));
    if (lit !== this.lastLit) {
      this.track.setStartLights(lit);
      if (lit > 0) this.audio.beep(440, 0.15);
      if (lit === -1) this.audio.beep(880, 0.45, 0.35);
      this.lastLit = lit;
    }
  }

  sendTransform() {
    const p = this.vehicle.position;
    const q = this.vehicle.rotation;
    this.opts.net.sendTransform(encodeTransform({
      position: p,
      rotation: q,
      speed: this.vehicle.speedKmh,
      steer: this.vehicle.steer,
      wheelRotation: this.vehicle.wheelState(0).rotation,
    }));
  }

  /** Posiciones en vivo: checkpoints del servidor + metros recorridos desde el último. */
  computeStandings() {
    const gates = this.checkpoints.gates;
    const n = gates.length;
    const seg = this.path.length / n;
    const rows = [];
    const add = (id, nickname, color, passed, x, z, finished) => {
      const pr = projectToTrack(this.path, x, z);
      const lastGate = gates[((passed % n) + n) % n];
      const extra = Math.min(seg * 1.5, forwardDistance(this.path, lastGate.s, pr.s));
      rows.push({ id, nickname, color, key: finished ? 1e9 - (this.standings.get(id)?.finishOrder ?? 0) : passed * seg + extra, x, z, finished });
    };
    const meRow = this.standings.get(this.opts.myId);
    const myPassed = this.checkpoints.lap * n + ((this.checkpoints.next - 1 + n) % n);
    const me = this.opts.players.find((p) => p.id === this.opts.myId);
    const p = this.vehicle.position;
    add(this.opts.myId, me?.nickname ?? 'Tú', me?.color ?? '#fff', myPassed, p.x, p.z, meRow?.finished);
    for (const r of this.remotes.values()) {
      const s = this.standings.get(r.id);
      const passed = s ? s.progress : 0;
      const info = this.opts.players.find((pl) => pl.id === r.id);
      add(r.id, r.nickname, info?.color ?? '#fff', passed, r.position.x, r.position.z, s?.finished);
    }
    rows.sort((a, b) => b.key - a.key);
    return rows;
  }

  publishHud(raceMs) {
    const v = this.vehicle;
    const standings = this.computeStandings();
    const cp = this.checkpoints;
    this.opts.onHud({
      speedKmh: v.speedKmh,
      rpm: AudioManager.rpmFor(v.speedKmh),
      gear: v.reversing || v.forwardSpeed < -0.5 ? 'R' : v.speedKmh < 1 ? 'N' : AudioManager.gearFor(v.speedKmh),
      raceMs: Number.isFinite(raceMs) ? raceMs : null,
      lap: Math.min(cp.lap + 1, this.trackDef.laps),
      laps: this.trackDef.laps,
      lapMs: raceMs > 0 ? Math.max(0, raceMs - (cp.lapStart > 0 ? cp.lapStart : 0)) : 0,
      lastLapMs: this.lastLapTime,
      bestLapMs: this.bestLapTime,
      wrongWay: this.wrongWayTimer > 1.5,
      finished: this.finished,
      position: standings.findIndex((s) => s.id === this.opts.myId) + 1,
      standings: standings.map(({ id, nickname, color, x, z }) => ({ id, nickname, color, x, z })),
      muted: this.audio.muted,
      power: this.power?.hudState() ?? null,
      wrecked: this.wreckTimer > 0,
    });
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.setup.resize(w, h);
    this.particles?.setViewportHeight(h);
    this.sparks?.setViewportHeight(h);
  }

  dispose() {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input?.dispose();
    this.audio?.dispose();
    for (const id of [...this.remotes.keys()]) this.removePlayer(id);
    if (this.car) disposeCar(this.car);
    this.power?.dispose();
    this.particles?.dispose();
    this.sparks?.dispose();
    this.landscape?.dispose();
    this.track?.dispose();
    this.vehicle?.dispose();
    this.setup?.dispose();
    this.world?.free();
    this.world = null;
    disposeTextures();
  }
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const smoke = new THREE.Color('#d9d9d9');
const dustSand = new THREE.Color('#d2a26e');
const dustGrass = new THREE.Color('#8a7a5a');

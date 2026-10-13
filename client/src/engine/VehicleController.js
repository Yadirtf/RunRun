/**
 * Físicas del vehículo local con el controlador de vehículo por raycast de
 * Rapier (suspensión independiente por rueda, fricción longitudinal/lateral).
 * No depende de Three.js: expone posición, rotación y estado de ruedas para
 * que la capa de render los dibuje.
 *
 * Convención: el coche mira a +Z local, +Y arriba, +X a la izquierda.
 */
import { carDimensions } from './carGeometry.js';
import { carCircles, deepestOverlap, contactDeltaV } from './carContacts.js';

const KMH = 3.6;

export class VehicleController {
  /**
   * @param {typeof import('@dimforge/rapier3d-compat')} RAPIER
   * @param {import('@dimforge/rapier3d-compat').World} world
   * @param {object} carDef definición de shared/cars
   * @param {{position: number[], yaw: number}} spawn
   */
  constructor(RAPIER, world, carDef, spawn) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.def = carDef;
    this.stats = carDef.stats;
    const dim = carDimensions(carDef);
    const { length, width } = dim;
    this.wheelBase = dim.wheelBase;
    this.halfTrack = dim.halfTrack;
    this.wheelRadius = dim.wheelRadius;
    this.suspensionRest = dim.suspensionRest;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setCanSleep(false)
      .setLinearDamping(0.05)
      .setAngularDamping(0.6)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(bodyDesc);

    const halfX = width / 2;
    const halfY = 0.32;
    const halfZ = length / 2;
    const m = this.stats.mass;
    // Inercia de caja con el centro de masas bajo para que no vuelque en curva.
    const inertia = {
      x: (m / 12) * (4 * halfY * halfY + 4 * halfZ * halfZ),
      y: (m / 12) * (4 * halfX * halfX + 4 * halfZ * halfZ),
      z: (m / 12) * (4 * halfX * halfX + 4 * halfY * halfY),
    };
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
      .setTranslation(0, 0.1, 0)
      .setMassProperties(m, { x: 0, y: -0.35, z: 0.05 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(0.3)
      .setRestitution(0.1);
    this.collider = world.createCollider(colliderDesc, this.body);
    this.inertiaY = inertia.y;
    /** Intensidad de las asistencias (0 = simulación pura, 1 = por defecto). */
    this.assist = 1;
    this.lateralLimit = this.stats.grip * 10;

    this.vehicle = world.createVehicleController(this.body);
    // En rapier 0.12 el setter de eje frontal tiene este nombre.
    this.vehicle.setIndexForwardAxis = 2;
    this.vehicle.indexUpAxis = 1;

    const y = dim.connectionY;
    const zf = this.wheelBase / 2;
    const positions = [
      { x: this.halfTrack, y, z: zf }, // fl (izquierda = +X)
      { x: -this.halfTrack, y, z: zf }, // fr
      { x: this.halfTrack, y, z: -zf }, // rl
      { x: -this.halfTrack, y, z: -zf }, // rr
    ];
    for (const p of positions) {
      this.vehicle.addWheel(p, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, this.suspensionRest, this.wheelRadius);
    }
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelSuspensionStiffness(i, 32);
      this.vehicle.setWheelSuspensionCompression(i, 3.2);
      this.vehicle.setWheelSuspensionRelaxation(i, 2.6);
      this.vehicle.setWheelMaxSuspensionTravel(i, 0.25);
      this.vehicle.setWheelMaxSuspensionForce(i, m * 40);
      this.vehicle.setWheelFrictionSlip(i, this.stats.grip);
      this.vehicle.setWheelSideFrictionStiffness(i, i < 2 ? 1.0 : 0.92);
    }

    this.steer = 0;
    this.speedKmh = 0;
    this.forwardSpeed = 0;
    this.slip = 0;
    this.flipTimer = 0;
    this.airTime = 0;
    this.contacts = 0;
    this.reverseHold = 0;
    /** Marcha atrás engranada (freno mantenido con el coche parado). */
    this.reversing = false;
    this.reset(spawn);
  }

  reset({ position, yaw }) {
    const half = yaw / 2;
    this.body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.flipTimer = 0;
    this.reverseHold = 0;
    this.reversing = false;
  }

  /** Vector local del chasis rotado a mundo. */
  localToWorld(v) {
    const q = this.body.rotation();
    const { x, y, z } = v;
    const ix = q.w * x + q.y * z - q.z * y;
    const iy = q.w * y + q.z * x - q.x * z;
    const iz = q.w * z + q.x * y - q.y * x;
    const iw = -q.x * x - q.y * y - q.z * z;
    return {
      x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
      y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
      z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
    };
  }

  /**
   * @param {number} dt paso fijo en segundos
   * @param {{throttle: number, brake: number, steer: number, handbrake: boolean}} input
   *   throttle/brake en [0,1], steer en [-1,1] (positivo = izquierda)
   * @param {boolean} locked true durante la cuenta atrás (frenos puestos)
   */
  update(dt, input, locked = false) {
    const v = this.vehicle;
    const s = this.stats;
    // addForce es persistente en Rapier: se limpia y se recalcula cada paso.
    this.body.resetForces(true);
    const vel = this.body.linvel();
    const fwd = this.localToWorld({ x: 0, y: 0, z: 1 });
    const up = this.localToWorld({ x: 0, y: 1, z: 0 });
    this.forwardSpeed = vel.x * fwd.x + vel.y * fwd.y + vel.z * fwd.z;
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    this.speedKmh = Math.abs(this.forwardSpeed) * KMH;
    const maxMs = s.maxSpeedKmh / KMH;

    // Dirección: el ángulo máximo se limita para que, a cualquier velocidad, girar
    // a tope pida justo el giro que el agarre permite (sin subviraje "en seco").
    const absV = Math.abs(this.forwardSpeed);
    this.lateralLimit = s.grip * 10;
    const gripSteer = Math.atan((this.lateralLimit * 1.8 * this.wheelBase) / Math.max(absV * absV, 1));
    const maxSteer = Math.min(s.steer, gripSteer);
    const target = input.steer * maxSteer;
    const rate = (input.steer === 0 ? 7 : 5) * s.steer * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));

    let engine = 0;
    let brake = 0;
    if (locked) {
      brake = s.brakeForce;
    } else {
      // Pedal de freno = reversa: con el coche detenido, mantenerlo pisado un
      // instante engrana la marcha atrás; soltarlo o acelerar la desengrana.
      const stopped = Math.abs(this.forwardSpeed) < 0.8;
      if (input.brake > 0 && input.throttle === 0) {
        if (stopped || this.reversing) this.reverseHold += dt;
      } else {
        this.reverseHold = 0;
        this.reversing = false;
      }
      if (this.reverseHold > 0.35) this.reversing = true;

      // El freno manda sobre el acelerador si se pisan los dos.
      const braking = input.brake > 0 && !this.reversing && this.forwardSpeed > 0.5;
      if (input.throttle > 0 && !braking) {
        if (this.forwardSpeed < -1) {
          // Acelerar yendo hacia atrás: primero frenar.
          brake = s.brakeForce * input.throttle;
        } else {
          // Curva de par: plena hasta 75% de la punta y cae a 0 en la velocidad máxima.
          const r = this.forwardSpeed / maxMs;
          const curve = r < 0.75 ? 1 : Math.max(0, 1 - (r - 0.75) / 0.25);
          engine = s.engineForce * input.throttle * curve;
        }
      }
      if (input.brake > 0) {
        if (this.reversing) {
          if (input.throttle === 0 && this.forwardSpeed > -30 / KMH) engine = -s.engineForce * 0.5 * input.brake;
        } else {
          brake = s.brakeForce * input.brake;
        }
      }
      if (input.throttle === 0 && input.brake === 0) brake = 4; // freno motor
    }

    const handbrake = input.handbrake && !locked;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      v.setWheelSteering(i, front ? this.steer : 0);
      // Tracción integral 30/70 para estabilidad con carácter trasero.
      v.setWheelEngineForce(i, engine * (front ? 0.15 : 0.35));
      const hb = handbrake && !front;
      v.setWheelBrake(i, hb ? s.brakeForce * 1.4 : brake * (front ? 0.6 : 0.4));
      v.setWheelFrictionSlip(i, hb ? s.grip * 0.45 : s.grip);
    }

    // Carga aerodinámica proporcional a v² para pegar el coche al asfalto.
    const down = 0.9 * this.forwardSpeed * this.forwardSpeed;
    this.body.addForce({ x: -up.x * down, y: -up.y * down, z: -up.z * down }, true);
    // Resistencia del aire.
    const drag = 0.28;
    this.body.addForce({ x: -vel.x * speed * drag, y: 0, z: -vel.z * speed * drag }, true);

    v.updateVehicle(dt);
    this.applyAssists(dt, { vel, up, handbrake, locked });
    this.stabilize(up);

    let contacts = 0;
    let side = 0;
    for (let i = 0; i < 4; i++) {
      if (v.wheelIsInContact(i)) contacts++;
      side += Math.abs(v.wheelSideImpulse(i) ?? 0);
    }
    this.contacts = contacts;
    this.airTime = contacts === 0 ? this.airTime + dt : 0;
    const lateral = this.localToWorld({ x: 1, y: 0, z: 0 });
    const lateralSpeed = Math.abs(vel.x * lateral.x + vel.y * lateral.y + vel.z * lateral.z);
    this.slip = contacts > 0 ? Math.min(1, Math.max(0, (lateralSpeed - 2.5) / 8) + (handbrake && speed > 5 ? 0.4 : 0)) : 0;
    this.sideImpulse = side;

    // Vuelco: si el techo apunta a menos de 10° del horizonte durante 3 s, recolocar.
    this.flipTimer = up.y < Math.cos((80 * Math.PI) / 180) ? this.flipTimer + dt : 0;
    return this.flipTimer > 3;
  }

  /**
   * Asistencias de conducción (tipo ESC): llevan la velocidad de giro hacia la
   * que pide el volante y absorben parte del deslizamiento lateral, de modo que
   * el coche va hacia donde apunta. Con freno de mano se relajan para derrapar.
   */
  applyAssists(dt, { vel, up, handbrake, locked }) {
    const v = this.vehicle;
    let contacts = 0;
    for (let i = 0; i < 4; i++) if (v.wheelIsInContact(i)) contacts++;
    const vF = this.forwardSpeed;
    // Solo con el coche apoyado y nivelado: nunca empujar un coche volcado o contra un muro.
    if (locked || contacts < 3 || Math.abs(vF) < 2 || up.y < 0.85) return;
    const w = this.body.angvel();
    const yawRate = w.x * up.x + w.y * up.y + w.z * up.z;
    const limit = this.lateralLimit / Math.abs(vF);
    const kinematic = (vF * Math.tan(this.steer)) / this.wheelBase;
    const desired = Math.max(-limit, Math.min(limit, kinematic));
    // Con freno de mano la asistencia se relaja (derrape), pero el volante sigue
    // mandando: girar mientras se frena con la palanca rota el coche.
    const strength = (handbrake ? 3 : 7) * this.assist;
    const torque = this.inertiaY * strength * (desired - yawRate);
    this.body.addTorque({ x: up.x * torque, y: up.y * torque, z: up.z * torque }, true);

    // Eje lateral horizontal: la corrección nunca tiene componente vertical.
    const l = this.localToWorld({ x: 1, y: 0, z: 0 });
    const ll = Math.hypot(l.x, l.z) || 1;
    const lx = l.x / ll;
    const lz = l.z / ll;
    const vLat = vel.x * lx + vel.z * lz;
    const rate = (handbrake ? 1.2 : 3.5) * this.assist;
    const dv = Math.max(-0.6, Math.min(0.6, vLat * (1 - Math.exp(-dt * rate))));
    const k = this.stats.mass * dv;
    this.body.applyImpulse({ x: -lx * k, y: 0, z: -lz * k }, true);
  }

  /**
   * Anti-vuelco: un golpe contra el muro a gran velocidad no debe lanzar el
   * coche por los aires. Se limita el giro de alabeo/cabeceo y el salto vertical.
   */
  stabilize(up) {
    const w = this.body.angvel();
    const yaw = w.x * up.x + w.y * up.y + w.z * up.z;
    const rx = w.x - up.x * yaw;
    const ry = w.y - up.y * yaw;
    const rz = w.z - up.z * yaw;
    const roll = Math.hypot(rx, ry, rz);
    const maxRoll = 2.2;
    const maxYaw = 4;
    const yawC = Math.max(-maxYaw, Math.min(maxYaw, yaw));
    const k = roll > maxRoll ? maxRoll / roll : 1;
    if (k < 1 || yawC !== yaw) {
      this.body.setAngvel({ x: rx * k + up.x * yawC, y: ry * k + up.y * yawC, z: rz * k + up.z * yawC }, true);
    }
    const lv = this.body.linvel();
    if (lv.y > 5) this.body.setLinvel({ x: lv.x, y: 5, z: lv.z }, true);
  }

  /** Choque blando con los coches de otros jugadores (ver carContacts.js). */
  collideWith(remotes) {
    const p = this.body.translation();
    const f = this.localToWorld({ x: 0, y: 0, z: 1 });
    const mine = carCircles(this.def, p.x, p.z, f.x, f.z);
    for (const r of remotes) {
      if (!r.ready || Math.abs(r.position.y - p.y) > 2) continue;
      const hit = deepestOverlap(mine, carCircles(r.carDef, r.position.x, r.position.z, r.forward.x, r.forward.z));
      if (!hit) continue;
      const v = this.body.linvel();
      const dv = contactDeltaV(hit, v, r.velocity);
      const m = this.stats.mass;
      this.body.applyImpulse({ x: dv.x * m, y: 0, z: dv.z * m }, true);
    }
  }

  /**
   * Red de seguridad tras cada paso de físicas: limita velocidades imposibles
   * y detecta estados rotos (NaN). Devuelve false si hay que recolocar.
   */
  sanitize() {
    const t = this.body.translation();
    const v = this.body.linvel();
    const w = this.body.angvel();
    if (![t.x, t.y, t.z, v.x, v.y, v.z, w.x, w.y, w.z].every(Number.isFinite)) return false;
    const maxH = (this.stats.maxSpeedKmh / KMH) * 1.3;
    const h = Math.hypot(v.x, v.z);
    const k = h > maxH ? maxH / h : 1;
    const vy = Math.max(-40, Math.min(8, v.y));
    if (k < 1 || vy !== v.y) this.body.setLinvel({ x: v.x * k, y: vy, z: v.z * k }, true);
    const wl = Math.hypot(w.x, w.y, w.z);
    if (wl > 6) this.body.setAngvel({ x: (w.x * 6) / wl, y: (w.y * 6) / wl, z: (w.z * 6) / wl }, true);
    return true;
  }

  get position() {
    return this.body.translation();
  }

  get rotation() {
    return this.body.rotation();
  }

  /** Estado visual de cada rueda: compresión, giro acumulado y ángulo de dirección. */
  wheelState(i) {
    const v = this.vehicle;
    return {
      suspension: v.wheelSuspensionLength(i) ?? this.suspensionRest,
      rotation: v.wheelRotation(i) ?? 0,
      steering: v.wheelSteering(i) ?? 0,
      connection: v.wheelChassisConnectionPointCs(i),
      contact: v.wheelIsInContact(i),
    };
  }

  dispose() {
    this.world.removeVehicleController(this.vehicle);
    this.world.removeRigidBody(this.body);
  }
}

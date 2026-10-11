// Vehículo local: chasis dinámico de Rapier + DynamicRayCastVehicleController
// (suspensión por raycast, fricción longitudinal/lateral por rueda), con tren motriz
// simulado (curva de par, caja automática, marcha atrás), aerodinámica y superficies.
import * as THREE from 'three';
import { FIXED_DT } from './Physics.js';

const RHO = 1.225;
const FRONTAL_AREA = 2.0;
const TAU = Math.PI * 2;
const WHEEL_FL = 0, WHEEL_FR = 1, WHEEL_RL = 2, WHEEL_RR = 3;

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

function torqueCurve(x) {
  // x = rpm / corte. Par alto en medios, cae al final.
  const c = Math.min(Math.max(x, 0), 1.05);
  return 0.55 + 0.45 * Math.sin(Math.PI * Math.min(c, 1) * 0.85);
}

export class Vehicle {
  /**
   * @param {import('./Physics.js').PhysicsWorld} physics
   * @param {object} carDef  entrada de CARS
   * @param {{bounds: THREE.Box3, wheels: {x:number,y:number,z:number,radius:number}[]}} dims
   * @param {{x:number,z:number,yaw:number}} spawn
   */
  constructor(physics, carDef, dims, spawn) {
    const { RAPIER, world } = physics;
    this.physics = physics;
    this.p = carDef.physics;
    this.def = carDef;
    const P = this.p;

    const b = dims.bounds;
    const halfX = Math.min((b.max.x - b.min.x) / 2, 1.05) * 0.9;
    const halfZ = ((b.max.z - b.min.z) / 2) * 0.96;
    const centerZ = (b.max.z + b.min.z) / 2;
    const bodyBottom = 0.36;
    const halfY = Math.max((b.max.y * 0.82 - bodyBottom) / 2, 0.2);

    const yaw = spawn.yaw;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, 0.15, spawn.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(0.02)
      .setAngularDamping(0.6)
      .setCanSleep(false)
      .setCcdEnabled(true);
    const m = P.mass;
    const lx = halfX * 2, ly = 1.0, lz = halfZ * 2;
    desc.setAdditionalMassProperties(
      m,
      { x: 0, y: 0.42, z: centerZ + 0.05 },
      { x: (m / 12) * (ly * ly + lz * lz), y: (m / 12) * (lx * lx + lz * lz), z: (m / 12) * (lx * lx + ly * ly) },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    this.body = world.createRigidBody(desc);
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
        .setTranslation(0, bodyBottom + halfY, centerZ)
        .setDensity(0)
        .setFriction(0.25)
        .setRestitution(0.1)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
      this.body,
    );

    // Controlador de vehículo: Y arriba, Z adelante.
    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;

    const restLength = 0.28;
    this.restLength = restLength;
    this.wheelInfo = dims.wheels.map((w, i) => {
      const front = i < 2;
      const conn = { x: w.x * 0.98, y: w.y + restLength - 0.06, z: w.z };
      this.controller.addWheel(conn, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, restLength, w.radius);
      this.controller.setWheelSuspensionStiffness(i, P.suspensionStiffness);
      this.controller.setWheelSuspensionCompression(i, P.suspensionCompression);
      this.controller.setWheelSuspensionRelaxation(i, P.suspensionRelaxation);
      this.controller.setWheelMaxSuspensionTravel(i, P.suspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, m * 40);
      this.controller.setWheelFrictionSlip(i, P.frictionSlip * (front ? 1 : P.rearGripScale));
      this.controller.setWheelSideFrictionStiffness(i, P.sideFriction);
      return { conn, radius: w.radius, front };
    });
    this.wheelRadius = dims.wheels[2].radius;
    this.driven = P.drive === 'AWD' ? [WHEEL_FL, WHEEL_FR, WHEEL_RL, WHEEL_RR] : [WHEEL_RL, WHEEL_RR];
    this.driveSplit = P.drive === 'AWD' ? [0.2, 0.2, 0.3, 0.3] : [0, 0, 0.5, 0.5];

    // Par máximo para que la potencia nominal se alcance al 85% del corte.
    const rpmAtPower = P.redline * 0.85;
    this.peakTorque = P.enginePower / ((rpmAtPower * TAU) / 60) / torqueCurve(0.85);

    this.gear = 1;
    this.rpm = P.idleRpm;
    this.shiftTimer = 0;
    this.steerAngle = 0;
    this.speed = 0;
    this.slip = 0;
    this.braking = false;
    this.surfaceGrip = 1;
    this.brakeTransfer = 0;
    this.surfaceDrag = 0;
    this.upsideDownTime = 0;
    this.impact = 0;
    this.lastVel = new THREE.Vector3();
    this.frozen = true;
    this.surface = 'asphalt';
  }

  /** Superficie bajo el coche (la decide el juego según la distancia a la línea central). */
  setSurface(surface) {
    if (surface === this.surface) return;
    this.surface = surface;
    const grip = surface === 'grass' ? 0.6 : surface === 'kerb' ? 0.92 : 1;
    this.surfaceGrip = grip;
    this.surfaceDrag = surface === 'grass' ? 0.9 : 0;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      this.controller.setWheelFrictionSlip(i, this.p.frictionSlip * grip * (front ? 1 : this.p.rearGripScale));
    }
  }

  /** Durante la cuenta atrás el coche está bloqueado pero el motor se puede acelerar. */
  setFrozen(frozen) { this.frozen = frozen; }

  /**
   * Avanza un paso fijo. `input`: { throttle, brake, steer (-1 izq … 1 der), handbrake }.
   */
  update(input) {
    const P = this.p;
    const c = this.controller;
    const body = this.body;
    const dt = FIXED_DT;

    const rot = body.rotation();
    _q.set(rot.x, rot.y, rot.z, rot.w);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    _right.set(-1, 0, 0).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    const lv = body.linvel();
    _v.set(lv.x, lv.y, lv.z);
    const speed = _v.dot(_fwd);
    this.speed = speed;
    const absSpeed = Math.abs(speed);

    // ---------- Caja de cambios y marcha atrás ----------
    let throttle = input.throttle;
    let brake = input.brake;
    if (this.gear === -1) {
      // En marcha atrás el freno hace de acelerador y viceversa.
      if (input.throttle > 0.1 && absSpeed < 1.5) this.gear = 1;
      else { throttle = input.brake; brake = input.throttle; }
    } else if (input.brake > 0.1 && input.throttle < 0.05 && speed < 0.8 && !this.frozen) {
      this.gear = -1;
      throttle = input.brake;
      brake = 0;
    }

    const ratio = this.gear === -1 ? P.gears[0] : P.gears[this.gear - 1];
    const totalRatio = ratio * P.finalDrive;
    const wheelRpm = (absSpeed / this.wheelRadius) * 60 / TAU;
    let rpm = wheelRpm * totalRatio;
    // Embrague que patina a baja velocidad: las revoluciones suben con el acelerador.
    const clutchRpm = P.idleRpm + throttle * (P.redline * 0.55);
    if (this.frozen || (this.gear <= 1 && rpm < clutchRpm)) rpm = Math.max(rpm, clutchRpm);
    rpm = Math.max(rpm, P.idleRpm);
    this.rpm += (Math.min(rpm, P.redline * 1.02) - this.rpm) * Math.min(1, dt * 18);

    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.gear > 0 && this.shiftTimer <= 0 && !this.frozen) {
      const nGears = P.gears.length;
      if (wheelRpm * totalRatio > P.redline * 0.95 && this.gear < nGears) {
        this.gear++; this.shiftTimer = 0.3;
      } else if (this.gear > 1) {
        const lowerRpm = wheelRpm * P.gears[this.gear - 2] * P.finalDrive;
        if (wheelRpm * totalRatio < P.redline * 0.55 && lowerRpm < P.redline * 0.86) {
          this.gear--; this.shiftTimer = 0.25;
        }
      }
    }

    // ---------- Motor ----------
    let wheelForce = 0;
    const shifting = this.shiftTimer > 0.15;
    if (!this.frozen && !shifting && this.rpm < P.redline) {
      const torque = this.peakTorque * torqueCurve(this.rpm / P.redline) * throttle;
      wheelForce = (torque * totalRatio * 0.88) / this.wheelRadius;
      wheelForce = Math.min(wheelForce, P.maxEngineForce * this.driven.length);
    }
    const dir = this.gear === -1 ? -1 : 1;
    if (this.gear === -1) wheelForce = Math.min(wheelForce, 4000);
    for (let i = 0; i < 4; i++) c.setWheelEngineForce(i, dir * wheelForce * this.driveSplit[i]);

    // ---------- Frenos ----------
    this.braking = brake > 0.05 && absSpeed > 0.5;
    const frozenBrake = this.frozen ? P.brakeForce * 2 : 0;
    const handbrake = input.handbrake ? P.brakeForce * 0.9 : 0;
    for (let i = 0; i < 4; i++) {
      const share = i < 2 ? 0.6 : 0.4;
      let b = brake * P.brakeForce * share * 2;
      if (i >= 2) b += handbrake;
      if (throttle < 0.02 && brake < 0.02) b += 5; // freno motor
      // Rapier interpreta el freno como impulso por paso (N·s).
      c.setWheelBrake(i, b + frozenBrake);
    }
    // Transferencia de peso al frenar: el morro gana agarre y la trasera lo pierde,
    // así que frenar fuerte girando hace que la trasera derrape un poco (como en un coche real).
    const transfer = brake * Math.min(absSpeed / 25, 1) * (this.gear > 0 ? 1 : 0);
    this.brakeTransfer += (transfer - this.brakeTransfer) * Math.min(1, dt * 8);
    const t = this.brakeTransfer;
    const base = P.frictionSlip * this.surfaceGrip;
    c.setWheelFrictionSlip(WHEEL_FL, base * (1 + 0.12 * t));
    c.setWheelFrictionSlip(WHEEL_FR, base * (1 + 0.12 * t));
    c.setWheelFrictionSlip(WHEEL_RL, base * P.rearGripScale * (1 - 0.18 * t));
    c.setWheelFrictionSlip(WHEEL_RR, base * P.rearGripScale * (1 - 0.18 * t));
    let rearSide = P.sideFriction * (1 - 0.22 * t);
    if (input.handbrake) rearSide = P.sideFriction * 0.42;
    c.setWheelSideFrictionStiffness(WHEEL_RL, rearSide);
    c.setWheelSideFrictionStiffness(WHEEL_RR, rearSide);

    // ---------- Dirección (sensible a la velocidad) ----------
    const speedFactor = 1 / (1 + absSpeed / 24);
    const target = -input.steer * P.steerMax * (0.25 + 0.75 * speedFactor);
    const rate = (Math.sign(target) !== Math.sign(this.steerAngle) ? 6 : 3.2) * dt;
    this.steerAngle += Math.max(-rate, Math.min(rate, target - this.steerAngle));
    c.setWheelSteering(WHEEL_FL, this.steerAngle);
    c.setWheelSteering(WHEEL_FR, this.steerAngle);

    // ---------- Aerodinámica, rodadura y superficie ----------
    body.resetForces(true);
    const v2 = _v.lengthSq();
    const downforce = 0.5 * RHO * P.downforce * v2;
    const drag = 0.5 * RHO * P.drag * FRONTAL_AREA * v2;
    const grounded = [0, 1, 2, 3].some((i) => c.wheelIsInContact(i));
    const rolling = grounded ? (0.012 + this.surfaceDrag * 0.06) * P.mass * 9.81 : 0;
    const vlen = Math.sqrt(v2);
    if (vlen > 0.1) {
      const k = (drag + (vlen > 1 ? rolling : rolling * vlen)) / vlen;
      body.addForce({ x: -_v.x * k, y: -_v.y * k, z: -_v.z * k }, true);
    }
    if (grounded) body.addForce({ x: -_up.x * downforce, y: -_up.y * downforce, z: -_up.z * downforce }, true);

    c.updateVehicle(dt);

    // ---------- Derrape (para humo, marcas y sonido) ----------
    const lateral = Math.abs(_v.dot(_right));
    let slip = Math.max(0, (lateral - 2.2) / 7);
    if (brake > 0.6 && absSpeed > 12 && this.surface !== 'grass') slip = Math.max(slip, 0.25);
    if (input.handbrake && absSpeed > 6) slip = Math.max(slip, 0.6);
    if (throttle > 0.9 && this.gear === 1 && absSpeed < 12 && !this.frozen) slip = Math.max(slip, 0.45);
    this.slip += (Math.min(slip, 1) - this.slip) * Math.min(1, dt * 10);
    this.grounded = grounded;

    // ---------- Golpes y vuelcos ----------
    const dv = _v.distanceTo(this.lastVel);
    this.impact = dv > 3.5 ? Math.min(dv / 15, 1) : 0;
    this.lastVel.copy(_v);
    this.upsideDownTime = _up.y < 0.35 ? this.upsideDownTime + dt : 0;
  }

  /** Coloca el coche en un punto con una orientación, parado. */
  teleport(x, z, yaw, y = 0.6) {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lastVel.set(0, 0, 0);
    this.gear = 1;
    this.steerAngle = 0;
    this.upsideDownTime = 0;
  }

  /** Estado para la parte visual y la red. */
  readState(out) {
    const t = this.body.translation();
    const r = this.body.rotation();
    out.position.set(t.x, t.y, t.z);
    out.quaternion.set(r.x, r.y, r.z, r.w);
    const c = this.controller;
    for (let i = 0; i < 4; i++) {
      out.wheelSteer[i] = c.wheelSteering(i) ?? 0;
      out.wheelSpin[i] = c.wheelRotation(i) ?? 0;
      const susp = c.wheelSuspensionLength(i) ?? this.restLength;
      out.wheelY[i] = this.wheelInfo[i].conn.y - susp;
    }
    out.speed = this.speed;
    out.rpm = this.rpm;
    out.gear = this.gear;
    out.steer = this.steerAngle / this.p.steerMax;
    out.slip = this.slip;
    out.braking = this.braking;
    return out;
  }

  dispose() {
    this.physics.world.removeVehicleController(this.controller);
    this.physics.world.removeRigidBody(this.body);
  }
}

export function createCarState() {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    wheelSteer: [0, 0, 0, 0],
    wheelSpin: [0, 0, 0, 0],
    wheelY: [0.38, 0.38, 0.38, 0.38],
    speed: 0,
    rpm: 0,
    gear: 1,
    steer: 0,
    slip: 0,
    braking: false,
  };
}

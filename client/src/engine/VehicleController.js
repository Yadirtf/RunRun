/**
 * Físicas del vehículo local con el controlador de vehículo por raycast de
 * Rapier (suspensión independiente por rueda, fricción longitudinal/lateral).
 * No depende de Three.js: expone posición, rotación y estado de ruedas para
 * que la capa de render los dibuje.
 *
 * Convención: el coche mira a +Z local, +Y arriba, +X a la izquierda.
 */
import { carDimensions } from './carGeometry.js';

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

    // Dirección: menos ángulo a alta velocidad y retorno suave al centro.
    const speedFactor = Math.min(1, speed / maxMs);
    const maxSteer = s.steer * (1 - 0.68 * speedFactor);
    const target = input.steer * maxSteer;
    const rate = (input.steer === 0 ? 4.5 : 3.0) * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));

    let engine = 0;
    let brake = 0;
    if (locked) {
      brake = s.brakeForce;
    } else {
      if (input.throttle > 0) {
        // Curva de par: plena hasta 75% de la punta y cae a 0 en la velocidad máxima.
        const r = this.forwardSpeed / maxMs;
        const curve = r < 0.75 ? 1 : Math.max(0, 1 - (r - 0.75) / 0.25);
        engine = s.engineForce * input.throttle * curve;
      }
      if (input.brake > 0) {
        if (this.forwardSpeed > 1.5) {
          brake = s.brakeForce * input.brake;
        } else if (this.forwardSpeed > -30 / KMH) {
          engine = -s.engineForce * 0.5 * input.brake;
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

    let contacts = 0;
    let side = 0;
    for (let i = 0; i < 4; i++) {
      if (v.wheelIsInContact(i)) contacts++;
      side += Math.abs(v.wheelSideImpulse(i) ?? 0);
    }
    this.airTime = contacts === 0 ? this.airTime + dt : 0;
    const lateral = this.localToWorld({ x: 1, y: 0, z: 0 });
    const lateralSpeed = Math.abs(vel.x * lateral.x + vel.y * lateral.y + vel.z * lateral.z);
    this.slip = contacts > 0 ? Math.min(1, Math.max(0, (lateralSpeed - 2.5) / 8) + (handbrake && speed > 5 ? 0.4 : 0)) : 0;
    this.sideImpulse = side;

    // Vuelco: si el techo apunta a menos de 10° del horizonte durante 3 s, recolocar.
    this.flipTimer = up.y < Math.cos((80 * Math.PI) / 180) ? this.flipTimer + dt : 0;
    return this.flipTimer > 3;
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

// Mundo físico (Rapier 3D, WebAssembly). Paso fijo de 60 Hz.
import RAPIER from '@dimforge/rapier3d-compat';

let initPromise = null;
export function initRapier() {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export const FIXED_DT = 1 / 60;

export class PhysicsWorld {
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    this.RAPIER = RAPIER;
  }

  /** Suelo infinito (en la práctica, un bloque enorme) con la cara superior en y = 0. */
  addGround(halfSize) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfSize, 1, halfSize).setFriction(1.0).setRestitution(0),
      body,
    );
    return body;
  }

  /** Muro fijo como caja orientada entre dos puntos del plano XZ. */
  addWall(ax, az, bx, bz, height, thickness) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return null;
    const yaw = Math.atan2(dx, dz);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation((ax + bx) / 2, height / 2, (az + bz) / 2)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(thickness / 2, height / 2, len / 2 + 0.05).setFriction(0.35).setRestitution(0.15),
      body,
    );
    return body;
  }

  step() { this.world.step(); }

  dispose() { this.world.free(); }
}

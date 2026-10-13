import { checkpointGates } from '@runrun/shared/trackPath';

/**
 * Detecta el cruce de las puertas de checkpoint por el coche local (cambio de
 * signo de la distancia al plano de la puerta dentro del ancho de pista) y
 * lleva el cronómetro de la vuelta en curso. El servidor valida y es la
 * fuente de verdad de vueltas y posiciones.
 */
export class CheckpointSystem {
  constructor(path, trackDef, { onCheckpoint }) {
    this.path = path;
    this.gates = checkpointGates(path, trackDef.checkpoints);
    this.count = this.gates.length;
    this.laps = trackDef.laps;
    this.onCheckpoint = onCheckpoint;
    this.halfSpan = path.width / 2 + 9;
    this.reset(0);
  }

  reset(raceStart) {
    this.next = 1;
    this.lap = 0;
    this.lastSide = null;
    this.lapStart = raceStart;
    this.finished = false;
  }

  /** Lado de la puerta `next` en el que está el coche (o null si está fuera del ancho). */
  side(gate, x, z) {
    const dx = x - gate.position[0];
    const dz = z - gate.position[2];
    const along = dx * gate.tangent[0] + dz * gate.tangent[2];
    const lateral = dx * gate.right[0] + dz * gate.right[2];
    if (Math.abs(lateral) > this.halfSpan || Math.abs(along) > 25) return null;
    return along >= 0 ? 1 : -1;
  }

  update(x, z, now) {
    if (this.finished) return;
    const gate = this.gates[this.next];
    const s = this.side(gate, x, z);
    if (this.lastSide === -1 && s === 1) {
      const id = this.next;
      this.onCheckpoint(id);
      this.next = (id + 1) % this.count;
      if (id === 0) {
        this.lap += 1;
        this.lapStart = now;
        if (this.lap >= this.laps) this.finished = true;
      }
      this.lastSide = null;
      return;
    }
    if (s !== null) this.lastSide = s;
  }

  /** Puerta a la que volver si el coche vuelca o se sale (la última superada). */
  get lastGate() {
    return this.gates[(this.next - 1 + this.count) % this.count];
  }
}

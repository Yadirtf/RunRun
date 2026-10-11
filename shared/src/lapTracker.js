// Seguimiento del progreso de un coche a lo largo de la pista.
// La distancia recorrida solo avanza siguiendo la línea central: si un coche "salta"
// (atajo por el césped, teletransporte o trampa), ese tramo no cuenta y no completa la vuelta.
import { MAX_PLAUSIBLE_SPEED } from './constants.js';

export class LapTracker {
  /**
   * @param {import('./track.js').TrackLayout} layout
   * @param {number} totalLaps
   */
  constructor(layout, totalLaps) {
    this.layout = layout;
    this.totalLaps = totalLaps;
    this.reset();
  }

  reset() {
    this.hint = -1;
    this.lastS = 0;
    this.lastTime = 0;
    this.distance = 0;
    this.started = false;
    this.lapsDone = 0;
    this.lapStart = 0;
    this.lapTimes = [];
    this.bestLap = null;
    this.finished = false;
    this.finishTime = null;
    this.wrongWay = 0;
    this.lateral = 0;
  }

  /**
   * Coloca el coche en la parrilla (antes de la salida). `raceStart` es el instante (ms) de la salida.
   */
  place(x, z, raceStart) {
    const p = this.layout.project(x, z);
    const L = this.layout.length;
    this.hint = p.i;
    this.lastS = p.s;
    this.distance = p.s > L / 2 ? p.s - L : p.s;
    this.lastTime = raceStart;
    this.lapStart = raceStart;
    this.started = true;
  }

  /** Vuelta actual (1-indexada) para mostrar en el HUD. */
  get currentLap() { return Math.min(this.lapsDone + 1, this.totalLaps); }

  /** Métrica de clasificación: mayor = más adelante. */
  get progress() {
    if (this.finished) return this.totalLaps * this.layout.length + 1e6 - this.finishTime / 1000;
    return this.distance;
  }

  /**
   * Procesa una nueva muestra de posición en el instante `time` (ms del reloj de carrera común).
   * Devuelve una lista de eventos: { type: 'lap', lap, lapTime, best } | { type: 'finish', time }.
   */
  update(x, z, time) {
    const events = [];
    if (!this.started || this.finished) return events;
    const L = this.layout.length;
    const p = this.layout.project(x, z, this.hint);
    this.hint = p.i;
    this.lateral = p.lateral;

    let ds = p.s - this.lastS;
    if (ds < -L / 2) ds += L;
    if (ds > L / 2) ds -= L;
    const dt = Math.max((time - this.lastTime) / 1000, 1 / 120);
    const plausible = Math.abs(ds) <= MAX_PLAUSIBLE_SPEED * dt + 15 && p.dist < this.layout.halfWidth + 45;

    if (plausible) {
      const before = this.distance;
      this.distance += ds;
      this.wrongWay = ds < -0.05 ? Math.min(this.wrongWay + dt, 5) : Math.max(this.wrongWay - dt * 2, 0);

      while (!this.finished && this.distance >= (this.lapsDone + 1) * L) {
        const lineDist = (this.lapsDone + 1) * L;
        const frac = ds > 0 ? (lineDist - before) / (this.distance - before) : 1;
        const crossTime = this.lastTime + (time - this.lastTime) * Math.min(Math.max(frac, 0), 1);
        const lapTime = Math.round(crossTime - this.lapStart);
        this.lapsDone++;
        this.lapStart = crossTime;
        this.lapTimes.push(lapTime);
        if (this.bestLap === null || lapTime < this.bestLap) this.bestLap = lapTime;
        events.push({ type: 'lap', lap: this.lapsDone, lapTime, best: this.bestLap });
        if (this.lapsDone >= this.totalLaps) {
          this.finished = true;
          this.finishTime = Math.round(crossTime);
          events.push({ type: 'finish', time: this.finishTime });
        }
      }
    }
    this.lastS = p.s;
    this.lastTime = time;
    return events;
  }
}

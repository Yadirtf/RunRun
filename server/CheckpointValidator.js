import { buildTrackPath, checkpointGates, forwardDistance } from '@runrun/shared/trackPath';

/**
 * Validación server-side de checkpoints y vueltas. El cliente solo informa
 * "pasé el checkpoint N"; el servidor comprueba el orden y que el tiempo desde
 * el anterior sea físicamente posible, y cronometra con su propio reloj.
 */
export class CheckpointValidator {
  /**
   * @param {object} trackDef definición de pista (shared/tracks)
   * @param {{maxSpeedMs?: number}} [opts] velocidad máxima plausible en m/s
   */
  constructor(trackDef, { maxSpeedMs = 90 } = {}) {
    this.laps = trackDef.laps;
    this.count = trackDef.checkpoints;
    const path = buildTrackPath(trackDef, 2);
    const gates = checkpointGates(path, this.count);
    // Tiempo mínimo para ir del checkpoint i-1 al i.
    this.minSegmentMs = gates.map((g, i) => {
      const prev = gates[(i - 1 + this.count) % this.count];
      return (forwardDistance(path, prev.s, g.s) / maxSpeedMs) * 1000;
    });
    this.trackLength = path.length;
  }

  createState(startTime) {
    return {
      lap: 0, // vueltas completadas
      nextCheckpoint: 1, // la salida está detrás de la meta: el primero es el 1
      lastCheckpointAt: startTime,
      lapStartedAt: startTime,
      lapTimes: [],
      bestLap: null,
      finishedAt: null,
      totalTime: null,
    };
  }

  /**
   * @returns {{ok: false, reason: string} | {ok: true, lapCompleted?: {lapNumber, lapTime}, finished?: boolean}}
   */
  validate(state, checkpointId, now) {
    if (state.finishedAt !== null) return { ok: false, reason: 'finished' };
    if (checkpointId !== state.nextCheckpoint) return { ok: false, reason: 'out_of_order' };
    if (now - state.lastCheckpointAt < this.minSegmentMs[checkpointId]) {
      return { ok: false, reason: 'too_fast' };
    }

    state.lastCheckpointAt = now;
    state.nextCheckpoint = (checkpointId + 1) % this.count;
    if (checkpointId !== 0) return { ok: true };

    const lapTime = now - state.lapStartedAt;
    state.lap += 1;
    state.lapTimes.push(lapTime);
    state.lapStartedAt = now;
    if (state.bestLap === null || lapTime < state.bestLap) state.bestLap = lapTime;

    const result = { ok: true, lapCompleted: { lapNumber: state.lap, lapTime } };
    if (state.lap >= this.laps) {
      state.finishedAt = now;
      state.totalTime = state.lapTimes.reduce((a, b) => a + b, 0);
      result.finished = true;
    }
    return result;
  }

  /** Progreso comparable entre jugadores: checkpoints superados en total. */
  progressOf(state) {
    const passed = state.nextCheckpoint === 0 ? this.count - 1 : state.nextCheckpoint - 1;
    return state.lap * this.count + passed;
  }
}

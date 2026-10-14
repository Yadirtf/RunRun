import { ROOM_STATUS, MAX_PLAYERS, COUNTDOWN_MS, LOADING_TIMEOUT_MS } from '@runrun/shared/protocol';
import { getTrack, DEFAULT_TRACK_ID, TRACKS } from '@runrun/shared/tracks';
import { getCar, CARS, PLAYER_COLORS } from '@runrun/shared/cars';
import { CheckpointValidator } from './CheckpointValidator.js';
import { PowerupManager } from './PowerupManager.js';

/**
 * Agregado de dominio "Sala": jugadores, host, pista elegida y estado de la
 * carrera. No sabe nada de sockets; devuelve resultados que la capa de
 * transporte traduce a eventos.
 */
export class Room {
  constructor(code, { now = Date.now } = {}) {
    this.code = code;
    this.now = now;
    this.players = new Map();
    this.hostId = null;
    this.status = ROOM_STATUS.LOBBY;
    this.trackId = DEFAULT_TRACK_ID;
    this.startTime = null;
    this.validator = null;
    this.results = [];
    this.lastActivity = now();
    this.raceDeadline = null;
    this.loadingDeadline = null;
    this.loaded = new Set();
    this.maxDurationMs = 10 * 60 * 1000;
    /** Opción de sala: carrera con poderes (por defecto) o carrera limpia. */
    this.powerupsEnabled = true;
    this.powerups = null;
  }

  get size() {
    return this.players.size;
  }

  /** Color preferido si es de la paleta y está libre; si no, el primero libre. */
  pickColor(preferred, exceptId) {
    const taken = new Set([...this.players.values()].filter((p) => p.id !== exceptId).map((p) => p.color));
    if (PLAYER_COLORS.includes(preferred) && !taken.has(preferred)) return preferred;
    return PLAYER_COLORS.find((c) => !taken.has(c)) ?? PLAYER_COLORS[0];
  }

  addPlayer(id, { nickname, carModel, color }) {
    if (this.players.size >= MAX_PLAYERS) return { error: `La sala está llena (máx. ${MAX_PLAYERS} jugadores).` };
    if (this.status !== ROOM_STATUS.LOBBY) return { error: 'La carrera ya empezó. Espera a que termine.' };
    const usedSlots = new Set([...this.players.values()].map((p) => p.slot));
    let slot = 0;
    while (usedSlots.has(slot)) slot++;
    const player = {
      id,
      nickname,
      carModel: CARS[carModel] ? carModel : getCar().id,
      color: this.pickColor(color),
      slot,
      isHost: this.players.size === 0,
      ready: false,
      race: null,
    };
    if (player.isHost) this.hostId = id;
    this.players.set(id, player);
    this.touch();
    return { player };
  }

  /** @returns {{newHostId?: string}} */
  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return {};
    this.players.delete(id);
    this.loaded.delete(id);
    this.powerups?.removePlayer(id);
    this.touch();
    if (player.isHost && this.players.size > 0) {
      const next = [...this.players.values()].sort((a, b) => a.slot - b.slot)[0];
      next.isHost = true;
      this.hostId = next.id;
      return { newHostId: next.id };
    }
    return {};
  }

  setReady(id, ready) {
    const p = this.players.get(id);
    if (!p || this.status !== ROOM_STATUS.LOBBY) return false;
    p.ready = Boolean(ready);
    this.touch();
    return true;
  }

  selectCar(id, carModel, color) {
    const p = this.players.get(id);
    if (!p || this.status !== ROOM_STATUS.LOBBY || !CARS[carModel]) return false;
    p.carModel = carModel;
    // Solo cambia si el color pedido está libre; si no, conserva el actual.
    if (color && this.pickColor(color, id) === color) p.color = color;
    this.touch();
    return true;
  }

  selectTrack(id, trackId) {
    if (id !== this.hostId || this.status !== ROOM_STATUS.LOBBY || !TRACKS[trackId]) return false;
    this.trackId = trackId;
    this.touch();
    return true;
  }

  setOptions(id, { powerups } = {}) {
    if (id !== this.hostId || this.status !== ROOM_STATUS.LOBBY) return false;
    if (typeof powerups === 'boolean') this.powerupsEnabled = powerups;
    this.touch();
    return true;
  }

  /** El host siempre cuenta como listo; el resto debe marcar [LISTO]. */
  canStart(id) {
    if (id !== this.hostId) return { error: 'Solo el anfitrión puede iniciar la carrera.' };
    if (this.status !== ROOM_STATUS.LOBBY) return { error: 'La carrera ya está en curso.' };
    const pending = [...this.players.values()].filter((p) => !p.isHost && !p.ready);
    if (pending.length) return { error: `Esperando a: ${pending.map((p) => p.nickname).join(', ')}` };
    return { ok: true };
  }

  /**
   * El host lanza la carrera: todos pasan a cargar la pista (LOADING). La
   * cuenta atrás empieza cuando todos confirman la carga o vence el plazo.
   */
  startRace(id, { maxDurationMs = 10 * 60 * 1000 } = {}) {
    const check = this.canStart(id);
    if (check.error) return check;
    const track = getTrack(this.trackId);
    this.validator = new CheckpointValidator(track);
    this.maxDurationMs = maxDurationMs;
    this.status = ROOM_STATUS.LOADING;
    this.loaded = new Set();
    this.loadingDeadline = this.now() + LOADING_TIMEOUT_MS;
    this.startTime = null;
    this.results = [];
    this.powerups = null;
    for (const p of this.players.values()) p.race = null;
    this.touch();
    return { ok: true, trackId: this.trackId, laps: track.laps, powerups: this.powerupsEnabled };
  }

  /** @returns {{startTime: number} | null} la hora de salida si ya están todos. */
  markLoaded(id) {
    if (this.status !== ROOM_STATUS.LOADING || !this.players.has(id)) return null;
    this.loaded.add(id);
    return this.allLoaded() ? this.beginCountdown() : null;
  }

  allLoaded() {
    return [...this.players.keys()].every((pid) => this.loaded.has(pid));
  }

  beginCountdown() {
    this.startTime = this.now() + COUNTDOWN_MS;
    this.raceDeadline = this.startTime + this.maxDurationMs;
    this.loadingDeadline = null;
    this.status = ROOM_STATUS.COUNTDOWN;
    for (const p of this.players.values()) p.race = this.validator.createState(this.startTime);
    if (this.powerupsEnabled) {
      this.powerups = new PowerupManager(getTrack(this.trackId), { now: this.now });
      for (const id of this.players.keys()) this.powerups.addPlayer(id);
    }
    this.touch();
    return { startTime: this.startTime };
  }

  /**
   * Reloj de la sala. Devuelve un evento si hubo transición observable:
   * `{countdown}` al empezar la cuenta atrás o `{results}` al acabar la carrera.
   */
  tick() {
    if (this.status === ROOM_STATUS.LOADING && (this.allLoaded() || this.now() >= this.loadingDeadline)) {
      return { countdown: this.beginCountdown() };
    }
    if (this.status === ROOM_STATUS.COUNTDOWN && this.now() >= this.startTime) this.status = ROOM_STATUS.RACING;
    if (this.status === ROOM_STATUS.RACING && this.raceDeadline && this.now() >= this.raceDeadline) {
      return { results: this.finishRace().results };
    }
    return null;
  }

  passCheckpoint(id, checkpointId) {
    if (this.status === ROOM_STATUS.COUNTDOWN && this.now() >= this.startTime) this.status = ROOM_STATUS.RACING;
    const p = this.players.get(id);
    if (!p || !p.race || this.status !== ROOM_STATUS.RACING) return { ok: false, reason: 'not_racing' };
    const res = this.validator.validate(p.race, checkpointId, this.now());
    if (res.ok) {
      this.touch();
      this.powerups?.setRace(id, this.validator.progressOf(p.race), Boolean(res.finished));
    }
    if (res.finished) {
      this.results.push(this.resultOf(p));
      // Tras el ganador, el resto tiene 60 s para cruzar la meta.
      const grace = this.now() + 60_000;
      if (this.results.length === 1 && grace < this.raceDeadline) this.raceDeadline = grace;
      if (this.results.length === this.players.size) res.raceResults = this.finishRace().results;
    }
    return res;
  }

  resultOf(p) {
    return {
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      carModel: p.carModel,
      totalTime: p.race?.totalTime ?? null,
      bestLap: p.race?.bestLap ?? null,
      laps: p.race?.lap ?? 0,
      finished: p.race?.finishedAt != null,
    };
  }

  finishRace() {
    if (this.status === ROOM_STATUS.FINISHED) return { results: this.results };
    this.status = ROOM_STATUS.FINISHED;
    const finishedIds = new Set(this.results.map((r) => r.id));
    const dnf = [...this.players.values()]
      .filter((p) => !finishedIds.has(p.id))
      .sort((a, b) => this.validator.progressOf(b.race) - this.validator.progressOf(a.race))
      .map((p) => this.resultOf(p));
    this.results = [...this.results, ...dnf].map((r, i) => ({ ...r, position: i + 1 }));
    return { results: this.results };
  }

  returnToLobby(id) {
    if (id !== this.hostId || this.status !== ROOM_STATUS.FINISHED) return false;
    this.status = ROOM_STATUS.LOBBY;
    this.startTime = null;
    this.raceDeadline = null;
    this.loaded = new Set();
    this.powerups = null;
    for (const p of this.players.values()) {
      p.ready = false;
      p.race = null;
    }
    this.touch();
    return true;
  }

  leaderboard() {
    if (!this.validator) return [];
    const finishOrder = new Map(this.results.map((r, i) => [r.id, i]));
    return [...this.players.values()]
      .filter((p) => p.race)
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        color: p.color,
        lap: p.race.lap,
        nextCheckpoint: p.race.nextCheckpoint,
        progress: this.validator.progressOf(p.race),
        lastCheckpointAt: p.race.lastCheckpointAt,
        bestLap: p.race.bestLap,
        finished: p.race.finishedAt !== null,
      }))
      .sort((a, b) => {
        const fa = finishOrder.get(a.id) ?? Infinity;
        const fb = finishOrder.get(b.id) ?? Infinity;
        if (fa !== fb) return fa - fb;
        if (b.progress !== a.progress) return b.progress - a.progress;
        return a.lastCheckpointAt - b.lastCheckpointAt;
      });
  }

  /** Los poderes solo funcionan con la carrera en marcha. */
  get racingPowerups() {
    if (this.status === ROOM_STATUS.COUNTDOWN && this.now() >= this.startTime) this.status = ROOM_STATUS.RACING;
    return this.status === ROOM_STATUS.RACING ? this.powerups : null;
  }

  touch() {
    this.lastActivity = this.now();
  }

  /** Vista pública serializable (sin estado interno de validación). */
  toJSON() {
    return {
      code: this.code,
      hostId: this.hostId,
      status: this.status,
      trackId: this.trackId,
      startTime: this.startTime,
      powerups: this.powerupsEnabled,
      players: [...this.players.values()]
        .sort((a, b) => a.slot - b.slot)
        .map(({ id, nickname, carModel, color, slot, isHost, ready }) => ({ id, nickname, carModel, color, slot, isHost, ready })),
    };
  }
}

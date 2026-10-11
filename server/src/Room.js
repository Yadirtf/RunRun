// Una sala de carrera. No conoce Socket.io: recibe acciones y devuelve/emite mensajes
// a través de `send`, lo que la hace fácil de probar.
import {
  PHASE, MAX_PLAYERS, MIN_LAPS, MAX_LAPS, COUNTDOWN_MS, FINISH_GRACE_MS, RACE_TIMEOUT_MS,
  RECONNECT_GRACE_MS, PAINT_COLORS, CAR_IDS, DEFAULT_CAR_ID, TRACK_IDS, DEFAULT_TRACK_ID,
  EV, LapTracker, getTrackLayout, getTrackInfo, sanitizeNickname,
} from '@ranran/shared';
import { randomId } from './ids.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export class Room {
  /**
   * @param {string} code
   * @param {(target: {room?: boolean, socketId?: string}, event: string, payload: any) => void} send
   * @param {() => number} now
   */
  constructor(code, send, now = Date.now) {
    this.code = code;
    this.send = send;
    this.now = now;
    this.players = new Map(); // id -> player
    this.hostId = null;
    this.phase = PHASE.LOBBY;
    this.settings = { trackId: DEFAULT_TRACK_ID, laps: getTrackInfo(DEFAULT_TRACK_ID).defaultLaps };
    this.race = null;
    this.emptySince = now();
  }

  get size() { return this.players.size; }
  get connectedPlayers() { return [...this.players.values()].filter((p) => p.connected); }

  // ---------- Jugadores ----------

  addPlayer({ socketId, sessionId, nickname, carId, color }) {
    const existing = [...this.players.values()].find((p) => p.sessionId === sessionId);
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      existing.disconnectedAt = null;
      this.broadcastState();
      return { player: existing };
    }
    if (this.players.size >= MAX_PLAYERS) return { error: 'La sala está llena (máximo 8 pilotos).' };
    const name = sanitizeNickname(nickname);
    if (!name) return { error: 'El apodo debe tener entre 3 y 16 caracteres.' };

    const usedColors = new Set([...this.players.values()].map((p) => p.color));
    const player = {
      id: randomId(8),
      sessionId,
      socketId,
      nickname: this.#uniqueName(name),
      carId: CAR_IDS.includes(carId) ? carId : DEFAULT_CAR_ID,
      color: PAINT_COLORS.includes(color) && !usedColors.has(color)
        ? color
        : PAINT_COLORS.find((c) => !usedColors.has(c)) ?? PAINT_COLORS[0],
      ready: false,
      connected: true,
      disconnectedAt: null,
      joinedAt: this.now(),
      racing: false,
      state: null,
      stateAt: 0,
      tracker: null,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.emptySince = null;
    this.broadcastState();
    return { player };
  }

  #uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.nickname.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  /** El socket se cayó: se guarda el hueco un tiempo por si vuelve. */
  disconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = this.now();
    this.#ensureHost();
    this.broadcastState();
  }

  removePlayer(playerId) {
    if (!this.players.delete(playerId)) return;
    if (this.players.size === 0) this.emptySince = this.now();
    this.#ensureHost();
    this.broadcastState();
    this.#checkRaceEnd();
  }

  #ensureHost() {
    const host = this.players.get(this.hostId);
    if (host && host.connected) return;
    const next = this.connectedPlayers.sort((a, b) => a.joinedAt - b.joinedAt)[0];
    const prev = this.hostId;
    this.hostId = next ? next.id : (host ? host.id : null);
    if (next && prev !== next.id) {
      this.send({ room: true }, EV.NOTICE, { text: `${next.nickname} es ahora el anfitrión.` });
    }
  }

  updateProfile(playerId, { carId, color }) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== PHASE.LOBBY) return;
    if (CAR_IDS.includes(carId)) p.carId = carId;
    if (PAINT_COLORS.includes(color)) p.color = color;
    this.broadcastState();
  }

  setReady(playerId, ready) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== PHASE.LOBBY) return;
    p.ready = Boolean(ready);
    this.broadcastState();
  }

  updateSettings(playerId, { trackId, laps }) {
    if (playerId !== this.hostId || this.phase !== PHASE.LOBBY) return;
    if (TRACK_IDS.includes(trackId) && trackId !== this.settings.trackId) {
      this.settings.trackId = trackId;
      this.settings.laps = getTrackInfo(trackId).defaultLaps;
    }
    if (Number.isInteger(laps)) this.settings.laps = clamp(laps, MIN_LAPS, MAX_LAPS);
    this.broadcastState();
  }

  // ---------- Carrera ----------

  canStart() {
    const others = this.connectedPlayers.filter((p) => p.id !== this.hostId);
    return this.phase === PHASE.LOBBY && others.every((p) => p.ready);
  }

  startRace(playerId) {
    if (playerId !== this.hostId) return { error: 'Solo el anfitrión puede iniciar la carrera.' };
    if (!this.canStart()) return { error: 'Faltan pilotos por marcar "Listo".' };

    const layout = getTrackLayout(this.settings.trackId);
    const racers = this.connectedPlayers.sort((a, b) => a.joinedAt - b.joinedAt);
    const slots = layout.gridSlots(racers.length);
    const goAt = this.now() + COUNTDOWN_MS;
    this.phase = PHASE.COUNTDOWN;
    this.race = { goAt, layout, laps: this.settings.laps, firstFinishAt: null, results: null };

    const grid = racers.map((p, i) => {
      p.racing = true;
      p.state = null;
      p.tracker = new LapTracker(layout, this.settings.laps);
      p.tracker.place(slots[i].x, slots[i].z, 0);
      p.finishTime = null;
      return { id: p.id, slot: i, x: slots[i].x, z: slots[i].z, yaw: slots[i].yaw };
    });
    for (const p of this.players.values()) if (!p.connected) p.racing = false;

    this.send({ room: true }, EV.COUNTDOWN, {
      goAt,
      trackId: this.settings.trackId,
      laps: this.settings.laps,
      grid,
    });
    this.broadcastState();
    return { ok: true };
  }

  /** Estado del coche enviado por su piloto (≈20 Hz). */
  receiveState(playerId, s) {
    const p = this.players.get(playerId);
    if (!p || !p.racing || !s || typeof s !== 'object') return;
    if (this.phase !== PHASE.RACING && this.phase !== PHASE.COUNTDOWN && this.phase !== PHASE.FINISHED) return;
    const pos = s.p, q = s.q;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(finite)) return;
    if (!Array.isArray(q) || q.length !== 4 || !q.every(finite)) return;
    if (pos.some((v) => Math.abs(v) > 20000)) return;

    const now = this.now();
    p.state = {
      p: pos.map((v) => Math.round(v * 100) / 100),
      q: q.map((v) => Math.round(v * 1000) / 1000),
      v: finite(s.v) ? clamp(s.v, -100, 150) : 0,
      st: finite(s.st) ? clamp(s.st, -1, 1) : 0,
      r: finite(s.r) ? clamp(s.r, 0, 12000) : 0,
      g: Number.isInteger(s.g) ? clamp(s.g, -1, 8) : 1,
      b: s.b ? 1 : 0,
      sl: finite(s.sl) ? clamp(s.sl, 0, 1) : 0,
    };
    p.stateAt = now;

    if (this.phase !== PHASE.RACING || !p.tracker || p.tracker.finished) return;
    const serverRaceTime = now - this.race.goAt;
    // Se usa el reloj del cliente (más preciso) si no se aleja demasiado del servidor.
    const t = finite(s.t) && Math.abs(s.t - serverRaceTime) < 1500 ? s.t : serverRaceTime;
    for (const ev of p.tracker.update(pos[0], pos[2], t)) {
      if (ev.type === 'lap') {
        this.send({ room: true }, EV.LAP, { id: p.id, lap: ev.lap, lapTime: ev.lapTime, best: ev.best });
      } else if (ev.type === 'finish') {
        p.finishTime = ev.time;
        if (this.race.firstFinishAt === null) this.race.firstFinishAt = now;
        const position = this.#ranking().findIndex((r) => r.id === p.id) + 1;
        this.send({ room: true }, EV.PLAYER_FINISHED, { id: p.id, time: ev.time, position });
        this.#checkRaceEnd();
      }
    }
  }

  #racers() { return [...this.players.values()].filter((p) => p.racing && p.tracker); }

  #ranking() {
    return this.#racers()
      .map((p) => ({ id: p.id, progress: p.tracker.progress, p }))
      .sort((a, b) => b.progress - a.progress);
  }

  /** Bucle del servidor (≈20 Hz): transiciones de fase e instantáneas. */
  tick() {
    const now = this.now();
    // Limpia jugadores que no volvieron a tiempo.
    for (const p of [...this.players.values()]) {
      if (!p.connected && now - p.disconnectedAt > RECONNECT_GRACE_MS) this.removePlayer(p.id);
    }

    if (this.phase === PHASE.COUNTDOWN && now >= this.race.goAt) {
      this.phase = PHASE.RACING;
      this.send({ room: true }, EV.RACE_GO, { goAt: this.race.goAt });
      this.broadcastState();
    }
    if (this.phase === PHASE.RACING) this.#checkRaceEnd();

    if (this.phase === PHASE.COUNTDOWN || this.phase === PHASE.RACING || this.phase === PHASE.FINISHED) {
      this.#broadcastSnapshot(now);
    }
  }

  #checkRaceEnd() {
    if (this.phase !== PHASE.RACING) return;
    const now = this.now();
    const active = this.#racers().filter((p) => p.connected || now - p.disconnectedAt < RECONNECT_GRACE_MS);
    const allDone = active.length === 0 || active.every((p) => p.tracker.finished);
    const graceOver = this.race.firstFinishAt !== null && now - this.race.firstFinishAt > FINISH_GRACE_MS;
    const timeout = now - this.race.goAt > RACE_TIMEOUT_MS;
    if (allDone || graceOver || timeout) this.#finishRace();
  }

  #finishRace() {
    this.phase = PHASE.FINISHED;
    const results = this.#ranking().map((r, i) => ({
      position: i + 1,
      id: r.id,
      nickname: r.p.nickname,
      carId: r.p.carId,
      color: r.p.color,
      finished: r.p.tracker.finished,
      time: r.p.finishTime,
      bestLap: r.p.tracker.bestLap,
      laps: r.p.tracker.lapsDone,
    }));
    this.race.results = results;
    this.send({ room: true }, EV.RESULTS, { results, trackId: this.settings.trackId, laps: this.race.laps });
    this.broadcastState();
  }

  backToLobby(playerId) {
    if (playerId !== this.hostId || this.phase !== PHASE.FINISHED) return;
    this.phase = PHASE.LOBBY;
    this.race = null;
    for (const p of this.players.values()) {
      p.ready = false;
      p.racing = false;
      p.tracker = null;
      p.state = null;
    }
    this.broadcastState();
  }

  #broadcastSnapshot(now) {
    const cars = [];
    const order = this.#ranking();
    order.forEach((r, i) => {
      const p = r.p;
      cars.push({
        id: p.id,
        pos: i + 1,
        lap: p.tracker.currentLap,
        fin: p.tracker.finished ? 1 : 0,
        ts: p.stateAt,
        ...(p.state ?? {}),
      });
    });
    this.send({ room: true }, EV.SNAPSHOT, { st: now, cars });
  }

  // ---------- Estado público ----------

  publicState() {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: { ...this.settings },
      canStart: this.canStart(),
      race: this.race ? { goAt: this.race.goAt, laps: this.race.laps, results: this.race.results } : null,
      players: [...this.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({
          id: p.id,
          nickname: p.nickname,
          carId: p.carId,
          color: p.color,
          ready: p.ready,
          connected: p.connected,
          racing: p.racing,
          isHost: p.id === this.hostId,
        })),
    };
  }

  broadcastState() {
    this.send({ room: true }, EV.ROOM_STATE, this.publicState());
  }
}

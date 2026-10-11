// Conexión con el servidor: Socket.io con reconexión, sincronización de reloj y
// un identificador de sesión para recuperar el sitio en la sala si se corta la conexión.
import { io } from 'socket.io-client';
import { EV } from '@ranran/shared';

function sessionId() {
  try {
    let id = sessionStorage.getItem('ranran.session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('ranran.session', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export class NetClient {
  constructor(url = import.meta.env.VITE_SERVER_URL || undefined) {
    this.sessionId = sessionId();
    this.offset = 0; // serverTime - clientTime
    this.rtt = 0;
    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      autoConnect: true,
    });
    this.listeners = new Map();
    this.socket.on('connect', () => this.syncClock());
    this.clockTimer = setInterval(() => this.syncClock(), 5000);
  }

  get connected() { return this.socket.connected; }

  on(event, fn) {
    this.socket.on(event, fn);
    return () => this.socket.off(event, fn);
  }

  serverNow() { return Date.now() + this.offset; }

  /** Varias medidas de ida y vuelta; se queda con la de menor latencia. */
  async syncClock(samples = 5) {
    if (!this.socket.connected) return;
    let best = null;
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      const res = await this.request(EV.PING, t0, 2000).catch(() => null);
      if (!res) continue;
      const t1 = Date.now();
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, offset: res.serverTime - (t0 + rtt / 2) };
    }
    if (best) {
      // Suaviza los cambios para no provocar saltos en los tiempos.
      this.offset = this.rtt === 0 ? best.offset : this.offset * 0.7 + best.offset * 0.3;
      this.rtt = best.rtt;
    }
  }

  request(event, payload, timeout = 6000) {
    return new Promise((resolve, reject) => {
      this.socket.timeout(timeout).emit(event, payload, (err, res) => (err ? reject(new Error('Sin respuesta del servidor')) : resolve(res)));
    });
  }

  createRoom(profile) { return this.request(EV.CREATE_ROOM, { ...profile, sessionId: this.sessionId }); }
  joinRoom(roomCode, profile) { return this.request(EV.JOIN_ROOM, { ...profile, roomCode, sessionId: this.sessionId }); }
  leaveRoom() { this.socket.emit(EV.LEAVE_ROOM); }
  updateProfile(profile) { this.socket.emit(EV.UPDATE_PROFILE, profile); }
  setReady(ready) { this.socket.emit(EV.SET_READY, ready); }
  updateSettings(settings) { this.socket.emit(EV.UPDATE_SETTINGS, settings); }
  startRace() { return this.request(EV.START_RACE, {}); }
  backToLobby() { this.socket.emit(EV.BACK_TO_LOBBY); }
  sendState(state) { this.socket.volatile.emit(EV.STATE, state); }

  dispose() {
    clearInterval(this.clockTimer);
    this.socket.close();
  }
}

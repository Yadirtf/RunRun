import { io } from 'socket.io-client';
import { EVENTS, decodeTransform } from '@runrun/shared/protocol';
import { SOCKET_URL } from '../config.js';

/**
 * Adaptador de infraestructura sobre Socket.io. Expone operaciones con nombre
 * de dominio (crear sala, enviar transformación...) y sincroniza el reloj con
 * el servidor para que la cuenta atrás sea simultánea en todos los clientes.
 */
export class SocketClient {
  constructor(url = SOCKET_URL) {
    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 8000,
      randomizationFactor: 0.4,
    });
    this.clockOffset = 0;
    this.socket.on('connect', () => this.syncClock());
  }

  get id() {
    return this.socket.id;
  }

  on(event, handler) {
    this.socket.on(event, handler);
    return () => this.socket.off(event, handler);
  }

  /** Varias muestras de ida y vuelta; se queda con la de menor latencia. */
  async syncClock(samples = 5) {
    let best = null;
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      const server = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000);
        this.socket.emit(EVENTS.TIME_SYNC, null, (now) => {
          clearTimeout(timer);
          resolve(now);
        });
      });
      if (server == null) continue;
      const t1 = Date.now();
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, offset: server - (t0 + t1) / 2 };
    }
    if (best) this.clockOffset = best.offset;
    return this.clockOffset;
  }

  serverNow = () => Date.now() + this.clockOffset;

  createRoom(nickname, carModel, color) {
    this.socket.emit(EVENTS.CREATE_ROOM, { nickname, carModel, color });
  }

  joinRoom(roomCode, nickname, carModel, color) {
    this.socket.emit(EVENTS.JOIN_ROOM, { roomCode, nickname, carModel, color });
  }

  leaveRoom() {
    this.socket.emit(EVENTS.LEAVE_ROOM);
  }

  setReady(ready) {
    this.socket.emit(EVENTS.PLAYER_READY, { ready });
  }

  selectTrack(trackId) {
    this.socket.emit(EVENTS.SELECT_TRACK, { trackId });
  }

  selectCar(carModel, color) {
    this.socket.emit(EVENTS.SELECT_CAR, { carModel, color });
  }

  sendChat(text) {
    this.socket.emit(EVENTS.CHAT_SEND, { text });
  }

  startRace() {
    this.socket.emit(EVENTS.START_RACE);
  }

  notifyLoaded() {
    this.socket.emit(EVENTS.PLAYER_LOADED);
  }

  returnToLobby() {
    this.socket.emit(EVENTS.RETURN_TO_LOBBY);
  }

  sendTransform(buffer) {
    this.socket.volatile.emit(EVENTS.UPDATE_TRANSFORM, buffer);
  }

  sendCheckpoint(checkpointId) {
    this.socket.emit(EVENTS.CHECKPOINT_PASSED, { checkpointId });
  }

  onPlayerMoved(handler) {
    return this.on(EVENTS.PLAYER_MOVED, (id, buffer) => {
      const t = decodeTransform(buffer);
      if (t) handler(id, t);
    });
  }
}

let instance = null;
export function getSocketClient() {
  instance ??= new SocketClient();
  return instance;
}

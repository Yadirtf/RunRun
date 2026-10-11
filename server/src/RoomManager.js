import { ROOM_CODE_LENGTH } from '@ranran/shared';
import { Room } from './Room.js';
import { roomCode } from './ids.js';

const EMPTY_ROOM_TTL_MS = 60_000;

/** Registro de salas activas y bucle de simulación del servidor. */
export class RoomManager {
  /**
   * @param {(roomCode: string, target: object, event: string, payload: any) => void} send
   */
  constructor(send, { maxRooms = 500, now = Date.now } = {}) {
    this.rooms = new Map();
    this.send = send;
    this.maxRooms = maxRooms;
    this.now = now;
  }

  create() {
    if (this.rooms.size >= this.maxRooms) return null;
    let code;
    do code = roomCode(ROOM_CODE_LENGTH); while (this.rooms.has(code));
    const room = new Room(code, (target, event, payload) => this.send(code, target, event, payload), this.now);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code ?? '').trim().toUpperCase()) ?? null;
  }

  tick() {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      room.tick();
      if (room.size === 0 && room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(code);
      }
    }
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.size;
    return { rooms: this.rooms.size, players };
  }
}

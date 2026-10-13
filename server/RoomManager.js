import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@runrun/shared/protocol';
import { Room } from './Room.js';

/** Registro de salas en memoria + índice jugador→sala + limpieza de salas inactivas. */
export class RoomManager {
  constructor({ now = Date.now, random = Math.random, idleMs = 30 * 60 * 1000 } = {}) {
    this.rooms = new Map();
    this.playerRoom = new Map();
    this.now = now;
    this.random = random;
    this.idleMs = idleMs;
  }

  generateCode() {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(this.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('No se pudo generar un código de sala único');
  }

  createRoom(playerId, profile) {
    this.leave(playerId);
    const room = new Room(this.generateCode(), { now: this.now });
    this.rooms.set(room.code, room);
    const { player } = room.addPlayer(playerId, profile);
    this.playerRoom.set(playerId, room.code);
    return { room, player };
  }

  joinRoom(code, playerId, profile) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'La sala no existe o ya cerró.' };
    if (room.players.has(playerId)) return { room, player: room.players.get(playerId) };
    const res = room.addPlayer(playerId, profile);
    if (res.error) return res;
    this.leave(playerId);
    this.playerRoom.set(playerId, code);
    return { room, player: res.player };
  }

  roomOf(playerId) {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) ?? null : null;
  }

  /** @returns {{room: Room, newHostId?: string, closed: boolean} | null} */
  leave(playerId) {
    const room = this.roomOf(playerId);
    if (!room) return null;
    this.playerRoom.delete(playerId);
    const { newHostId } = room.removePlayer(playerId);
    const closed = room.size === 0;
    if (closed) this.rooms.delete(room.code);
    return { room, newHostId, closed };
  }

  /** Elimina salas sin actividad; devuelve los códigos cerrados. */
  cleanup() {
    const closed = [];
    for (const [code, room] of this.rooms) {
      if (this.now() - room.lastActivity > this.idleMs) {
        for (const id of room.players.keys()) this.playerRoom.delete(id);
        this.rooms.delete(code);
        closed.push(code);
      }
    }
    return closed;
  }
}

// Traduce los eventos de Socket.io a acciones sobre las salas, con validación y límites.
import { EV, NET_SEND_HZ } from '@ranran/shared';

const MAX_STATE_PER_SEC = NET_SEND_HZ * 2;
const MAX_ACTIONS_PER_SEC = 10;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * @param {import('socket.io').Server} io
 * @param {import('./RoomManager.js').RoomManager} manager
 */
export function registerSocketHandlers(io, manager) {
  io.on('connection', (socket) => {
    /** Sala y jugador asociados a este socket. */
    const ctx = { room: null, playerId: null };
    const limits = { state: 0, actions: 0, windowStart: Date.now() };

    const allow = (kind) => {
      const now = Date.now();
      if (now - limits.windowStart >= 1000) { limits.state = 0; limits.actions = 0; limits.windowStart = now; }
      if (kind === 'state') return ++limits.state <= MAX_STATE_PER_SEC;
      return ++limits.actions <= MAX_ACTIONS_PER_SEC;
    };

    const reply = (ack, payload) => { if (typeof ack === 'function') ack(payload); };

    const leaveCurrent = () => {
      if (!ctx.room) return;
      socket.leave(ctx.room.code);
      ctx.room.removePlayer(ctx.playerId);
      ctx.room = null;
      ctx.playerId = null;
    };

    const enter = (room, data, ack) => {
      const result = room.addPlayer({
        socketId: socket.id,
        sessionId: str(data.sessionId, 64) || socket.id,
        nickname: data.nickname,
        carId: str(data.carId, 16),
        color: str(data.color, 16),
      });
      if (result.error) return reply(ack, { ok: false, error: result.error });
      ctx.room = room;
      ctx.playerId = result.player.id;
      socket.join(room.code);
      reply(ack, { ok: true, roomCode: room.code, playerId: result.player.id, room: room.publicState() });
    };

    socket.on(EV.PING, (clientTime, ack) => reply(ack, { clientTime, serverTime: Date.now() }));

    socket.on(EV.CREATE_ROOM, (data, ack) => {
      if (!allow('action') || !isObj(data)) return;
      leaveCurrent();
      const room = manager.create();
      if (!room) return reply(ack, { ok: false, error: 'El servidor está lleno, inténtalo en un momento.' });
      enter(room, data, ack);
      if (!ctx.room) manager.rooms.delete(room.code);
    });

    socket.on(EV.JOIN_ROOM, (data, ack) => {
      if (!allow('action') || !isObj(data)) return;
      const room = manager.get(data.roomCode);
      if (!room) return reply(ack, { ok: false, error: 'No existe ninguna sala con ese código.' });
      if (ctx.room && ctx.room !== room) leaveCurrent();
      enter(room, data, ack);
    });

    socket.on(EV.LEAVE_ROOM, () => leaveCurrent());

    socket.on(EV.UPDATE_PROFILE, (data) => {
      if (!ctx.room || !allow('action') || !isObj(data)) return;
      ctx.room.updateProfile(ctx.playerId, { carId: str(data.carId, 16), color: str(data.color, 16) });
    });

    socket.on(EV.SET_READY, (ready) => {
      if (!ctx.room || !allow('action')) return;
      ctx.room.setReady(ctx.playerId, ready === true);
    });

    socket.on(EV.UPDATE_SETTINGS, (data) => {
      if (!ctx.room || !allow('action') || !isObj(data)) return;
      ctx.room.updateSettings(ctx.playerId, { trackId: str(data.trackId, 32), laps: data.laps });
    });

    socket.on(EV.START_RACE, (_data, ack) => {
      if (!ctx.room || !allow('action')) return;
      const r = ctx.room.startRace(ctx.playerId);
      reply(ack, r.error ? { ok: false, error: r.error } : { ok: true });
    });

    socket.on(EV.BACK_TO_LOBBY, () => {
      if (!ctx.room || !allow('action')) return;
      ctx.room.backToLobby(ctx.playerId);
    });

    socket.on(EV.STATE, (state) => {
      if (!ctx.room || !allow('state')) return;
      ctx.room.receiveState(ctx.playerId, state);
    });

    socket.on('disconnect', () => {
      if (ctx.room) ctx.room.disconnect(ctx.playerId);
    });
  });
}

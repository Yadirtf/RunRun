import {
  EVENTS, ROOM_STATUS, TRANSFORM_FLOATS,
  sanitizeNickname, normalizeRoomCode,
} from '@runrun/shared/protocol';

/**
 * Capa de transporte: traduce eventos Socket.io a operaciones del dominio
 * (RoomManager / Room) y los resultados de vuelta a eventos. Toda la lógica de
 * reglas vive en el dominio; aquí solo hay validación de entrada y difusión.
 */
export function registerSocketHandlers(io, rooms, { log = console } = {}) {
  const broadcastState = (room) => io.to(room.code).emit(EVENTS.ROOM_STATE, room.toJSON());

  const emitCountdown = (room, startTime) => {
    io.to(room.code).emit(EVENTS.RACE_STARTED, { startTime, serverNow: Date.now() });
    broadcastState(room);
  };

  const emitRaceFinished = (room, results) => {
    io.to(room.code).emit(EVENTS.RACE_FINISHED, { results });
    broadcastState(room);
  };

  io.on('connection', (socket) => {
    const fail = (message) => socket.emit(EVENTS.ERROR_MESSAGE, message);
    const myRoom = () => rooms.roomOf(socket.id);

    const handleLeave = () => {
      const left = rooms.leave(socket.id);
      if (!left) return;
      const { room, newHostId, closed } = left;
      socket.leave(room.code);
      if (closed) return;
      io.to(room.code).emit(EVENTS.PLAYER_LEFT, { id: socket.id });
      if (newHostId) io.to(room.code).emit(EVENTS.HOST_TRANSFER, { newHostId });
      // Si solo faltaba él por cargar, arrancar la cuenta atrás ya.
      if (room.status === ROOM_STATUS.LOADING && room.allLoaded()) {
        emitCountdown(room, room.beginCountdown().startTime);
        return;
      }
      // Si el que se fue era el único que faltaba por llegar, cerrar la carrera.
      if (room.status === ROOM_STATUS.RACING && room.results.length > 0 && room.results.length >= room.size) {
        emitRaceFinished(room, room.finishRace().results);
        return;
      }
      broadcastState(room);
    };

    socket.on(EVENTS.TIME_SYNC, (_payload, ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on(EVENTS.CREATE_ROOM, (payload = {}) => {
      const nickname = sanitizeNickname(payload.nickname);
      if (!nickname) return fail('El nombre debe tener entre 3 y 16 caracteres.');
      const { room, player } = rooms.createRoom(socket.id, { nickname, carModel: payload.carModel });
      socket.join(room.code);
      socket.emit(EVENTS.ROOM_CREATED, { roomCode: room.code, player, room: room.toJSON() });
      log.info?.(`[sala ${room.code}] creada por ${nickname}`);
    });

    socket.on(EVENTS.JOIN_ROOM, (payload = {}) => {
      const nickname = sanitizeNickname(payload.nickname);
      if (!nickname) return fail('El nombre debe tener entre 3 y 16 caracteres.');
      const code = normalizeRoomCode(payload.roomCode);
      if (!code) return fail('El código de sala no es válido.');
      const previous = myRoom();
      const res = rooms.joinRoom(code, socket.id, { nickname, carModel: payload.carModel });
      if (res.error) return fail(res.error);
      if (previous && previous.code !== code) socket.leave(previous.code);
      socket.join(code);
      socket.emit(EVENTS.ROOM_JOINED, { roomCode: code, player: res.player, room: res.room.toJSON() });
      io.to(code).emit(EVENTS.PLAYER_JOINED, { players: res.room.toJSON().players, newPlayer: res.player });
      broadcastState(res.room);
    });

    socket.on(EVENTS.PLAYER_READY, ({ ready = true } = {}) => {
      const room = myRoom();
      if (room?.setReady(socket.id, ready)) broadcastState(room);
    });

    socket.on(EVENTS.SELECT_CAR, ({ carModel } = {}) => {
      const room = myRoom();
      if (room?.selectCar(socket.id, carModel)) broadcastState(room);
    });

    socket.on(EVENTS.SELECT_TRACK, ({ trackId } = {}) => {
      const room = myRoom();
      if (room?.selectTrack(socket.id, trackId)) broadcastState(room);
    });

    socket.on(EVENTS.START_RACE, () => {
      const room = myRoom();
      if (!room) return fail('No estás en ninguna sala.');
      const res = room.startRace(socket.id);
      if (res.error) return fail(res.error);
      io.to(room.code).emit(EVENTS.RACE_LOADING, {
        trackId: res.trackId,
        laps: res.laps,
        players: room.toJSON().players,
      });
      broadcastState(room);
      log.info?.(`[sala ${room.code}] carrera en ${res.trackId} con ${room.size} jugadores`);
    });

    socket.on(EVENTS.PLAYER_LOADED, () => {
      const room = myRoom();
      const res = room?.markLoaded(socket.id);
      if (res) emitCountdown(room, res.startTime);
    });

    // Retransmisión binaria a 20 Hz: [id, Float32Array(10)] al resto de la sala.
    socket.on(EVENTS.UPDATE_TRANSFORM, (buffer) => {
      const room = myRoom();
      if (!room || !buffer || buffer.byteLength !== TRANSFORM_FLOATS * 4) return;
      room.touch();
      socket.volatile.to(room.code).emit(EVENTS.PLAYER_MOVED, socket.id, buffer);
    });

    socket.on(EVENTS.CHECKPOINT_PASSED, ({ checkpointId } = {}) => {
      const room = myRoom();
      if (!room || !Number.isInteger(checkpointId)) return;
      const res = room.passCheckpoint(socket.id, checkpointId);
      if (!res.ok) return;
      if (res.lapCompleted) {
        io.to(room.code).emit(EVENTS.LAP_COMPLETED, { playerId: socket.id, ...res.lapCompleted });
      }
      if (res.finished) {
        const result = room.results.find((r) => r.id === socket.id);
        io.to(room.code).emit(EVENTS.PLAYER_FINISHED, { ...result, position: room.results.length });
      }
      io.to(room.code).emit(EVENTS.LEADERBOARD_UPDATE, { leaderboard: room.leaderboard() });
      if (res.raceResults) emitRaceFinished(room, res.raceResults);
    });

    socket.on(EVENTS.RETURN_TO_LOBBY, () => {
      const room = myRoom();
      if (room?.returnToLobby(socket.id)) broadcastState(room);
    });

    socket.on(EVENTS.LEAVE_ROOM, handleLeave);
    socket.on('disconnect', handleLeave);
  });

  /** Reloj de carreras: transiciones COUNTDOWN→RACING, límite de tiempo y limpieza. */
  const raceClock = setInterval(() => {
    for (const room of rooms.rooms.values()) {
      const ev = room.tick();
      if (ev?.countdown) emitCountdown(room, ev.countdown.startTime);
      if (ev?.results) emitRaceFinished(room, ev.results);
    }
  }, 250);
  const cleanupTimer = setInterval(() => {
    for (const code of rooms.cleanup()) log.info?.(`[sala ${code}] cerrada por inactividad`);
  }, 60_000);

  return () => {
    clearInterval(raceClock);
    clearInterval(cleanupTimer);
  };
}

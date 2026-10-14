import { useEffect } from 'react';
import { EVENTS } from '@runrun/shared/protocol';
import { getSocketClient } from '../net/SocketClient.js';
import { useGameStore } from '../store/gameStore.js';

/**
 * Conecta los eventos del servidor con el store. Se monta una sola vez en App.
 * Devuelve el cliente para emitir acciones.
 */
export function useSocket() {
  const client = getSocketClient();

  useEffect(() => {
    const s = useGameStore.getState;
    let rejoining = false;
    const offs = [
      client.on('connect', () => {
        s().setConnection('connected', client.id);
        // Tras una reconexión el servidor nos ve como jugador nuevo: volver a la sala si seguía en espera.
        const { room, nickname, carModel, color } = s();
        if (room && room.status === 'LOBBY') {
          rejoining = true;
          client.joinRoom(room.code, nickname, carModel, color);
        }
        else if (room) s().leaveRoom();
      }),
      client.on('disconnect', () => s().setConnection('disconnected', null)),
      client.on('connect_error', () => s().setConnection('disconnected', null)),
      client.on(EVENTS.ROOM_CREATED, ({ room }) => s().setRoom(room)),
      client.on(EVENTS.ROOM_JOINED, ({ room }) => {
        rejoining = false;
        s().setRoom(room);
      }),
      client.on(EVENTS.ROOM_STATE, (room) => s().setRoom(room)),
      client.on(EVENTS.CHAT_MESSAGE, (msg) => s().addChat(msg)),
      client.on(EVENTS.PLAYER_JOINED, ({ newPlayer }) => {
        if (newPlayer && newPlayer.id !== client.id) s().addChat({ id: `join:${newPlayer.id}:${Date.now()}`, system: true, text: `${newPlayer.nickname} entró a la sala`, at: Date.now() });
      }),
      client.on(EVENTS.PLAYER_LEFT, ({ id }) => {
        const p = s().room?.players.find((x) => x.id === id);
        if (p) s().addChat({ id: `left:${id}:${Date.now()}`, system: true, text: `${p.nickname} salió de la sala`, at: Date.now() });
      }),
      client.on(EVENTS.RACE_LOADING, (race) => s().startLoading(race)),
      client.on(EVENTS.RACE_STARTED, ({ startTime }) => s().setStartTime(startTime)),
      client.on(EVENTS.LEADERBOARD_UPDATE, ({ leaderboard }) => s().setLeaderboard(leaderboard)),
      client.on(EVENTS.RACE_FINISHED, ({ results }) => s().setResults(results)),
      client.on(EVENTS.HOST_TRANSFER, ({ newHostId }) => {
        if (newHostId === client.id) s().showToast('Ahora eres el anfitrión de la sala', 'info');
      }),
      client.on(EVENTS.ERROR_MESSAGE, (msg) => {
        // Si la sala desapareció mientras estábamos desconectados, volver al inicio.
        if (rejoining) {
          rejoining = false;
          s().leaveRoom();
          s().showToast('Se perdió la conexión y la sala se cerró.');
          return;
        }
        s().showToast(msg);
      }),
    ];
    if (client.socket.connected) s().setConnection('connected', client.id);
    return () => offs.forEach((off) => off());
  }, [client]);

  return client;
}

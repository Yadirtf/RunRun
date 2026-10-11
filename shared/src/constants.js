// Constantes compartidas entre cliente y servidor.

export const MAX_PLAYERS = 8;
export const MIN_LAPS = 1;
export const MAX_LAPS = 10;
export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
export const ROOM_CODE_LENGTH = 5;

/** Frecuencia con la que el cliente envía su estado y el servidor difunde instantáneas. */
export const NET_SEND_HZ = 20;
/** Retardo de interpolación de los coches remotos (ms). */
export const INTERP_DELAY_MS = 120;

export const COUNTDOWN_MS = 7000;
/** Tras llegar el primero, el resto tiene este margen para terminar. */
export const FINISH_GRACE_MS = 45_000;
/** Duración máxima absoluta de una carrera. */
export const RACE_TIMEOUT_MS = 15 * 60_000;
/** Si un jugador se desconecta, se le guarda el sitio este tiempo. */
export const RECONNECT_GRACE_MS = 20_000;

/** Velocidad máxima plausible (m/s) usada por el servidor para descartar saltos. */
export const MAX_PLAUSIBLE_SPEED = 130;

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY',
  COUNTDOWN: 'COUNTDOWN',
  RACING: 'RACING',
  FINISHED: 'FINISHED',
});

export const PAINT_COLORS = Object.freeze([
  '#c1121f', '#f4d35e', '#1d4ed8', '#e5e7eb',
  '#16a34a', '#f97316', '#7c3aed', '#111827',
]);

/** Eventos de Socket.io (contrato de la API en tiempo real). */
export const EV = Object.freeze({
  // Cliente → servidor
  CREATE_ROOM: 'room:create',
  JOIN_ROOM: 'room:join',
  LEAVE_ROOM: 'room:leave',
  UPDATE_PROFILE: 'player:profile',
  SET_READY: 'player:ready',
  UPDATE_SETTINGS: 'room:settings',
  START_RACE: 'race:start',
  BACK_TO_LOBBY: 'race:lobby',
  STATE: 'car:state',
  PING: 'net:ping',
  // Servidor → cliente
  ROOM_STATE: 'room:state',
  SNAPSHOT: 'race:snapshot',
  COUNTDOWN: 'race:countdown',
  RACE_GO: 'race:go',
  LAP: 'race:lap',
  PLAYER_FINISHED: 'race:player-finished',
  RESULTS: 'race:results',
  NOTICE: 'room:notice',
});

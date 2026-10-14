/**
 * Contrato de red entre cliente y servidor (Socket.io). Ver tabla en
 * plan_maestro.md, "Eventos Socket.io". Los nombres viven aquí para que un
 * cambio rompa en compilación de ambos lados y no en producción.
 */
export const EVENTS = {
  CREATE_ROOM: 'create_room',
  ROOM_CREATED: 'room_created',
  JOIN_ROOM: 'join_room',
  ROOM_JOINED: 'room_joined',
  PLAYER_JOINED: 'player_joined',
  ROOM_STATE: 'room_state',
  PLAYER_READY: 'player_ready',
  SELECT_TRACK: 'select_track',
  SELECT_CAR: 'select_car',
  UPDATE_TRANSFORM: 'update_transform',
  PLAYER_MOVED: 'player_moved',
  START_RACE: 'start_race',
  RACE_LOADING: 'race_loading',
  PLAYER_LOADED: 'player_loaded',
  RACE_STARTED: 'race_started',
  CHECKPOINT_PASSED: 'checkpoint_passed',
  LEADERBOARD_UPDATE: 'leaderboard_update',
  LAP_COMPLETED: 'lap_completed',
  PLAYER_FINISHED: 'player_finished',
  RACE_FINISHED: 'race_finished',
  RETURN_TO_LOBBY: 'return_to_lobby',
  LEAVE_ROOM: 'leave_room',
  PLAYER_LEFT: 'player_left',
  HOST_TRANSFER: 'host_transfer',
  ERROR_MESSAGE: 'error_message',
  TIME_SYNC: 'time_sync',
  CHAT_SEND: 'chat_send',
  CHAT_MESSAGE: 'chat_message',
};

export const ROOM_STATUS = {
  LOBBY: 'LOBBY',
  LOADING: 'LOADING',
  COUNTDOWN: 'COUNTDOWN',
  RACING: 'RACING',
  FINISHED: 'FINISHED',
};

export const MAX_PLAYERS = 8;
export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
export const ROOM_CODE_LENGTH = 6;
/** Alfabeto sin caracteres ambiguos (0/O, 1/I/L) para dictar el código en voz alta. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const COUNTDOWN_MS = 3000;
/** Tiempo máximo esperando a que todos carguen la pista antes de la cuenta atrás. */
export const LOADING_TIMEOUT_MS = 20000;
export const TRANSFORM_HZ = 20;
/** Chat de sala: solo se retransmite en vivo, el servidor no guarda nada. */
export const CHAT_MAX = 200;
export const CHAT_BURST = 5;
export const CHAT_WINDOW_MS = 5000;

/**
 * Transformación binaria de un vehículo (Float32 x 10 = 40 bytes frente a
 * ~180 bytes en JSON): posición, rotación (cuaternión), velocidad km/h,
 * ángulo de dirección y giro acumulado de ruedas.
 */
export const TRANSFORM_FLOATS = 10;

export function encodeTransform(t) {
  const f = new Float32Array(TRANSFORM_FLOATS);
  f[0] = t.position.x; f[1] = t.position.y; f[2] = t.position.z;
  f[3] = t.rotation.x; f[4] = t.rotation.y; f[5] = t.rotation.z; f[6] = t.rotation.w;
  f[7] = t.speed; f[8] = t.steer; f[9] = t.wheelRotation;
  return f.buffer;
}

export function decodeTransform(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (bytes.byteLength !== TRANSFORM_FLOATS * 4) return null;
  const f = new Float32Array(bytes.slice().buffer);
  for (let i = 0; i < TRANSFORM_FLOATS; i++) if (!Number.isFinite(f[i])) return null;
  return {
    position: { x: f[0], y: f[1], z: f[2] },
    rotation: { x: f[3], y: f[4], z: f[5], w: f[6] },
    speed: f[7],
    steer: f[8],
    wheelRotation: f[9],
  };
}

export function sanitizeNickname(raw) {
  const clean = String(raw ?? '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, NICKNAME_MAX);
  return clean.length >= NICKNAME_MIN ? clean : null;
}

export function normalizeRoomCode(raw) {
  const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === ROOM_CODE_LENGTH ? code : null;
}

/** Texto de chat en una línea, sin caracteres de control; null si queda vacío. */
export function sanitizeChat(raw) {
  const clean = String(raw ?? '').replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
  return clean || null;
}

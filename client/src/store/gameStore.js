import { create } from 'zustand';
import { DEFAULT_CAR_ID, PLAYER_COLORS } from '@runrun/shared/cars';

const NICK_KEY = 'runrun:nickname';
const CAR_KEY = 'runrun:car';
const COLOR_KEY = 'runrun:color';
const QUALITY_KEY = 'runrun:quality';
const CHAT_KEEP = 100;
let chatSeq = 0;

function load(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* modo privado: no persistir */
  }
}

/**
 * Estado global de la aplicación (Zustand). La fase de la UI se deriva del
 * estado de la sala que manda el servidor (ver selectPhase).
 */
export const useGameStore = create((set) => ({
  connection: 'connecting',
  myId: null,
  nickname: load(NICK_KEY, ''),
  carModel: load(CAR_KEY, DEFAULT_CAR_ID),
  color: load(COLOR_KEY, PLAYER_COLORS[0]),
  quality: load(QUALITY_KEY, 'auto'),
  room: null,
  race: null,
  leaderboard: [],
  raceResults: null,
  lapEvents: [],
  /** Chat de la sala actual: vive solo en memoria y se borra al salir. */
  chat: [],
  toast: null,

  setConnection: (connection, myId) => set({ connection, myId }),
  setNickname: (nickname) => {
    save(NICK_KEY, nickname);
    set({ nickname });
  },
  setCarModel: (carModel) => {
    save(CAR_KEY, carModel);
    set({ carModel });
  },
  setColor: (color) => {
    save(COLOR_KEY, color);
    set({ color });
  },
  setQuality: (quality) => {
    save(QUALITY_KEY, quality);
    set({ quality });
  },
  setRoom: (room) => set((s) => (s.room && room && s.room.code !== room.code ? { room, chat: [] } : { room })),
  leaveRoom: () => set({ room: null, race: null, leaderboard: [], raceResults: null, chat: [] }),
  addChat: (msg) => set((s) => ({ chat: [...s.chat, { ...msg, seq: ++chatSeq }].slice(-CHAT_KEEP) })),
  startLoading: (race) => set({ race: { ...race, startTime: null }, leaderboard: [], raceResults: null }),
  setStartTime: (startTime) => set((s) => ({ race: s.race ? { ...s.race, startTime } : s.race })),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
  setResults: (raceResults) => set({ raceResults }),
  showToast: (message, kind = 'error') => set({ toast: { message, kind, id: Date.now() } }),
  clearToast: () => set({ toast: null }),
}));

/** LOBBY → WAITING_ROOM → RACE (carga, cuenta atrás, carrera y resultados). */
export function selectPhase(s) {
  if (!s.room) return 'LOBBY';
  if (s.room.status === 'LOBBY') return 'WAITING_ROOM';
  return 'RACE';
}

/** Telemetría del HUD (15 Hz) en un store aparte para no re-renderizar toda la app. */
export const useHudStore = create(() => ({ hud: null, loading: { progress: 0, label: '' } }));

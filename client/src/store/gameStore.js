// Estado global de la interfaz (Zustand). El motor 3D vive fuera de React y solo
// recibe/publica datos a través de aquí y de NetClient.
import { create } from 'zustand';
import { EV, PHASE, DEFAULT_CAR_ID, PAINT_COLORS, DEFAULT_TRACK_ID, getTrackInfo, getTrackLayout } from '@ranran/shared';
import { NetClient } from '../net/NetClient.js';

const PROFILE_KEY = 'ranran.profile';

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
    if (p && typeof p === 'object') return p;
  } catch { /* sin almacenamiento */ }
  return null;
}

function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
}

const defaultQuality = () => {
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  return mobile ? 'low' : 'high';
};

let net = null;

export const useGame = create((set, get) => {
  const stored = loadProfile();
  const initialRoom = new URLSearchParams(location.search).get('sala')?.toUpperCase() ?? '';

  const bindNet = () => {
    if (net) return net;
    net = new NetClient();
    net.on('connect', async () => {
      set({ connected: true });
      // Reconexión: vuelve a la sala con la misma sesión para recuperar el sitio.
      const { roomCode } = get();
      if (roomCode) {
        const res = await net.joinRoom(roomCode, get().profile).catch(() => null);
        if (!res?.ok) set({ roomCode: null, room: null, screen: 'menu', error: 'Se perdió la conexión con la sala.' });
      }
    });
    net.on('disconnect', () => set({ connected: false }));
    net.on(EV.ROOM_STATE, (room) => {
      const s = get();
      const patch = { room };
      // El servidor puede haber cambiado el color (si ya estaba cogido): manda el suyo.
      const me = room.players.find((p) => p.id === s.playerId);
      if (me && (me.color !== s.profile.color || me.carId !== s.profile.carId)) {
        patch.profile = { ...s.profile, color: me.color, carId: me.carId };
      }
      if (room.phase === PHASE.LOBBY && s.screen === 'race' && !s.practice) {
        patch.screen = 'lobby'; patch.race = null; patch.results = null;
      }
      if (room.phase === PHASE.LOBBY && s.screen !== 'race' && s.screen !== 'lobby') patch.screen = 'lobby';
      set(patch);
    });
    net.on(EV.COUNTDOWN, (race) => set({ race, results: null, screen: 'race', practice: false }));
    net.on(EV.RESULTS, ({ results }) => set({ results }));
    net.on(EV.NOTICE, ({ text }) => get().toast(text));
    return net;
  };

  return {
    screen: 'menu', // menu | lobby | race
    connected: false,
    profile: {
      nickname: stored?.nickname ?? '',
      carId: stored?.carId ?? DEFAULT_CAR_ID,
      color: stored?.color ?? PAINT_COLORS[0],
    },
    quality: stored?.quality ?? defaultQuality(),
    pendingRoomCode: initialRoom,
    roomCode: null,
    playerId: null,
    room: null,
    race: null,
    results: null,
    practice: false,
    error: null,
    notice: null,
    busy: false,

    net: () => bindNet(),

    toast(text) {
      set({ notice: { text, at: Date.now() } });
      setTimeout(() => { if (get().notice?.text === text) set({ notice: null }); }, 3500);
    },

    setError(error) { set({ error }); },

    setProfile(partial) {
      const profile = { ...get().profile, ...partial };
      set({ profile });
      saveProfile({ ...profile, quality: get().quality });
      if (get().roomCode && ('carId' in partial || 'color' in partial)) {
        bindNet().updateProfile({ carId: profile.carId, color: profile.color });
      }
    },

    setQuality(quality) {
      set({ quality });
      saveProfile({ ...get().profile, quality });
    },

    async createRoom() {
      set({ busy: true, error: null });
      try {
        const res = await bindNet().createRoom(get().profile);
        if (!res.ok) return set({ error: res.error });
        set({ roomCode: res.roomCode, playerId: res.playerId, room: res.room, screen: 'lobby' });
        const mine = res.room.players.find((p) => p.id === res.playerId);
        if (mine) set({ profile: { ...get().profile, color: mine.color, carId: mine.carId } });
        history.replaceState(null, '', `?sala=${res.roomCode}`);
      } catch (e) {
        set({ error: 'No se pudo conectar con el servidor. ¿Está en marcha?' });
      } finally {
        set({ busy: false });
      }
    },

    async joinRoom(code) {
      set({ busy: true, error: null });
      try {
        const res = await bindNet().joinRoom(code.trim().toUpperCase(), get().profile);
        if (!res.ok) return set({ error: res.error });
        const room = res.room;
        set({ roomCode: res.roomCode, playerId: res.playerId, room, screen: 'lobby', pendingRoomCode: '' });
        const mine = res.room.players.find((p) => p.id === res.playerId);
        if (mine) set({ profile: { ...get().profile, color: mine.color, carId: mine.carId } });
        history.replaceState(null, '', `?sala=${res.roomCode}`);
      } catch {
        set({ error: 'No se pudo conectar con el servidor. ¿Está en marcha?' });
      } finally {
        set({ busy: false });
      }
    },

    leaveRoom() {
      net?.leaveRoom();
      set({ roomCode: null, playerId: null, room: null, race: null, results: null, screen: 'menu' });
      history.replaceState(null, '', location.pathname);
    },

    setReady(ready) { net?.setReady(ready); },
    updateSettings(settings) { net?.updateSettings(settings); },
    async startRace() {
      const res = await net?.startRace().catch(() => ({ ok: false, error: 'Sin respuesta del servidor.' }));
      if (res && !res.ok) get().toast(res.error);
    },
    backToLobby() { net?.backToLobby(); },

    /** Práctica en solitario, sin servidor. */
    startPractice(trackId = DEFAULT_TRACK_ID, laps = getTrackInfo(trackId).defaultLaps) {
      const { profile } = get();
      const slot = getTrackLayout(trackId).gridSlots(1)[0];
      set({
        practice: true,
        screen: 'race',
        results: null,
        playerId: 'local',
        race: { goAt: Date.now() + 4000, trackId, laps, grid: [{ id: 'local', slot: 0, x: slot.x, z: slot.z, yaw: slot.yaw }] },
        practiceProfile: profile,
      });
    },

    finishPractice(result) {
      const { profile } = get();
      set({
        results: [{
          position: 1, id: 'local', nickname: profile.nickname || 'Piloto', carId: profile.carId, color: profile.color,
          finished: true, time: result.time, bestLap: result.bestLap, laps: result.laps,
        }],
      });
    },

    exitPractice() {
      set({ practice: false, race: null, results: null, screen: 'menu', playerId: null });
    },
  };
});

if (import.meta.env.DEV) window.__store = useGame;

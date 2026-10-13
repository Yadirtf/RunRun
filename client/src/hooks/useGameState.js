import { useGameStore, selectPhase } from '../store/gameStore.js';

/** Atajos de lectura del estado de juego para las pantallas. */
export function useGameState() {
  const phase = useGameStore(selectPhase);
  const room = useGameStore((s) => s.room);
  const myId = useGameStore((s) => s.myId);
  const me = room?.players.find((p) => p.id === myId) ?? null;
  const isHost = Boolean(room && room.hostId === myId);
  return { phase, room, myId, me, isHost };
}

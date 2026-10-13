import { useEffect } from 'react';
import { useSocket } from './hooks/useSocket.js';
import { useGameState } from './hooks/useGameState.js';
import { MainLobby } from './screens/MainLobby.jsx';
import { RoomLobby } from './screens/RoomLobby.jsx';
import { GameScreen } from './screens/GameScreen.jsx';
import { Toast } from './components/Toast.jsx';
import { ConnectionBadge } from './components/ConnectionBadge.jsx';

/** Enrutado por fase: la fase la decide el estado de la sala que manda el servidor. */
export default function App() {
  const client = useSocket();
  const { phase, room } = useGameState();

  // Mantener ?room=CODIGO en la URL mientras estás en una sala (refrescar o compartir funciona).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (room) url.searchParams.set('room', room.code);
    else if (phase === 'LOBBY' && url.searchParams.has('room') && history.state?.joined) url.searchParams.delete('room');
    window.history.replaceState({ joined: Boolean(room) }, '', url);
  }, [room?.code, phase]);

  return (
    <>
      {phase === 'LOBBY' && <MainLobby client={client} />}
      {phase === 'WAITING_ROOM' && <RoomLobby client={client} />}
      {phase === 'RACE' && <GameScreen client={client} />}
      {phase !== 'RACE' && <ConnectionBadge />}
      <Toast />
    </>
  );
}

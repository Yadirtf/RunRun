import { lazy, Suspense } from 'react';
import { useGame } from './store/gameStore.js';
import MenuScreen from './screens/MenuScreen.jsx';
import LobbyScreen from './screens/LobbyScreen.jsx';
import Toast from './ui/Toast.jsx';

// La carrera (física WebAssembly incluida) se descarga solo cuando hace falta.
const RaceScreen = lazy(() => import('./screens/RaceScreen.jsx'));

export default function App() {
  const screen = useGame((s) => s.screen);
  return (
    <>
      {screen === 'menu' && <MenuScreen />}
      {screen === 'lobby' && <LobbyScreen />}
      {screen === 'race' && (
        <Suspense fallback={<div className="screen race"><div className="overlay loading"><p className="muted">Preparando motor de físicas…</p></div></div>}>
          <RaceScreen />
        </Suspense>
      )}
      <Toast />
    </>
  );
}

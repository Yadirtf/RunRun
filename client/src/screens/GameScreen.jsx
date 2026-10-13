import { useEffect, useRef, useState } from 'react';
import { EVENTS } from '@runrun/shared/protocol';
import { useGameStore, useHudStore } from '../store/gameStore.js';
import { useGameState } from '../hooks/useGameState.js';
import { LoadingScreen } from '../components/LoadingScreen.jsx';
import { Countdown } from '../components/Countdown.jsx';
import { Results } from '../components/Results.jsx';
import { Speedometer } from '../components/HUD/Speedometer.jsx';
import { Minimap } from '../components/HUD/Minimap.jsx';
import { LapTimer } from '../components/HUD/LapTimer.jsx';
import { Leaderboard } from '../components/HUD/Leaderboard.jsx';
import { TouchControls } from '../components/TouchControls.jsx';

/** Pantalla 3: carga de la pista, cuenta atrás, carrera con HUD y resultados. */
export function GameScreen({ client }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(null);
  const race = useGameStore((s) => s.race);
  const results = useGameStore((s) => s.raceResults);
  const leaderboard = useGameStore((s) => s.leaderboard);
  const leave = useGameStore((s) => s.leaveRoom);
  const { room, myId, isHost } = useGameState();
  const hud = useHudStore((s) => s.hud);
  const loading = useHudStore((s) => s.loading);

  // Crear el motor una vez por carrera.
  useEffect(() => {
    if (!race) return undefined;
    let disposed = false;
    let engine = null;
    const offs = [];
    (async () => {
      const { GameEngine } = await import('../engine/GameEngine.js');
      if (disposed) return;
      engine = new GameEngine(canvasRef.current, {
        trackId: race.trackId,
        myId,
        players: race.players,
        startTime: useGameStore.getState().race?.startTime ?? null,
        serverNow: client.serverNow,
        net: {
          sendTransform: (buf) => client.sendTransform(buf),
          sendCheckpoint: (id) => client.sendCheckpoint(id),
        },
        onHud: (h) => useHudStore.setState({ hud: h }),
        onProgress: (p) => useHudStore.setState({ loading: p }),
      });
      engineRef.current = engine;
      offs.push(client.onPlayerMoved((id, t) => engine.onRemoteTransform(id, t)));
      offs.push(client.on(EVENTS.PLAYER_LEFT, ({ id }) => engine.removePlayer(id)));
      offs.push(client.on(EVENTS.LAP_COMPLETED, (e) => engine.onLapCompleted(e)));
      try {
        await engine.init();
      } catch (err) {
        console.error(err);
        if (!disposed) setFailed(err?.message ?? 'No se pudo iniciar el motor 3D');
        return;
      }
      if (disposed) return;
      engine.start();
      setReady(true);
      client.notifyLoaded();
    })();
    return () => {
      disposed = true;
      offs.forEach((off) => off());
      engine?.dispose();
      engineRef.current = null;
      useHudStore.setState({ hud: null, loading: { progress: 0, label: '' } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race?.trackId, race?.players]);

  useEffect(() => {
    if (race?.startTime && engineRef.current) engineRef.current.setStartTime(race.startTime);
  }, [race?.startTime, ready]);

  useEffect(() => {
    engineRef.current?.setStandings(leaderboard);
  }, [leaderboard]);

  // El audio solo puede arrancar tras un gesto: primer clic o tecla.
  useEffect(() => {
    const unlock = () => engineRef.current?.enableAudio();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    return () => {
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
  }, []);

  const exit = () => {
    client.leaveRoom();
    leave();
  };

  const showLoading = !ready || !race?.startTime;
  const total = hud?.standings.length ?? race?.players.length ?? 1;

  return (
    <div className="screen game-screen">
      <canvas ref={canvasRef} className="game-canvas" />

      {ready && hud && (
        <div className="hud">
          <LapTimer
            lap={hud.lap}
            laps={hud.laps}
            lapMs={hud.lapMs}
            lastLapMs={hud.lastLapMs}
            bestLapMs={hud.bestLapMs}
            position={hud.position}
            total={total}
          />
          <Minimap trackId={race.trackId} standings={hud.standings} myId={myId} />
          {hud.standings.length > 1 && <Leaderboard standings={hud.standings} myId={myId} />}
          <Speedometer speed={hud.speedKmh} rpm={hud.rpm} />
          <Countdown raceMs={hud.raceMs} />
          {hud.wrongWay && !hud.finished && <div className="banner warn">¡Sentido contrario!</div>}
          {hud.finished && !results && <div className="banner finish">¡Meta! Esperando al resto…</div>}
          {hud.raceMs != null && hud.raceMs < 6000 && (
            <div className="controls-hint">W/↑ acelerar · S/↓ frenar · A D girar · Espacio freno de mano · R recolocar · C cámara · M sonido</div>
          )}
          <button type="button" className="btn ghost exit-btn" onClick={exit} title="Salir de la carrera">Salir</button>
          <TouchControls engineRef={engineRef} />
        </div>
      )}

      {showLoading && !failed && race && (
        <LoadingScreen trackId={race.trackId} progress={loading.progress} label={loading.label} waiting={ready} />
      )}

      {failed && (
        <div className="results-backdrop">
          <div className="results glass">
            <h2>No se pudo iniciar la carrera</h2>
            <p>{failed}. Comprueba que tu navegador tiene WebGL activado.</p>
            <div className="actions"><button type="button" className="btn primary" onClick={exit}>Volver al menú</button></div>
          </div>
        </div>
      )}

      {results && room?.status === 'FINISHED' && (
        <Results results={results} myId={myId} isHost={isHost} onRematch={() => client.returnToLobby()} onExit={exit} />
      )}
    </div>
  );
}

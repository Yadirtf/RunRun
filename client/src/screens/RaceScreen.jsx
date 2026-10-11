import { useEffect, useMemo, useRef, useState } from 'react';
import { EV, formatTime, getTrackInfo } from '@ranran/shared';
import { useGame } from '../store/gameStore.js';
import { Game } from '../engine/Game.js';
import Speedometer from '../components/hud/Speedometer.jsx';
import Minimap from '../components/hud/Minimap.jsx';
import Standings from '../components/hud/Standings.jsx';
import Results from '../components/hud/Results.jsx';
import TouchControls from '../components/hud/TouchControls.jsx';

const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export default function RaceScreen() {
  const race = useGame((s) => s.race);
  const room = useGame((s) => s.room);
  const practice = useGame((s) => s.practice);
  const playerId = useGame((s) => s.playerId);
  const results = useGame((s) => s.results);
  const quality = useGame((s) => s.quality);
  const profile = useGame((s) => s.profile);
  const store = useGame.getState();

  const canvasRef = useRef(null);
  const [game, setGame] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [hud, setHud] = useState(null);
  const [flash, setFlash] = useState(null);
  const [paused, setPaused] = useState(false);
  const [standings, setStandings] = useState([]);

  // Pilotos de esta carrera (fijados al empezar).
  const roster = useMemo(() => {
    if (practice || !room) {
      return { local: { id: 'local', ...profile, nickname: profile.nickname || 'Piloto' }, others: [] };
    }
    const racingIds = new Set(race.grid.map((g) => g.id));
    const me = room.players.find((p) => p.id === playerId);
    return {
      local: me ?? { id: playerId, ...profile },
      others: room.players.filter((p) => p.id !== playerId && racingIds.has(p.id)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race]);

  // Crea el juego
  useEffect(() => {
    let disposed = false;
    const net = practice ? null : store.net();
    const g = new Game(canvasRef.current, {
      trackId: race.trackId,
      laps: race.laps,
      local: roster.local,
      others: roster.others,
      grid: race.grid,
      goAt: race.goAt,
      net,
      quality,
      onHud: setHud,
      onEvent: (ev) => {
        if (ev.type === 'lap' && ev.lap < race.laps) setFlash({ text: `Vuelta ${ev.lap}: ${formatTime(ev.lapTime)}`, at: Date.now() });
        if (ev.type === 'finish') {
          setFlash({ text: '¡Meta!', at: Date.now() });
          if (practice) store.finishPractice({ time: ev.time, bestLap: g.tracker.bestLap, laps: g.tracker.lapsDone });
        }
        if (ev.type === 'reset') setFlash({ text: 'De vuelta a la pista', at: Date.now() });
      },
    });
    g.init((p) => setProgress(p))
      .then(() => {
        if (disposed) return;
        g.start();
        if (import.meta.env.DEV) window.__game = g;
        setGame(g);
      })
      .catch((e) => {
        console.error(e);
        if (!disposed) setLoadError('No se pudo cargar la carrera. Prueba con calidad baja o recarga la página.');
      });

    const offs = [];
    if (net) {
      offs.push(net.on(EV.SNAPSHOT, (snap) => {
        g.applySnapshot(snap);
        const players = useGame.getState().room?.players ?? [];
        setStandings(snap.cars.map((c) => {
          const p = players.find((x) => x.id === c.id);
          return { id: c.id, pos: c.pos, lap: c.lap, fin: c.fin, nickname: p?.nickname ?? '…', color: p?.color ?? '#888' };
        }));
      }));
      offs.push(net.on(EV.PLAYER_FINISHED, ({ id, position }) => {
        const p = useGame.getState().room?.players.find((x) => x.id === id);
        if (p && id !== playerId) store.toast(`${p.nickname} ha terminado ${position}º`);
      }));
    }
    return () => {
      disposed = true;
      offs.forEach((off) => off());
      g.dispose();
      setGame(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race]);

  // Si alguien abandona la sala, quitamos su coche.
  useEffect(() => {
    if (!game || !room) return;
    const ids = new Set(room.players.map((p) => p.id));
    for (const id of [...game.remotes.keys()]) if (!ids.has(id)) game.removeRemote(id);
  }, [room, game]);

  useEffect(() => {
    const onKey = (e) => { if (e.code === 'Escape') setPaused((p) => !p); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isHost = room?.hostId === playerId;
  const track = getTrackInfo(race.trackId);
  const loading = !game && !loadError;

  const leave = () => (practice ? store.exitPractice() : store.leaveRoom());

  return (
    <div className="screen race">
      <canvas ref={canvasRef} className="game-canvas" />

      {loading && (
        <div className="overlay loading">
          <h2>{track.fullName}</h2>
          <p className="muted">{track.country} · {(track.length / 1000).toFixed(2)} km · {race.laps} {race.laps === 1 ? 'vuelta' : 'vueltas'}</p>
          <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <p className="muted">Cargando pista y coches…</p>
        </div>
      )}
      {loadError && (
        <div className="overlay loading">
          <p className="error">{loadError}</p>
          <button className="btn" onClick={leave}>Volver</button>
        </div>
      )}

      {game && hud && (
        <div className="hud">
          <div className="hud-top-left">
            {!practice && <div className="hud-pos"><b>{hud.position}</b><small>/{hud.total}</small></div>}
            <div className="hud-laps">
              <div><span>Vuelta</span><b>{Math.max(hud.lap, 1)}/{hud.laps}</b></div>
              <div><span>Tiempo</span><b>{formatTime(hud.raceTime)}</b></div>
              <div><span>Actual</span><b>{formatTime(hud.lapTime)}</b></div>
              <div><span>Mejor</span><b>{formatTime(hud.bestLap)}</b></div>
            </div>
            {!practice && <Standings rows={standings} meId={playerId} />}
          </div>
          <div className="hud-top-right"><Minimap game={game} /></div>
          {!hud.spectating && (
            <div className="hud-bottom-right">
              <Speedometer speedKmh={hud.speedKmh} rpm={hud.rpm} redline={hud.redline} gear={hud.gear} />
            </div>
          )}
          <div className="hud-bottom-left muted">
            Cámara: {hud.cameraMode} (C) · R: volver a pista · M: {hud.muted ? 'activar' : 'silenciar'} sonido · Esc: menú
          </div>
          {hud.countdown > 3 && <div className="warning soft">Preparados… esperando la salida</div>}
          {hud.countdown > 0 && hud.countdown <= 3 && <div className="countdown" key={hud.countdown}>{hud.countdown}</div>}
          {hud.countdown === 0 && hud.raceTime < 1200 && <div className="countdown go">¡YA!</div>}
          {hud.wrongWay && <div className="warning">Sentido contrario</div>}
          {!hud.wrongWay && hud.offTrack && <div className="warning soft">Fuera de pista</div>}
          {hud.spectating && <div className="warning soft">Modo espectador: entrarás en la próxima carrera</div>}
          {flash && Date.now() - flash.at < 2500 && <div className="flash" key={flash.at}>{flash.text}</div>}
          {hud.finished && !results && <div className="flash persistent">¡Terminado! Esperando al resto…</div>}
          {isTouch && !hud.spectating && <TouchControls game={game} />}
        </div>
      )}

      {paused && !results && (
        <div className="overlay pause">
          <div className="panel">
            <h2>Pausa</h2>
            <p className="muted">{practice ? 'La práctica sigue corriendo.' : 'La carrera sigue en marcha para los demás.'}</p>
            <div className="actions">
              <button className="btn primary" onClick={() => setPaused(false)}>Continuar</button>
              <button className="btn" onClick={leave}>{practice ? 'Salir al menú' : 'Abandonar la sala'}</button>
            </div>
          </div>
        </div>
      )}

      {results && (
        <Results
          results={results}
          meId={playerId}
          actions={practice ? (
            <>
              <button className="btn primary" onClick={() => store.startPractice(race.trackId, race.laps)}>Repetir</button>
              <button className="btn" onClick={store.exitPractice}>Menú</button>
            </>
          ) : isHost ? (
            <>
              <button className="btn primary" onClick={store.backToLobby}>Volver a la sala</button>
              <button className="btn" onClick={store.leaveRoom}>Salir</button>
            </>
          ) : (
            <>
              <p className="muted">Esperando a que el anfitrión vuelva a la sala…</p>
              <button className="btn" onClick={store.leaveRoom}>Salir</button>
            </>
          )}
        />
      )}
    </div>
  );
}

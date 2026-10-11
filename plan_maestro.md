# 🏎️ Plan Maestro: Juego de Carreras Multijugador 3D Web
## Production-Ready · Deployment Target: Render.com

---

> [!IMPORTANT]
> Este plan está diseñado para ser dado **directamente a un agente de desarrollo** con instrucciones claras, ordenadas y sin ambigüedades. Cada fase incluye criterios de aceptación medibles.

---

## 📋 Resumen Ejecutivo

| Atributo | Valor |
|---|---|
| **Tipo de proyecto** | Juego de carreras multijugador 3D en navegador |
| **Stack** | Vite + React (frontend) · Node.js + Socket.io (backend) · Three.js + Rapier3D (motor) |
| **Despliegue** | Render.com (Web Service para backend + Static Site para frontend) |
| **Jugadores por sala** | Hasta 8 jugadores simultáneos |
| **FPS objetivo** | 60 FPS estables en hardware mid-range |
| **Tiempo de carga** | < 3 segundos en conexión de 10 Mbps |

---

## 🗂️ Estructura de Directorios Final

```
/racing-game/
├── server/                          # Backend Node.js
│   ├── server.js                    # Entry point + Socket.io
│   ├── RoomManager.js               # Lógica de salas
│   ├── CheckpointValidator.js       # Validación de vueltas server-side
│   ├── package.json
│   └── .env.example
│
├── client/                          # Frontend Vite + React
│   ├── public/
│   │   └── assets/
│   │       ├── cars/                # Modelos GLB de vehículos
│   │       │   ├── car_sport.glb
│   │       │   ├── car_muscle.glb
│   │       │   └── car_supercar.glb
│   │       ├── track/
│   │       │   ├── track_visual.glb # Pista visual (150k tris)
│   │       │   └── track_collider.glb # Colisionador invisible simplificado
│   │       ├── textures/            # HDRI, skybox, texturas extra
│   │       └── sounds/              # Efectos de audio
│   │           ├── engine.ogg
│   │           ├── tire_screech.ogg
│   │           └── countdown.ogg
│   ├── src/
│   │   ├── main.jsx                 # Entry point React
│   │   ├── index.css                # Design system global
│   │   ├── App.jsx                  # Router principal
│   │   ├── screens/
│   │   │   ├── MainLobby.jsx        # Pantalla 1: Lobby principal
│   │   │   ├── RoomLobby.jsx        # Pantalla 2: Sala de espera
│   │   │   └── GameScreen.jsx       # Pantalla 3: Juego activo
│   │   ├── engine/
│   │   │   ├── GameEngine.js        # Controlador principal Three.js
│   │   │   ├── VehicleController.js # Físicas del vehículo local (Rapier)
│   │   │   ├── RemotePlayer.js      # Interpolación de jugadores remotos
│   │   │   ├── TrackLoader.js       # Carga y setup del track GLB
│   │   │   ├── CheckpointSystem.js  # Detección de checkpoints
│   │   │   ├── ParticleSystem.js    # Partículas (polvo, humo, chispas)
│   │   │   └── AudioManager.js      # Audio espacial 3D (Web Audio API)
│   │   ├── components/
│   │   │   ├── HUD/
│   │   │   │   ├── Speedometer.jsx  # Velocímetro analógico/digital
│   │   │   │   ├── Minimap.jsx      # Minimapa SVG en tiempo real
│   │   │   │   ├── LapTimer.jsx     # Contador de vueltas y tiempos
│   │   │   │   └── Leaderboard.jsx  # Tabla de posiciones en vivo
│   │   │   ├── CarSelector.jsx      # Selector 3D rotatorio de vehículo
│   │   │   ├── PlayerList.jsx       # Lista de jugadores en sala
│   │   │   └── Countdown.jsx        # Cuenta atrás animada 3-2-1-GO
│   │   ├── hooks/
│   │   │   ├── useSocket.js         # Hook de conexión Socket.io
│   │   │   └── useGameState.js      # Estado global del juego (Zustand)
│   │   └── store/
│   │       └── gameStore.js         # Zustand store
│   ├── vite.config.js
│   └── package.json
│
├── render.yaml                      # Configuración declarativa de Render
└── README.md
```

---

## 🚀 Fases de Desarrollo

### FASE 1 — Scaffolding e Infraestructura Base
**Objetivo:** Proyecto corriendo en local con hot-reload y conexión WebSocket funcionando.

**Tareas para el agente:**

1. Crear `server/package.json` con dependencias:
   ```json
   {
     "dependencies": {
       "express": "^4.18",
       "socket.io": "^4.7",
       "cors": "^2.8"
     }
   }
   ```

2. Crear `client/` con Vite + React usando:
   ```bash
   npx create-vite@latest client --template react
   ```

3. Instalar dependencias del cliente:
   ```bash
   npm install three @dimforge/rapier3d-compat socket.io-client zustand @studio-freight/lenis
   ```

4. Configurar `vite.config.js` con proxy al backend en desarrollo:
   ```javascript
   server: { proxy: { '/socket.io': 'http://localhost:3001' } }
   ```

5. Crear `server/server.js` con el código completo del README (sección 4), expandido con:
   - `RoomManager.js`: clase separada con lógica de salas, máximo 8 jugadores, spawn positions predefinidas
   - `CheckpointValidator.js`: validación server-side de checkpoints y vueltas completadas

**Criterio de aceptación:**
- `node server/server.js` levanta en puerto 3001
- `npm run dev` en client levanta en puerto 5173
- La conexión WebSocket entre cliente y servidor es exitosa (verificar en DevTools > Network > WS)

---

### FASE 2 — Motor de Juego 3D (GameEngine + Físicas)
**Objetivo:** Pista 3D cargada, vehículo controlable con físicas realistas, cámara dinámica.

**Tareas para el agente:**

1. **`engine/GameEngine.js`** — Expandir el código del README (sección 5) con:
   - Renderer con `toneMapping: THREE.ACESFilmicToneMapping`
   - Skybox con CubeCamera o textura HDRI (usar `RGBELoader`)
   - Fog atmosférico (`THREE.FogExp2`)
   - Bloom post-processing con `EffectComposer` + `UnrealBloomPass`
   - Cámara en tercera persona con `lerp` suave (offset dinámico según velocidad)

2. **`engine/TrackLoader.js`** — Cargar `track_visual.glb` y `track_collider.glb`:
   - Visual: añadir al Scene con sombras activadas
   - Collider: crear `RAPIER.ColliderDesc.trimesh()` a partir de la geometría del GLB, sin añadir al Scene (invisible)
   - Generar checkpoints como objetos invisibles `THREE.Box3` equidistantes en la pista

3. **`engine/VehicleController.js`** — Implementar físicas de vehículo con Rapier:
   ```
   - RigidBody dinámico para el chasis
   - 4 ColliderDesc.cylinder() para ruedas (sin joint, simplificado)
   - Aplicar fuerzas: aceleración (W/↑), freno/reversa (S/↓), dirección (A/D o ←/→)
   - Calcular velocidad en Km/h desde el vector de velocidad del RigidBody
   - Límite de velocidad: 200 Km/h
   - Fricción lateral para evitar deslizamiento excesivo
   - Detección de vuelco con quaternion (si pitch > 80° → flip auto en 3s)
   ```

4. **`engine/RemotePlayer.js`** — Interpolación de jugadores remotos:
   - Buffer circular de 3 posiciones para interpolación temporal
   - `lerp` de posición y `slerp` de rotación a 0.15 de factor (suave)
   - Sincronizar rotación de ruedas independientemente

5. **`engine/AudioManager.js`** — Web Audio API espacial:
   - Sonido de motor: `AudioBuffer` en loop, `playbackRate` escalado según velocidad
   - `PannerNode` para sonidos de jugadores remotos (fade con distancia)
   - Efectos: derrape, countdown, cruce de meta

**Criterio de aceptación:**
- El vehículo local es controlable con WASD/flechas
- Las físicas responden con inercia y fricción realista
- La pista carga y tiene colisiones activas (el coche no atraviesa el suelo)
- La cámara sigue suavemente al vehículo

---

### FASE 3 — Networking Multijugador Completo
**Objetivo:** 2+ jugadores en la misma sala ven los vehículos de los demás en tiempo real.

**Tareas para el agente:**

1. **`hooks/useSocket.js`** — Hook React que:
   - Conecta a Socket.io usando `VITE_SOCKET_URL` (variable de entorno)
   - Expone: `createRoom`, `joinRoom`, `sendTransform`, `onPlayerMoved`
   - Maneja reconexión automática con backoff exponencial

2. **`store/gameStore.js`** — Estado global con Zustand:
   ```javascript
   {
     phase: 'LOBBY' | 'WAITING_ROOM' | 'COUNTDOWN' | 'RACING' | 'FINISHED',
     myPlayer: { id, nickname, carModel, lapCount, bestLapTime },
     remotePlayers: Map<id, PlayerData>,
     room: { code, players[], hostId },
     raceResults: []
   }
   ```

3. **Sincronización de transformaciones** — En el game loop (60 fps), emitir al servidor cada **50ms (20Hz)** no en cada frame:
   ```javascript
   // Throttle con timestamp
   if (Date.now() - lastSyncTime > 50) {
     socket.emit('update_transform', { roomCode, position, rotation, wheelRotation, speed });
     lastSyncTime = Date.now();
   }
   ```

4. **Completar eventos del servidor** — Expandir `server.js` con:
   - `player_ready` → cuando todos están listos, el host puede iniciar
   - `checkpoint_passed` → validar server-side, emitir `leaderboard_update`
   - `lap_completed` → registrar tiempo, emitir al room
   - `race_finished` → cuando todos completan las vueltas o timeout de 10 min
   - `host_transfer` → si el host se desconecta, transferir al siguiente jugador

**Criterio de aceptación:**
- Abrir 2 pestañas del juego, crear sala en una y unirse en la otra
- Cada pestaña ve el vehículo del otro moviéndose suavemente
- Si se cierra una pestaña, el jugador desaparece de la sala sin errores

---

### FASE 4 — Pantallas e Interfaz de Usuario
**Objetivo:** Flujo completo de pantallas con diseño premium y animaciones.

**Tareas para el agente:**

#### 4.1 — Design System (`index.css`)
```css
/* Variables globales */
--color-bg: #0a0a0f;
--color-surface: #12121a;
--color-surface-2: #1a1a28;
--color-accent: #e63946;       /* Rojo racing */
--color-accent-2: #f4d35e;     /* Amarillo dorado */
--color-neon: #00f5ff;         /* Cyan neón para velocímetro */
--font-display: 'Orbitron', sans-serif;   /* Fuente futurista para HUD */
--font-body: 'Inter', sans-serif;
--glass: backdrop-filter: blur(12px) saturate(180%);
```

#### 4.2 — `screens/MainLobby.jsx`
- Background: canvas Three.js con los 3 autos rotando lentamente (showcase)
- Partículas de velocidad animadas en CSS (efecto speedlines)
- Campo de texto para nickname con validación (3-16 caracteres)
- `CarSelector.jsx`: carrusel 3D con Three.js mostrando cada auto, flechas L/R
- Botones: **[CREAR SALA]** / **[UNIRSE CON CÓDIGO]** (modal con input del código)
- Animación de entrada con `@studio-freight/lenis` + CSS transforms

#### 4.3 — `screens/RoomLobby.jsx`
- Panel glassmorphism flotante con lista de jugadores y estado (listo/espera)
- Código de sala grande y visible con botón **[COPIAR ENLACE]**
- Botón **[LISTO]** por jugador → cambio de color al confirmarse
- Solo el Host ve **[INICIAR CARRERA]** (activo solo si todos están listos)
- Animación de entrada de nuevos jugadores (slide-in desde derecha)

#### 4.4 — `components/HUD/`
- **`Speedometer.jsx`**: velocímetro analógico SVG con aguja animada + display digital de KM/H
- **`Minimap.jsx`**: SVG 2D top-down de la pista con puntos de colores por jugador
- **`LapTimer.jsx`**: vuelta actual, mejor vuelta, contador de vueltas (ej: 2/3)
- **`Leaderboard.jsx`**: tabla lateral animada que se reordena en tiempo real
- **`Countdown.jsx`**: pantalla de cuenta atrás `3-2-1-GO` con animación de escala

**Criterio de aceptación:**
- El flujo completo funciona: Lobby → Sala → Juego
- Todos los elementos del HUD muestran datos reales del juego
- La interfaz se ve premium en resoluciones 1080p y 1440p

---

### FASE 5 — Assets 3D (Procedurales como Fallback)
**Objetivo:** El juego funciona con assets 3D propios si no hay modelos GLB externos.

> [!NOTE]
> Si no se dispone de modelos `.glb` de Sketchfab, el agente debe generar assets procedurales con Three.js que sean visualmente aceptables para demo/producción.

**Tareas para el agente:**

1. **Pista procedural** — Generar con Three.js:
   - `THREE.CatmullRomCurve3` con 20 puntos de control formando un circuito oval
   - `THREE.TubeGeometry` o `THREE.ExtrudeGeometry` sobre la curva
   - Barreras laterales con cajas alargadas (`BoxGeometry`)
   - Material de asfalto con `MeshStandardMaterial` + textura repetida de ruido

2. **Vehículos procedurales** — Geometría simple pero estilizada:
   - Chasis: `BoxGeometry` (2.5 × 0.7 × 1.2) con material metálico reflectante
   - Ruedas: `CylinderGeometry` (0.35 × 0.35 × 0.3) rotado 90°
   - Colores diferenciados por jugador desde un array de 8 colores predefinidos

3. **Checkpoints** — Anillos `THREE.TorusGeometry` semitransparentes en 5 puntos del circuito

**Criterio de aceptación:**
- El juego es completamente funcional con assets procedurales
- Los assets procedurales son reemplazables por GLBs reales sin cambiar el código del motor

---

### FASE 6 — Optimización y Polish
**Objetivo:** 60 FPS estables, tiempos de carga < 3s, experiencia pulida.

**Tareas para el agente:**

1. **Rendimiento del renderer:**
   - `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`
   - LOD (`THREE.LOD`) para vehículos remotos lejanos
   - Frustum culling activado (por defecto en Three.js)
   - Limitar `shadowMap` a radio de 80 unidades desde el jugador

2. **Optimización de red:**
   - Comprimir datos de transformación: enviar solo deltas si el cambio es < 0.01
   - Usar `ArrayBuffer` en lugar de JSON para `update_transform` (reducir ~60% el payload)

3. **Loading screen:**
   - Pantalla de carga con barra de progreso mientras se inicializa Rapier y Three.js
   - `LoadingManager` de Three.js para trackear progreso de assets

4. **Efectos visuales finales:**
   - `ParticleSystem.js`: partículas de polvo en las ruedas proporcionales a la velocidad
   - Efecto de motion blur en velocidad alta (shader personalizado o `MotionBlurPass`)
   - Destellos de luz en la pista (sun flare con `THREE.Lensflare`)

5. **SEO y PWA básico:**
   - `<title>RaceNet · Multijugador 3D</title>`
   - Meta description, og:image
   - `manifest.json` para instalación como PWA

**Criterio de aceptación:**
- DevTools > Performance muestra ≥ 60 FPS en hardware mid-range
- Lighthouse score ≥ 85 en Performance
- El juego carga completamente en < 3s en red rápida

---

### FASE 7 — Configuración y Despliegue en Render
**Objetivo:** Backend y frontend desplegados en Render, jugable desde internet.

**Tareas para el agente:**

#### 7.1 — Variables de Entorno

**Backend (`server/`):**
```env
PORT=10000
NODE_ENV=production
CLIENT_ORIGIN=https://racenet-client.onrender.com
```

**Frontend (`client/`):**
```env
VITE_SOCKET_URL=https://racenet-server.onrender.com
```

#### 7.2 — Ajustes de Producción en el Servidor

```javascript
// server.js - CORS restrictivo en producción
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"]
  },
  // Necesario para Render (sticky sessions no disponibles en free tier)
  transports: ['websocket', 'polling']
});
```

#### 7.3 — `render.yaml` (Infrastructure as Code)

```yaml
services:
  # Backend Node.js
  - type: web
    name: racenet-server
    env: node
    rootDir: server
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: CLIENT_ORIGIN
        value: https://racenet-client.onrender.com

  # Frontend estático
  - type: web
    name: racenet-client
    env: static
    rootDir: client
    buildCommand: npm install && npm run build
    staticPublishPath: ./dist
    envVars:
      - key: VITE_SOCKET_URL
        value: https://racenet-server.onrender.com
    headers:
      - path: /*
        name: Cache-Control
        value: no-cache
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

#### 7.4 — `package.json` raíz (para Render monorepo)

```json
{
  "name": "racing-game",
  "scripts": {
    "start": "node server/server.js",
    "dev:server": "nodemon server/server.js",
    "dev:client": "cd client && npm run dev",
    "build": "cd client && npm run build"
  }
}
```

#### 7.5 — Configuración de `client/vite.config.js`

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
          vendor: ['react', 'react-dom', 'socket.io-client']
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat']
  },
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true
      }
    }
  }
})
```

> [!WARNING]
> Rapier3D usa WebAssembly. Render sirve archivos `.wasm` correctamente, pero asegúrate de que `vite.config.js` no excluye los archivos WASM del build. El `optimizeDeps.exclude` es solo para el servidor de dev.

#### 7.6 — Headers CORS para archivos WASM en Render
Crear `public/_headers`:
```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

> [!CAUTION]
> Sin estos headers, `SharedArrayBuffer` (necesario para Rapier WASM) no funcionará en navegadores modernos. Render los sirve si están en `_headers`.

**Criterio de aceptación:**
- URL del frontend es accesible desde internet
- Conexión WebSocket entre frontend y backend es exitosa en producción
- No hay errores de CORS en la consola del navegador
- 2 personas en distintos dispositivos pueden jugar juntas

---

## 📦 Dependencias Completas

### Backend (`server/package.json`)
```json
{
  "name": "racenet-server",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "socket.io": "^4.7.4"
  },
  "devDependencies": {
    "nodemon": "^3.0.3"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### Frontend (`client/package.json`)
```json
{
  "name": "racenet-client",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@dimforge/rapier3d-compat": "^0.12.0",
    "@studio-freight/lenis": "^1.0.42",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "socket.io-client": "^4.7.4",
    "three": "^0.160.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.0.0"
  }
}
```

---

## 🎮 Eventos Socket.io (Contrato de API)

| Evento | Dirección | Payload | Descripción |
|---|---|---|---|
| `create_room` | C→S | `{nickname, carModel}` | Crear sala nueva |
| `room_created` | S→C | `{roomCode, player}` | Confirmación de sala creada |
| `join_room` | C→S | `{roomCode, nickname, carModel}` | Unirse a sala existente |
| `player_joined` | S→C | `{players[], newPlayer}` | Alguien se unió a la sala |
| `player_ready` | C→S | `{roomCode}` | Jugador marca listo |
| `update_transform` | C→S | `{roomCode, position, rotation, wheelRotation, speed}` | Posición del vehículo (20Hz) |
| `player_moved` | S→C | `{id, position, rotation, wheelRotation}` | Posición de jugador remoto |
| `start_race` | C→S | `{roomCode}` | Host inicia la carrera |
| `race_started` | S→C | `{startTime}` | Timestamp UTC de inicio |
| `checkpoint_passed` | C→S | `{roomCode, checkpointId, timestamp}` | Jugador pasó por checkpoint |
| `leaderboard_update` | S→C | `{leaderboard[]}` | Tabla de posiciones actualizada |
| `lap_completed` | S→C | `{playerId, lapTime, lapNumber}` | Vuelta completada |
| `race_finished` | S→C | `{results[]}` | Resultados finales de carrera |
| `player_left` | S→C | `{id}` | Jugador desconectado |
| `host_transfer` | S→C | `{newHostId}` | Nuevo host asignado |
| `error_message` | S→C | `string` | Error de sala |

---

## ✅ Checklist de Entrega

### Funcionalidad Core
- [ ] Servidor Node.js + Socket.io corriendo
- [ ] Frontend Vite + React corriendo
- [ ] Conexión WebSocket establecida
- [ ] Crear sala y obtener código
- [ ] Unirse a sala con código
- [ ] Lista de jugadores en tiempo real
- [ ] Iniciar carrera (solo host)
- [ ] Vehículo local controlable (WASD/flechas)
- [ ] Físicas con Rapier3D (colisiones, fricción, gravedad)
- [ ] Pista 3D con colisiones activas
- [ ] Vehículos remotos visibles e interpolados suavemente
- [ ] Sistema de checkpoints
- [ ] Contador de vueltas y tiempos
- [ ] Velocímetro funcional (datos reales)
- [ ] Minimapa con posición de todos los jugadores
- [ ] Tabla de posiciones en vivo
- [ ] Pantalla de resultados al finalizar la carrera

### UI/UX
- [ ] Design system implementado (colores, fuentes, variables CSS)
- [ ] Pantalla de lobby con selector de auto 3D
- [ ] Sala de espera con lista de jugadores
- [ ] HUD completo durante la carrera
- [ ] Cuenta atrás 3-2-1-GO animada
- [ ] Loading screen con progreso
- [ ] Responsive en 1080p y 1440p

### Producción / Render
- [ ] `render.yaml` configurado correctamente
- [ ] Variables de entorno documentadas
- [ ] CORS configurado para producción
- [ ] Headers WASM (`_headers`) creados
- [ ] Build de Vite exitoso sin errores
- [ ] WebSocket funciona en producción (WSS)
- [ ] Backend accesible en URL de Render
- [ ] Frontend accesible en URL de Render
- [ ] 2 jugadores pueden jugar desde dispositivos distintos

### Performance
- [ ] ≥ 60 FPS en hardware mid-range
- [ ] Carga < 3 segundos
- [ ] Code splitting configurado en Vite
- [ ] Sin memory leaks en el game loop (dispose de geometrías/materiales)

---

## 🧠 Instrucción Final para el Agente

> Desarrolla este proyecto **fase por fase en el orden establecido**. Verifica cada criterio de aceptación antes de pasar a la siguiente fase. Usa assets procedurales (Three.js puro) si no hay modelos GLB disponibles. El objetivo final es que el juego sea **completamente jugable en producción en Render.com** con el `render.yaml` proporcionado. No omitas ningún archivo de la estructura de directorios.


# RunRun 🏎️

Juego de carreras 3D multijugador en el navegador. Un jugador crea una sala, comparte el código (o el enlace `/?room=CODIGO`) y hasta 8 pilotos compiten en tiempo real en dos circuitos con paisajes distintos:

| Pista | Paisaje | Longitud |
| --- | --- | --- |
| **Valle Alpino** | Curvas técnicas con desnivel, bosque de pinos, lago y cumbres nevadas | 1,29 km |
| **Cañón del Desierto** | Rectas largas, horquilla y curvas rápidas entre dunas, cactus y mesetas rojas al atardecer | 1,45 km |

## Cómo ejecutarlo

Requisitos: Node.js 22.13 o superior (la comunidad usa el SQLite integrado de Node).

```bash
npm install
npm run dev        # servidor en :3001 y cliente Vite en :5173 (con proxy de WebSocket)
```

Abre http://localhost:5173 en dos pestañas: crea la sala en una y únete con el código en la otra.

```bash
npm test           # tests de dominio (salas, checkpoints, trazado) e integración Socket.io
npm run build      # build de producción del cliente en client/dist
npm start          # servidor de producción; si existe client/dist también lo sirve
```

**Controles:** W/↑ acelerar · S/↓ frenar y marcha atrás · A/D o ←/→ girar · Espacio freno de mano · R recolocar en pista · C cambiar cámara · M silenciar. También funciona con mando (gatillos y stick izquierdo) y en pantallas táctiles. `?quality=low` en la URL desactiva el bloom y reduce sombras para equipos modestos.

## Arquitectura

Monorepo con *npm workspaces* y capas separadas: el dominio no conoce Socket.io ni React, y el motor 3D no conoce la red.

```
shared/   Dominio compartido cliente/servidor (sin dependencias)
  protocol.js     Contrato de eventos Socket.io, codificación binaria de transformaciones (40 bytes)
  tracks.js       Catálogo de pistas (puntos de control, vueltas, checkpoints)
  trackPath.js    Catmull-Rom centrípeta + re-muestreo por longitud de arco, proyección, parrilla
  cars.js         Catálogo de coches (estadísticas y proporciones)

server/   Node.js + Express + Socket.io
  Room.js               Agregado "sala": jugadores, host, pista, estados LOBBY→LOADING→COUNTDOWN→RACING→FINISHED
  RoomManager.js        Registro de salas, códigos legibles, limpieza de salas inactivas
  CheckpointValidator.js  Orden de checkpoints, tiempo mínimo físico entre ellos y cronometraje con reloj del servidor
  socketHandlers.js     Capa de transporte: valida entrada, llama al dominio y difunde eventos
  server.js             Arranque HTTP/WS, CORS y servido opcional del build

client/   Vite + React + Zustand
  src/net/SocketClient.js   Adaptador Socket.io + sincronización de reloj con el servidor
  src/store/gameStore.js    Estado global; la fase de la UI se deriva del estado de la sala
  src/screens/              MainLobby → RoomLobby → GameScreen
  src/components/           HUD (velocímetro, minimapa, tiempos, clasificación), selector de coche y pista, resultados
  src/engine/               Motor de juego (Three.js + Rapier), independiente de React
    GameEngine.js           Orquestador: paso fijo de físicas a 60 Hz con interpolación, red a 20 Hz, HUD a 15 Hz
    VehicleController.js    Vehículo por raycast de Rapier: suspensión por rueda, curva de par, carga aerodinámica
    TrackLoader.js          Pista procedural (o GLB si se configura) + colliders trimesh
    environment/            Paisajes por tema: terreno, lago, vegetación instanciada, rocas
    SceneSetup.js           Cielo físico, IBL, sombras que siguen al coche, niebla, bloom, ACES
    CarFactory.js           Coches procedurales con nodos chassis/wheel_fl/... (sustituibles por GLB)
    RemotePlayer.js         Buffer de instantáneas e interpolación ~110 ms en el pasado
    CheckpointSystem.js, ChaseCamera.js, InputController.js, ParticleSystem.js, AudioManager.js
```

**Flujo de una carrera:** el host pulsa *Iniciar* → todos cargan la pista (`race_loading`) → cada cliente confirma (`player_loaded`) → el servidor fija la hora de salida (`race_started`) con 3 s de cuenta atrás, sincronizada con el reloj de cada cliente → los clientes envían su transformación a 20 Hz en binario y los checkpoints que cruzan → el servidor valida, publica vueltas y clasificación y cierra la carrera cuando todos terminan (o 60 s después del ganador, o a los 10 min).

**Añadir una pista:** una entrada en `shared/src/tracks.js` (puntos de control) y, si quieres otro paisaje, un tema en `client/src/engine/environment/themes.js`. Los tests comprueban que el trazado no se cruza y que las curvas son conducibles.

## Decisiones respecto a la especificación

- Se siguió el stack del plan (Vite + React, Three.js 0.160, Rapier 0.12, Socket.io 4.7, Zustand). Para los menús se usó un *design system* con variables CSS (sección 4.1 del plan) en lugar de Tailwind, y no se incluyó Lenis porque ninguna pantalla tiene scroll.
- No hay modelos de Sketchfab en el repositorio, así que pistas, paisajes y coches son procedurales (Fase 5 del plan). Se pueden sustituir por GLB sin tocar el motor: `CAR_GLB` en `CarFactory.js` y `assets.visual` / `assets.collider` en la definición de pista.
- Se añadió una fase de carga sincronizada (`race_loading` / `player_loaded`) para que nadie empiece la cuenta atrás con la pista aún cargando, y la elección de pista y coche en la sala (`select_track`, `select_car`).
- Las físicas usan el controlador de vehículo por raycast de Rapier (suspensión real por rueda) en vez de cilindros sin articulaciones.

## Comunidad: amigos, invitaciones y notificaciones

Botón **Amigos** (abajo a la derecha en los menús) con tres pestañas:

- **Mis amigos:** invitaciones y solicitudes pendientes, y la lista de amigos con su estado (en línea, en una sala, corriendo, desconectado). Desde tu sala, **Invitar** les envía la invitación al instante; si un amigo está en una sala abierta y tú no, **Unirme** te lleva a ella.
- **Agregar:** tu código de piloto (`ABCD-2345`) para compartir, un campo para agregar por código y, dentro de una sala, los pilotos que aún no son tus amigos con un botón **Agregar**.
- **Ajustes:** activar las notificaciones del navegador y vincular la cuenta a otro dispositivo con un código de un solo uso (10 min).

**Cuentas:** no hay registro. Cada navegador recibe una cuenta anónima (id + token en `localStorage`; en el servidor solo se guarda el hash del token). El nombre visible es el nombre de piloto. Para usar la misma cuenta en el móvil y el ordenador se vincula con el código de *Ajustes*.

**Persistencia:** SQLite (`node:sqlite`) en `COMMUNITY_DB_PATH` (por defecto `server/data/runrun.db`): cuentas, amistades, solicitudes y suscripciones push. Las invitaciones y la presencia viven en memoria (caducan en 5 min).

**Notificaciones push:** Web Push con VAPID y el service worker `client/public/sw.js`. Llegan aunque RunRun esté cerrado (invitación a sala, solicitud recibida o aceptada); si la pestaña está en primer plano se muestra el aviso dentro del juego en vez de la notificación del sistema. Al tocar una invitación se abre `/?room=CODIGO&invite=1` y entras directo si ya tienes nombre de piloto. En iPhone/iPad (iOS 16.4+) solo funcionan con RunRun añadido a la pantalla de inicio.

Código: `shared/src/community.js` (contrato), `server/community/` (store SQLite, push y eventos `community:*`), `client/src/community/` (store, panel y lógica push).

## Despliegue

`render.yaml` define el backend (Web Service) y el frontend (Static Site) en Render. Variables: `CLIENT_ORIGIN` en el servidor y `VITE_SOCKET_URL` en el cliente; para la comunidad, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` y `COMMUNITY_DB_PATH` en el servidor, que debe apuntar a un disco persistente o los amigos se pierden en cada despliegue (ver `server/.env.example` y `client/.env.example`). Alternativa de un solo servicio: `npm run build && npm start` sirve cliente y WebSocket desde el mismo origen.

---

# Especificación Técnica para Sistema de Carreras Multijugador 3D Web (*Production-Ready*)

Esta es la documentación técnica y arquitectónica completa para que tu agente de desarrollo o equipo construya un juego de carreras multijugador 3D interactivo para navegador, listo para producción y optimizado para una alta tasa de refresco (60+ FPS).

---

## 1. Arquitectura del Sistema

El proyecto sigue una arquitectura **Client-Server** clásica con sincronización por eventos en tiempo real:

```
[ Cliente Web (Browser) ] <--- WebSockets (Socket.io) ---> [ Servidor Node.js ]
   ├── Three.js (Render 3D)                                 ├── Room Manager
   ├── Rapier3D (Físicas)                                    ├── State Broadcaster (20Hz)
   └── UI (HTML/Tailwind)                                   └── Room Cleanup Timer

```

* **Cliente:** Administra el renderizado gráfico, partículas, sonidos y la simulación local con predicción de movimiento (*Client-Side Prediction* y *Interpolation*).
* **Servidor:** Actúa como autoridad del estado de la sala: valida tiempos de vuelta, posicionado de entrada en salas y retransmite las transformaciones ($x, y, z$, rotaciones y velocidad) de cada vehículo.

---

## 2. Stack Tecnológico

| Capa | Tecnología / Librería | Versión | Propósito |
| --- | --- | --- | --- |
| **Frontend Framework** | Vite + React (o Vanilla JavaScript ES Modules) | Latest | Bundling rápido y gestión limpia de UI para el lobby. |
| **Renderizado 3D** | `Three.js` | `^0.160` | Escenas, iluminación HDRI, sombras, cámara dinámica. |
| **Motor de Físicas 3D** | `@dimforge/rapier3d-compat` (WebAssembly) | Latest | Físicas avanzadas de vehículos (suspensión, fricción, colisión con el mapa). |
| **Smooth Scrolling / UI** | `@studio-freight/lenis` + `TailwindCSS` | Latest | Menús limpios, transiciones suaves de cámara en el lobby. |
| **Realtime Backend** | `Node.js` + `Socket.io` | `^4.7` | Servidor de eventos WebSockets para estado multijugador. |
| **Optimizador de Modelos** | `@gltf-transform/cli` | Latest | Compresión Draco/KTX2 para modelos `.glb` exportados de Sketchfab. |

---

## 3. Especificación del Modelo 3D y Assets (Sketchfab)

Para mantener tiempos de carga por debajo de 3 segundos y rendimiento de 60 FPS:

### Pista de Carreras (*Track Map*)

* **Formato:** `.glb` / `.gltf` comprimido mediante Draco.
* **Límite Poligonal:** Máximo 150,000 polígonos (*tris*).
* **Colisionadores (*Colliders*):**
* El modelo visual incluye el mapa detallado.
* Se genera una malla simplificada oculta (*invisible-collider.glb*) usada únicamente por el motor de físicas Rapier3D para calcular asfalto, barreras de contención y vegetación.


* **Texturas:** Texturas empaquetadas en la misma malla en formato WebP / KTX2 (máximo $2048 \times 2048$ px).

### Vehículos (*Cars*)

* **Formato:** `.glb` con jerarquía de nodos separada:
* `chassis` (Cuerpo principal del carro).
* `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr` (Ruedas separadas para aplicar rotación independiente sobre los ejes).


* **Límite Poligonal:** 15,000 a 30,000 polígonos por vehículo.

---

## 4. Implementación del Backend (Node.js + Socket.io)

### Estrutura del Servidor (`server.js`)

```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Estructura de memoria para salas
const rooms = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log(`Jugador conectado: ${socket.id}`);

  // 1. Crear Sala
  socket.on('create_room', ({ nickname, carModel }) => {
    const roomCode = generateRoomCode();
    const player = {
      id: socket.id,
      nickname: nickname || 'Piloto',
      carModel: carModel || 'default_car',
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      isHost: true,
      ready: false
    };

    rooms.set(roomCode, {
      code: roomCode,
      players: new Map([[socket.id, player]]),
      status: 'LOBBY' // LOBBY, RACING, FINISHED
    });

    socket.join(roomCode);
    socket.emit('room_created', { roomCode, player });
  });

  // 2. Unirse a Sala
  socket.on('join_room', ({ roomCode, nickname, carModel }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      return socket.emit('error_message', 'La sala no existe.');
    }
    if (room.players.size >= 8) {
      return socket.emit('error_message', 'La sala está llena (Máx 8 jugadores).');
    }

    const player = {
      id: socket.id,
      nickname: nickname || 'Piloto',
      carModel: carModel || 'default_car',
      position: { x: (room.players.size) * 3, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      isHost: false,
      ready: false
    };

    room.players.set(socket.id, player);
    socket.join(roomCode);

    // Notificar a todos en la sala
    io.to(roomCode).emit('player_joined', {
      players: Array.from(room.players.values()),
      newPlayer: player
    });
  });

  // 3. Sincronización de Posición (Física)
  socket.on('update_transform', ({ roomCode, position, rotation, wheelRotation }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (player) {
      player.position = position;
      player.rotation = rotation;
      player.wheelRotation = wheelRotation;

      // Retransmitir a los otros jugadores
      socket.to(roomCode).emit('player_moved', {
        id: socket.id,
        position,
        rotation,
        wheelRotation
      });
    }
  });

  // 4. Iniciar Carrera (Host)
  socket.on('start_race', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (room && room.players.get(socket.id)?.isHost) {
      room.status = 'RACING';
      io.to(roomCode).emit('race_started', { startTime: Date.now() + 3000 });
    }
  });

  // Desconexión
  socket.on('disconnect', () => {
    rooms.forEach((room, roomCode) => {
      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);
        io.to(roomCode).emit('player_left', { id: socket.id });

        if (room.players.size === 0) {
          rooms.delete(roomCode);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));

```

---

## 5. Implementación del Cliente 3D (Three.js + Rapier)

### Controlador Principal (`GameEngine.js`)

```javascript
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';

export class GameEngine {
  constructor(canvasElement, socket) {
    this.canvas = canvasElement;
    this.socket = socket;
    this.remotePlayers = new Map();
    this.initScene();
  }

  async initScene() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });

    // Scene, Camera, Renderer
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(50, 100, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    this.scene.add(sunLight);

    // Resize Event
    window.addEventListener('resize', () => this.onWindowResize());
    
    this.animate();
  }

  // Carga de vehículo remoto de un amigo
  addRemotePlayer(playerData) {
    const loader = new GLTFLoader();
    loader.load(`/assets/cars/${playerData.carModel}.glb`, (gltf) => {
      const carMesh = gltf.scene;
      carMesh.traverse(child => { if (child.isMesh) child.castShadow = true; });
      
      this.scene.add(carMesh);
      this.remotePlayers.set(playerData.id, {
        mesh: carMesh,
        targetPosition: new THREE.Vector3(),
        targetRotation: new THREE.Quaternion()
      });
    });
  }

  updateRemotePlayerTransform(data) {
    const player = this.remotePlayers.get(data.id);
    if (player) {
      player.targetPosition.set(data.position.x, data.position.y, data.position.z);
      player.targetRotation.set(data.rotation.x, data.rotation.y, data.rotation.z, data.rotation.w);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // Paso de simulación física
    if (this.world) this.world.step();

    // Interpolación de vehículos remotos (Lerp/Slerp para máxima suavidad)
    this.remotePlayers.forEach((player) => {
      player.mesh.position.lerp(player.targetPosition, 0.2);
      player.mesh.quaternion.slerp(player.targetRotation, 0.2);
    });

    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

```

---

## 6. Interfaz de Usuario (UI/UX) y Flujo de Pantallas

1. **Lobby Principal:**
* Campo de entrada para nombre de usuario.
* Visualizador 3D rotatorio del auto seleccionado.
* Botones principales: **[Crear Sala Privada]** / **[Unirse con Código]**.


2. **Sala de Espera (Room Lobby):**
* Panel lateral flotante con la lista de jugadores conectados en tiempo real.
* Botón para **Copiar Enlace Directo** (`[https://tu-juego.com/?room=CARS-8492](https://tu-juego.com/?room=CARS-8492)`).
* El *Host* ve el botón activo **[Iniciar Carrera]**.


3. **HUD durante el Juego (In-Game):**
* Velocímetro digital/analógico en la esquina inferior derecha.
* Minimapa en esquina superior derecha con la posición en tiempo real de todos los vehículos.
* Contador de vueltas y tiempos (Mejor Vuelta vs. Vuelta Actual).
* Tabla de posiciones en vivo según el avance en los *checkpoints*.



---

## 7. Despliegue en Producción

1. **Frontend:** Desplegar en **Vercel** o **Render** (archivos estáticos optimizados tras ejecutar `npm run build`).
2. **Backend (Socket.io):** Desplegar en **Render (Web Service)** o una instancia de servidor VPS (**AWS EC2** / **DigitalOcean**).
3. **HTTPS / WebSockets:** Asegurar el uso de certificados SSL (`wss://`) para permitir la comunicación bidireccional segura sin bloqueos de navegador.
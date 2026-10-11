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
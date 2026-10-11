# RanRan · Guía del proyecto

Juego de carreras 3D para el navegador con salas privadas: alguien crea una sala, comparte el enlace (`https://tu-dominio/?sala=ABC12`) y hasta 8 amigos compiten en circuitos reales. Esta guía describe lo que hay construido; el plan original sigue en `plan_maestro.md` y `README.md`.

## Ejecutar en local

Requisitos: Node 20 o superior.

```bash
npm install
npm run dev        # servidor de salas en :3001 + cliente Vite en :5173
```

Abre http://localhost:5173. Para probar el multijugador, abre una segunda pestaña (o un móvil en la misma red, en `http://IP-de-tu-PC:5173`) con el enlace de la sala.

Otros comandos:

| Comando | Qué hace |
| --- | --- |
| `npm test` | Pruebas de la lógica de pista, vueltas y salas (incluye una partida real por WebSocket) |
| `npm run build` | Compila el cliente en `client/dist` |
| `npm start` | Servidor de producción: sirve el juego compilado y las salas en el mismo puerto |
| `npm run tracks` | Regenera los datos de los circuitos desde el repositorio de trazados |
| `npm run assets` | Vuelve a descargar y optimizar coche, texturas y cielo |

## Controles

W/↑ acelerar · S/↓ frenar y marcha atrás · A/D o ←/→ girar · Espacio freno de mano · C cámara (persecución, lejana, capó) · R volver a la pista · M silenciar · Esc menú. Funciona con mando (gatillos, stick izquierdo, B freno de mano, Y volver a pista).

**Móvil y tablet** (se activan solos en pantallas táctiles; se juega en horizontal):
- Dirección a elegir en Ajustes (menú o pausa ⏸): *Botones* ◀ ▶ con giro progresivo, *Deslizador* analógico (apoya el dedo y desliza) o *Inclinación* (gira el dispositivo como un volante; botón Centrar para calibrar).
- Pedales a la derecha: GAS, FRENO y freno de mano, se pueden pulsar a la vez. Arriba: cámara, volver a pista y pausa.
- Ajustes: sensibilidad, transparencia de los botones, acelerador automático, modo zurdo y vibración. Se guardan en el dispositivo.
- Al empezar a jugar pasa a pantalla completa y bloquea la orientación horizontal donde el navegador lo permite (Android). En iPhone, para jugar a pantalla completa, usa Compartir → Añadir a pantalla de inicio.

## Stack elegido

| Capa | Elección | Por qué |
| --- | --- | --- |
| Render | three.js r186 | El del plan; PBR, sombras, cielo HDRI |
| Físicas | Rapier 3D 0.21 (WebAssembly) | Trae un controlador de vehículo por raycast (suspensión y fricción por rueda), mucho más realista que aplicar fuerzas a una caja |
| Interfaz | React 19 + Zustand | El del plan |
| Tiempo real | Node + Express 5 + Socket.IO 4 | El del plan |
| Build | Vite 8 | El del plan |

Cambios respecto al plan, y el motivo:

- **Un solo servicio en producción.** El servidor Node sirve también el cliente compilado. Así no hay CORS, los WebSockets van por el mismo dominio y en Render basta un servicio (gratis).
- **Sin cabeceras COOP/COEP.** El plan las pedía para Rapier, pero `rapier3d-compat` no usa `SharedArrayBuffer`; esas cabeceras bloquearían las fuentes de Google sin aportar nada.
- **Sin Lenis ni Tailwind.** No hay páginas con scroll que suavizar; el diseño usa CSS propio con las variables del plan.
- **El servidor calcula las vueltas.** En vez de fiarse de eventos `checkpoint_passed` del cliente, el servidor sigue la posición de cada coche a lo largo del trazado: los atajos y teletransportes no cuentan y la clasificación sale de ahí.

## Arquitectura

```
shared/   Código común cliente/servidor
  src/track.js        Geometría de la pista: proyección sobre la línea central, parrilla, muros
  src/lapTracker.js   Progreso, vueltas, tiempos y anti-atajos (lo usan ambos lados)
  src/cars.js         Catálogo de coches y su reglaje físico
  src/trackData.js    Trazados reales (generado por scripts/build-tracks.mjs)
server/   Salas y carrera (autoridad del estado)
  src/Room.js         Una sala: jugadores, anfitrión, listo, cuenta atrás, carrera, resultados
  src/RoomManager.js  Registro de salas y bucle a 20 Hz
  src/socketHandlers.js  Eventos Socket.IO con validación y límite de mensajes
  src/app.js          Express + Socket.IO + estáticos
client/   Juego
  src/engine/         Motor (sin React): Game, Vehicle, TrackBuilder, CarModel, RemoteCar,
                      CameraRig, Effects, Audio, Input, Physics, Assets
  src/net/NetClient.js  Conexión, sincronización de reloj y reconexión
  src/store/          Estado de la interfaz (Zustand)
  src/screens/        Menú, sala de espera y carrera
  src/components/hud/ Velocímetro, minimapa, clasificación, resultados, controles táctiles
```

Cómo funciona el multijugador: cada jugador simula su propio coche (respuesta inmediata) y envía su estado 20 veces por segundo. El servidor valida los datos, calcula el progreso y la clasificación y difunde una instantánea de todos los coches a 20 Hz. Cada cliente dibuja a los rivales interpolando con 120 ms de retraso, y los rivales tienen cuerpo físico, así que hay contacto entre coches. Si se corta la conexión, el jugador tiene 20 s para volver y recupera su sitio.

## Desplegar

### Render (recomendado, gratis)

1. Sube el proyecto a un repositorio de GitHub.
2. En Render: **New → Blueprint** y elige el repositorio. Render lee `render.yaml` y crea el servicio `ranran`.
3. Cuando termine, el juego estará en `https://ranran-xxxx.onrender.com`. Comparte ese enlace.

El plan gratuito de Render duerme el servicio tras 15 minutos sin uso; la primera visita después tarda unos 30-50 s en despertar.

### Docker (cualquier servidor o VPS)

```bash
docker build -t ranran .
docker run -p 3001:3001 ranran
```

Pon delante un proxy con HTTPS (Caddy, Nginx o el del proveedor) que permita WebSockets.

### Cliente y servidor en dominios distintos (opcional)

Si sirves el cliente desde otro sitio (Vercel, Netlify…), compílalo con `VITE_SERVER_URL=https://tu-servidor` y arranca el servidor con `CLIENT_ORIGIN=https://tu-cliente`. Ver `.env.example`.

## Ampliar

- **Otra pista real:** añade una entrada en `TRACKS` dentro de `scripts/build-tracks.mjs` (el id del archivo de [f1-circuits](https://github.com/bacinger/f1-circuits/tree/master/circuits), nombre, ancho y vueltas) y ejecuta `npm run tracks`.
- **Otro coche:** pon su `.glb` en `client/public/game/cars/` y añade una entrada en `shared/src/cars.js` con los nombres de sus cuatro nodos de rueda. Las medidas para la física se leen del propio modelo. Revisa siempre que la licencia permita usarlo y añádelo a `CREDITOS.md`.
- **Reglaje:** `physics` en `shared/src/cars.js` (masa, potencia, marchas, agarre, suspensión, carga aerodinámica). En desarrollo, la consola del navegador tiene `__test.skidpad()`, `__test.brake()` y `__test.lap()` para medir los cambios.

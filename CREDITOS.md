# Créditos y licencias de los recursos

Todos los recursos de terceros que usa RanRan tienen licencias que permiten su uso, incluido el comercial. Esta página cumple con la atribución que exigen.

## Coche

**Car Concept**, de Eric Chadwick / Darmstadt Graphics Group GmbH (2024), del repositorio oficial [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept).
Licencia: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Basado en un modelo de dominio público (CC0) de "Unity Fan".
Cambios: texturas reducidas a 1024 px y convertidas a WebP, geometría comprimida con meshopt, cristal simplificado y color de carrocería personalizable.
El modelo incluye logotipos de Khronos y 3D Commerce, que son marcas de Khronos Group.

## Trazados de los circuitos

Línea central de Spielberg, Interlagos, Monza y Zandvoort tomada de [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits), © Tomislav Bacinger.
Licencia: [MIT](https://github.com/bacinger/f1-circuits/blob/master/LICENSE.md). El trazado se suaviza y la geometría 3D (asfalto, pianos, muros, gradas) se genera en el juego.
Los nombres de los circuitos se usan solo para identificar el trazado; RanRan no está afiliado a ellos.

## Texturas y cielo

De [Poly Haven](https://polyhaven.com), licencia [CC0](https://polyhaven.com/license) (dominio público):

- Asfalto: [Asphalt Track](https://polyhaven.com/a/asphalt_track)
- Césped: [Leafy Grass](https://polyhaven.com/a/leafy_grass)
- Hormigón: [Brushed Concrete](https://polyhaven.com/a/brushed_concrete)
- Grava: [Gravel Floor](https://polyhaven.com/a/gravel_floor)
- Cielo HDRI: [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky)

## Software

- [three.js](https://threejs.org) (MIT): render 3D
- [Rapier](https://rapier.rs) (Apache 2.0): físicas y vehículo por raycast
- [Socket.IO](https://socket.io) (MIT): tiempo real
- [React](https://react.dev) (MIT), [Zustand](https://github.com/pmndrs/zustand) (MIT), [Vite](https://vite.dev) (MIT), [Express](https://expressjs.com) (MIT)
- [glTF Transform](https://gltf-transform.dev) (MIT), [meshoptimizer](https://github.com/zeux/meshoptimizer) (MIT), [sharp](https://sharp.pixelplumbing.com) (Apache 2.0): optimización de recursos
- Fuentes Orbitron e Inter (SIL Open Font License), servidas por Google Fonts

El sonido del motor, los neumáticos y los efectos se sintetiza en tiempo real (no usa archivos de audio).

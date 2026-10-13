import * as THREE from 'three';
import { surfaceTextures } from '../textures.js';

/**
 * Material de terreno por capas: base (hierba, arena, hojarasca...), roca en
 * las pendientes con proyección triplanar y una tercera capa (nieve, playa,
 * pavimento...). Los pesos vienen por vértice (atributo `aSplat`); cada capa se
 * muestrea a dos escalas para que no se note la repetición, y la luminancia de
 * la textura da relieve fino mediante derivadas de pantalla.
 */
export function terrainMaterial({ base, rock, top, scale = 1 }) {
  const tBase = surfaceTextures(base).map;
  const tRock = surfaceTextures(rock).map;
  const tTop = surfaceTextures(top).map;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tBase: { value: tBase },
      tRock: { value: tRock },
      tTop: { value: tTop },
      uScale: { value: scale },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aSplat;
        varying vec3 vSplat;
        varying vec3 vTerrPos;
        varying vec3 vTerrNormal;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSplat = aSplat;
        vTerrPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tBase;
        uniform sampler2D tRock;
        uniform sampler2D tTop;
        uniform float uScale;
        varying vec3 vSplat;
        varying vec3 vTerrPos;
        varying vec3 vTerrNormal;`)
      .replace('#include <map_fragment>', `
        vec2 wuv = vTerrPos.xz * uScale;
        vec3 tb = texture2D(tBase, wuv * 0.22).rgb * 0.55 + texture2D(tBase, wuv * 0.041 + 0.37).rgb * 0.45;
        vec3 an = abs(normalize(vTerrNormal));
        an /= (an.x + an.y + an.z);
        vec3 tr = texture2D(tRock, vTerrPos.zy * 0.09).rgb * an.x
          + texture2D(tRock, wuv * 0.09).rgb * an.y
          + texture2D(tRock, vTerrPos.xy * 0.09).rgb * an.z;
        vec3 tt = texture2D(tTop, wuv * 0.19).rgb * 0.6 + texture2D(tTop, wuv * 0.037 + 0.11).rgb * 0.4;
        vec3 sw = vSplat / max(0.001, vSplat.x + vSplat.y + vSplat.z);
        vec3 terrTex = tb * sw.x + tr * sw.y + tt * sw.z;
        diffuseColor.rgb *= terrTex;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Relieve fino a partir de la luminancia (se apaga a lo lejos para no centellear).
          float hgt = dot(terrTex, vec3(0.33));
          vec2 dh = vec2(dFdx(hgt), dFdy(hgt));
          float fade = 1.0 - smoothstep(30.0, 120.0, length(vViewPosition));
          vec3 sx = dFdx(-vViewPosition);
          vec3 sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal);
          vec3 r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
          normal = normalize(abs(det) * normal - grad * 2.5 * fade);
        }`);
  };
  mat.customProgramCacheKey = () => `terrain:${base}:${rock}:${top}`;
  return mat;
}

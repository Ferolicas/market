# Auditoría causal: /runtime no mantiene 60 Hz en el iPhone real (26-09-2026)

Estado: **investigación en curso, sin optimizar nada todavía.** Este documento es el paso 1-2 del método exigido (lista exacta de diferencias + ablaciones de una sola variable) antes de tocar arquitectura. No se ha modificado ningún comportamiento por defecto — todo lo añadido aquí es instrumentación de diagnóstico, apagada salvo que se pida explícitamente por URL.

## Síntoma medido (build `6b0b8c1`, iPhone real)

| Métrica | Valor |
| --- | --- |
| Trabajo medio / p95 / p99 | 5,3 ms / 6,9 ms / 8,1 ms — **dentro de presupuesto** |
| Hueco medio / p95 / p99 | 21,5 ms / 31 ms / 34 ms — **fuera de presupuesto** |
| Cadencia real | 46,6 FPS |
| Huecos > 25 ms | 2.903 |
| Temperatura | el dispositivo se calentó durante la prueba |

Comparado contra la última medición fría/60 Hz (fases sintéticas previas, hueco p99 ≈ 17–18 ms). El "Trabajo" (tiempo de CPU dentro de `ClientRuntime.tick()`) no explica el hueco — la sospecha correcta, según lo pedido, es **trabajo de GPU/presentación que el temporizador de "Trabajo" no ve**, sostenido, coherente con el calentamiento.

## 1. Lista exacta de diferencias entre el commit frío (`eaaaf51`) y el commit íntegro (`6b0b8c1`)

Un solo commit (`6b0b8c1`, 48 archivos, +6103/-44) contiene todo el delta. `eaaaf51` es la última medición fría/60 Hz conocida (fase 11A, jugador por navmesh, `/runtime` usando el bake completo `level30.glb`).

### A. Contenido de escena que antes no existía en absoluto

- **Texto SDF en vivo (`troika-three-text`) — 160 instancias simultáneas medidas en el nivel 30 completo**, sustituyendo a `SignLayer` (el sistema que `/play2` ya usaba: **un solo draw call, atlas de canvas, sin SDF, sin React**, según su propio comentario de cabecera). Cada instancia de `troika-three-text` es su propio `THREE.Mesh` con su propio material/shader y su propia comprobación interna por fotograma (orientación a cámara para el anti-aliasing SDF). 160 draw calls + 160 posibles "bookkeeping" por fotograma es una diferencia estructural enorme frente a 1.
- **Vidrio con transmisión física real (`MeshPhysicalMaterial.transmission`) en ambas puertas** (fachada 0,5; trasera 0,32) — ninguna de las dos puertas existía en el bake viejo (`dynamic:storefront-door` está explícitamente excluido del horneado; la puerta trasera nunca tuvo implementación en `/play2`). `transmission > 0` obliga a Three.js a un paso de render adicional de fondo, cada fotograma, sea cual sea la cámara — documentado como una de las funciones más caras en GPUs móviles.
- **Animales de granja con esqueleto real (`THREE.AnimationMixer` por instancia)** — no existían en el bake viejo.
- **Luces de techo dinámicas reales (`THREE.PointLight`) cuando `dynamicCeilingLights` es verdadero** — condicionadas a `!this.mobile`; en teoría deberían estar apagadas en el iPhone real (a verificar explícitamente, ver huecos abajo).
- **Docenas de mallas con instancing (`makeInstances`) por mueble/departamento**, en vez de la geometría fusionada única del bake antiguo.

### B. Cambios de comportamiento en sistemas que ya existían

- **El jugador ya no se mueve por el navmesh — usa física Rapier real** (`PlayerPhysics.ts`). Esto es puramente CPU (WASM), sin ninguna interacción con el renderer. Medido de forma independiente: `resolveMovement` ~28 µs de media, ~39 µs p95 — **tres órdenes de magnitud por debajo del presupuesto de fotograma; descartado como causa**, no solo por no "usarlo como excusa" sino con medición real.
- **Las interacciones que antes fallaban silenciosamente ahora disparan de verdad** (cosechar, reponer, devolver, pagar, cobrar caja) — cada una despacha una acción real a la tienda Zustand (`useMarketStore`), lo que dispara un re-render de React del HUD. Antes del arreglo del bug de escala, estas interacciones casi nunca se activaban fuera del origen del mapa; ahora se activan constantemente durante el juego real. **Esto es trabajo de React/HUD fuera del bucle medido por "Trabajo"**, y es genuinamente nuevo en el sentido de que antes casi nunca ocurría.

### C. Hallazgo colateral (bug real, no sospechoso de rendimiento)

- `buildFarm()` no expone ningún método `animate()` y `ClientRuntime.ts` nunca lo llama — el `AnimationMixer` de cada animal solo avanza en los ticks de mundo a 5 Hz (`syncStatic`), no en cada fotograma. Esto hace que la animación se vea a saltos de ~200 ms en vez de fluida, pero **reduce**, no aumenta, el coste por fotograma de esa animación concreta (la malla con esqueleto se dibuja con las mismas matrices de hueso sin recalcular la mayoría de los fotogramas). Anotado como bug de fidelidad a corregir más adelante, no como sospechoso principal del hueco.

## 2. Candidatos descartados con evidencia (no solo con cuenta de draws/triángulos)

| Candidato | Por qué se descarta | Evidencia |
| --- | --- | --- |
| Física del jugador (Rapier) | Coste medido, puramente CPU/WASM, sin tocar el renderer | `scripts/measure-player-physics-perf.ts`: 28 µs media / 39 µs p95 |
| Render-to-texture de las fotos de producto (`stockScreen.ts`) | Confirmado de una sola vez en construcción (`frames={1}` en la fuente), no por fotograma | Lectura directa del código: la llamada a `renderer.render()` vive dentro de la función de construcción, nunca en `update()` |
| Sombras | `renderer.shadowMap.enabled = false` en el constructor de `ClientRuntime`, sin cambios respecto al commit frío | Lectura directa del código |

## 3. Candidatos principales, por orden de sospecha

1. **Texto SDF en vivo (`troika-three-text`), 160 instancias** — sustituye un sistema de un solo draw call por ~160 mallas independientes con su propio material y comprobación por fotograma. Coincide exactamente con el perfil del síntoma: coste de GPU/presentación sostenido, invisible al temporizador de "Trabajo" de CPU.
2. **Vidrio con transmisión física en ambas puertas** — función de Three.js conocida por ser cara en GPUs móviles (paso de render de fondo extra cada fotograma), 100 % carga nueva (ninguna puerta existía antes).
3. **Más re-renders de React/HUD** por interacciones que ahora sí disparan — candidato secundario, más difícil de aislar con una sola ablación binaria; se puede inferir por descarte si 1-2 no explican todo el hueco.

### Candidato revisado y rebajado: luces de techo dinámicas

`dynamicCeilingLights: !this.mobile`, y `mobile = capabilities.coarsePointer || capabilities.width <= 820` (`AdaptiveQuality.ts`, heurística previa a esta sesión, no nueva). Un iPhone real dispara `coarsePointer=true` de forma fiable, así que `mobile` debería ser `true` y las luces de techo reales deberían estar apagadas. Rebajado a baja prioridad por este razonamiento, sin necesidad de una ablación dedicada — si los candidatos 1-2 no explican todo el hueco, esto se revisita con una comprobación directa de `dynamicCeilingLights` en tiempo real en el propio iPhone en vez de asumir.

## 4. Instrumentación de ablación añadida (apagada por defecto, solo por URL)

`src/client/WorldKit/ablation.ts` (nuevo) + tres puntos de lectura (`primitives.ts`, `storefrontDoor.ts`/`rearFarmDoor.ts`, `farm/animalStation.ts`) + un interruptor de nivel superior en `IntegralClient.tsx`. **Ningún comportamiento por defecto cambia** — verificado con el conjunto completo de pruebas y con una comprobación manual en navegador de cada bandera antes de este commit.

Parámetros de `/runtime` (se pueden combinar):

- `?ablate=text` — oculta las 160 instancias de texto en vivo (confirmado: 160→0 visibles).
- `?ablate=glass` — fuerza `transmission=0` en el vidrio de ambas puertas (confirmado: 4 superficies con transmisión → 0).
- `?ablate=animals` — oculta los animales de granja con esqueleto (confirmado).
- `?worldkit=0` — revierte esta misma build al bake `level30.glb` completo + jugador por navmesh, es decir, el comportamiento previo al port de hoy, en el mismo commit desplegado (confirmado: 0 instancias de texto, sin `WorldKit` en absoluto).

## 5. Plan de medición pedido al propietario (en el iPhone real, misma build `6b0b8c1` ya desplegada)

Repetir la prueba integral exacta (misma duración, mismo nivel 30) en cada una de estas URLs, dejando enfriar el dispositivo entre cada una, y anotar hueco medio/p95/p99, cadencia y si el teléfono se calienta:

1. `https://market.olcas.app/runtime` (línea base, ya medida: hueco p99 34 ms)
2. `https://market.olcas.app/runtime?worldkit=0` (control: debería volver a los ~17-18 ms fríos de las fases sintéticas si el port en su conjunto es la causa, no otra cosa)
3. `https://market.olcas.app/runtime?ablate=text`
4. `https://market.olcas.app/runtime?ablate=glass`
5. `https://market.olcas.app/runtime?ablate=text,glass`
6. `https://market.olcas.app/runtime?ablate=animals` (control secundario, sospecha baja)

Si (2) recupera el frame pacing frío, confirma que la causa está dentro del port de hoy (no en Rapier, ya descartado por medición). Si (3) o (4) por sí solas ya recuperan la mayor parte del margen, esa es la causa raíz demostrada — no una suposición — y entonces (y solo entonces) se decide cómo corregirla sin perder fidelidad. Si ninguna aisla el problema por completo, el candidato 4 (frecuencia de re-render de React/HUD) pasa a investigarse con la misma disciplina.

**No se ha tocado `/play2`. No se ha cerrado `docs/PROJECT-MAP.md`. No se ha optimizado ni reducido calidad en el camino por defecto — todo lo de este documento es diagnóstico apagado salvo que se pida explícitamente por URL.**

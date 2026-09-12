# Auditoría de rendimiento y batería móvil — Mini Market

Fecha: 2026-09-12  
Alcance: cliente Three.js/React Three Fiber, simulación, física, UI, carga de GLB y comportamiento en segundo plano.

## Actualización 2026-09-13: personaje pixelado y tirones al caminar

Queja del propietario tras la actualización anterior: el personaje se veía pixelado (no desenfocado) y el juego daba tirones al caminar. Medido con Chrome real + GPU (harness de paseo de 14 s con arrastre táctil real por CDP, viewport 390 × 844, DPR de dispositivo 3, CPU 4×; escritorio 1600 × 900, DPR 1, teclado) sobre la build de producción con QA.

Causas demostradas:

1. **La calidad adaptativa bajaba el DPR durante la carga y nunca lo devolvía.** `AdaptiveQualityController` muestreaba desde el primer frame: la decodificación de GLB y la compilación de shaders contaban como "presión sostenida" y a los 2,9 s de cargar regresaba el DPR una única vez de forma permanente. Medido: móvil 1,25 → 1,075 (framebuffer 419 × 907 estirado ×2,8 en un panel DPR 3) y **escritorio 1,0 → 0,86**. Eso es el pixelado. Ahora sólo mide con la escena lista más 2,5 s de gracia, el paso es acotado por `minDpr` y se devuelve tras 8 s de frames sanos.
2. **Tope de DPR demasiado bajo de base.** 1,25 móvil y 1,4 escritorio → ahora 2 en ambos.
3. **Pase de transmisión del cristal.** `renderTransmissionPass` de Three pone `toneMapping = NoToneMapping`, así que cada material opaco cambia de programa dos veces por frame: `getParameters` + `getProgramCacheKey` eran el 19 % de la CPU en móvil y la tienda entera se dibujaba dos veces mientras un cristal estaba en cámara. En móvil `glassTransmission: false` (tinte, opacidad, clearcoat y reflejo intactos; captura comparada sin diferencia apreciable); escritorio sin cambios.
4. **Dos bucles de paso fijo independientes.** El jugador acumulaba su propio `FixedStepLoop` a 60 Hz y Rapier el suyo; cuando sus fronteras caían en frames distintos la cápsula avanzaba dos pasos y luego ninguno. Ahora el paso del jugador corre en `useBeforePhysicsStep` (mismo acumulador), Rapier interpola la presentación, el giro se suaviza por frame y la cámara sigue la cápsula interpolada.
5. **Planificador móvil por tiempo.** `nextFrameAt += 16,67` deriva contra el vsync real; en paneles de 90/120 Hz produce cadencias 22/11 ms. Ahora cuenta ticks de `requestAnimationFrame` contra el refresco medido (`DisplayCadenceEstimator`) y presenta en un submúltiplo regular.
6. Las mallas fuente ocultas por el batching estático ya no recomponen su matriz cada frame (`updateMatrixWorld` era el 8,6 % restante).

Resultado caminando (misma escena, misma build salvo los cambios):

| Métrica | Móvil antes | Móvil después | Escritorio antes | Escritorio después |
|---|---:|---:|---:|---:|
| framebuffer | 419 × 907 (DPR 1,075) | 780 × 1688 (DPR 2) | 1376 × 774 (DPR 0,86) | 1600 × 900 (DPR 1) |
| rAF p50 / p90 / p95 / p99 | 16,7 / 33,4 / 33,4 / 50 ms | 16,7 / 16,7 / 16,7 / 16,8 ms | 16,7 / 16,7 / 16,8 / 16,8 ms | 16,7 / 16,7 / 16,7 / 16,8 ms |
| saltos de cadencia (>6 ms entre frames consecutivos) | 433 de 636 | 4 de 900 | 1 | 0 |
| frames > 25 ms | 276 | 2 | 1 | 0 |
| FPS mediano R3F | 41 | 60 | 60 | 60 |
| draw calls mediana | 337 | 177 | 260 | 260 |
| regresiones de DPR | 1 (a 1,075) | 0 | 1 (a 0,86) | 0 |

`pnpm qa:mobile-render` en reposo: 30 FPS exactos, 148 draws (antes 286), 0 regresiones, 0 tareas largas. El personaje móvil sigue usando el LOD1 (8.864 triángulos); a DPR 2 la silueta se ve limpia en la captura, así que no se generó un LOD intermedio.

### Interior de la tienda: draw calls

Caminando de forma continua hacia el fondo de la tienda (sin cristal en cámara) la CPU 4× seguía en 43–48 FPS medianos con ~343 draws. El desglose por frame (`window.__MARKET_PERF_DRAWS__()`, nuevo en la build de QA) lo atribuyó así: 70 lotes estáticos separados únicamente por el color del material, 128 `InstancedMesh` (la mayoría montantes, baldas, tubos y decoración fijos, una por mueble), 42 props decorativos `retail-product:*` excluidos del batching sólo por su nombre, y la granja (26 instancias de cultivo dinámicas + 30 mallas de cultivo/animales, también dinámicas).

`StaticMeshBatch` ahora hornea el color por vértice y expande las instancias estáticas ya colocadas dentro del mismo lote; los optimizadores pasan a ser el último hijo de cada raíz; la salida de las máquinas de proceso cuelga de `dynamic:machine-output` y `retail-product:*` deja de ser un límite de batching (los anchors de stock siguen bajo `retail-stock:*`). Capturas antes/después del interior comparadas píxel a píxel a ojo: idénticas.

| Interior, CPU 4×, caminando 13 s | Antes | Después |
|---|---:|---:|
| draw calls mediana | 343 | 183 |
| FPS mediano R3F | 43 | 60 |
| rAF p50 / p90 / p95 / p99 | 16,7 / 33,4 / 33,4 / 50 ms | 16,7 / 16,7 / 16,8 / 33,4 ms |
| frames > 25 ms | 174 de 658 | 30 de 784 |
| saltos de cadencia | 280 | 20–56 |
| envío de draws por frame | — | 7,8 ms |

Lo que queda son lotes que difieren en rugosidad/metalidad/textura (30 en mobiliario, 12 edificio, 10 ciudad), los cultivos y animales dinámicos de la granja (38) y transparentes/textos (27). Reducirlos exigiría atributos de rugosidad por vértice con shader propio o re-agrupar la granja en cada cambio de estado; no compensa con el resultado actual.

## Actualización de fluidez y nitidez móvil

Después de validar la primera versión en un iPhone real, el perfil de ahorro puro resultó visualmente demasiado blando y el límite fijo de 30 FPS hacía perceptible la cadencia durante locomoción. Esta actualización sustituye ese compromiso por un perfil híbrido:

- 30 FPS exactos cuando el jugador está quieto y 60 FPS solicitados únicamente mientras se desplaza;
- DPR 1,25 con MSAA en móvil (419 × 907 en el viewport de prueba 390 × 844), con regresión adaptativa mínima de 1,0 ante presión sostenida;
- cámara ortográfica con `zoom` 1,3×, sin cambiar posición relativa, ángulo ni orientación;
- tick autoritativo del mundo de 10 a 5 Hz, conservando física/presentación a 60 Hz y todas las reglas basadas en `deltaTime`;
- batching adicional exclusivamente para suelo y ciudad estáticos: 333 meshes fuente en 57 lotes, 276 draws teóricos ahorrados; puertas, productos y objetos interactivos siguen separados.

Build de producción con QA, Chrome móvil 390 × 844 y CPU 4×:

| Escenario | FPS mediano | frame mediano / p95 | tareas largas | draws mediana / máx. | triángulos mediana / máx. |
|---|---:|---:|---:|---:|---:|
| quieto | 30 | 33,33 / 33,4 ms | 0 | 286,5 / 322 | 299.658 / 308.990 |
| caminando | 43 | 23,49 / 50 ms | 1 (50 ms) | 347 / 363 | 339.793 / 353.852 |

El inventario visible típico bajó de 558 meshes en la auditoría inicial a 446–448, sin pérdida de contenido. Esta sección reemplaza los parámetros finales 30 FPS/DPR 0,9/sin MSAA descritos más abajo; las tablas posteriores se conservan como historial A/B de la primera fase de ahorro energético.

## Resumen ejecutivo

La causa dominante del consumo no era una sola malla defectuosa: el móvil presentaba la escena continuamente a unos 60 FPS, con MSAA, preferencia `high-performance`, un framebuffer de 469 × 1016 y sombras dinámicas. El teléfono podía sostener esa carga, por lo que el navegador continuaba usando GPU/CPU aunque el jugador estuviera quieto.

El perfil móvil final presenta a 30 FPS, usa un framebuffer de 351 × 759, desactiva MSAA, solicita `low-power`, reduce el shadow map de 1024² a 512², congela la sombra estática después del calentamiento, renderiza la transmisión de cristal a media resolución, elimina cuatro luces puntuales redundantes conservando sus lámparas emisivas y detiene render/simulación periódica al ocultar la página. La simulación autoritativa y Rapier siguen desacoplados mediante tiempo real/delta y paso fijo.

En el escenario idéntico de jugador quieto, los cambios redujeron el tiempo de tareas del navegador un 38,3 %, el tiempo de script un 39,3 %, los píxeles principales por frame un 44,1 % y las presentaciones por segundo un 50 %. En una carga normal abierta, las tareas bajaron un 42,6 % y el script un 40,3 %. No se alteraron los 320 draw calls ni los 323.788 triángulos del contenido quieto: esa igualdad demuestra que la ganancia proviene de eliminar trabajo de presentación, no de borrar objetos o degradar arbitrariamente el escenario.

## Límites de la medición

Una página web no puede leer de forma portable la temperatura del SoC, los vatios de GPU ni la corriente exclusiva de una pestaña. Por ello:

- GPU: se midieron frecuencia de presentación, resolución interna, pases, draw calls, triángulos, programas, luces/sombras y un proxy extremo con SwiftShader.
- CPU: se midieron `TaskDuration`, `ScriptDuration`, long tasks, frame timing y heap mediante Chrome DevTools Protocol.
- memoria: se midieron heap JS, recursos WebGL y el inventario vivo de escena; la VRAM exacta no está expuesta por WebGL.
- batería/temperatura: las reducciones son proxies sólidos, pero la cifra física final debe obtenerse en un teléfono real con Power Profiler/Perfetto bajo condiciones controladas.

No se presenta una temperatura o porcentaje de batería inventado.

## A. Arquitectura actual

### Render

- Existe un único `Canvas`/renderer R3F en `src/components/game/MarketScene.tsx:227`.
- No hay creación manual de `THREE.WebGLRenderer`, `renderer.render`, `renderer.setAnimationLoop` ni canvases 3D secundarios.
- Móvil usa `frameloop="never"` y un planificador autoritativo de 30 Hz en `MarketScene.tsx:317-355`.
- Escritorio conserva el loop normal de 60 Hz.
- Perfil de DPR, AA, sombras, transmisión y preferencia de energía: `src/game/render/AdaptiveQuality.ts:19-89`.
- El DPR solo baja tras presión sostenida; no se llama `setPixelRatio` cada frame (`MarketScene.tsx:422-447`).
- Environment y ContactShadows se calculan una sola vez (`MarketScene.tsx:251,297-303`).
- Una única DirectionalLight proyecta sombra (`MarketScene.tsx:449-470`).

### Trabajo por frame visible

| Sistema | Cadencia móvil | Trabajo |
|---|---:|---|
| Presentación R3F/WebGL | 30 Hz | Render principal, mixers, cámara y callbacks `useFrame` |
| Jugador | paso fijo lógico 60 Hz dentro de presentación | input, controlador Rapier, movimiento `velocity * dt`, sensores |
| Rapier | 1/60 fijo | colisiones simples del jugador/puertas |
| Cámara | 30 Hz | interpolación de posición/target con delta |
| Clientes/empleados visibles | 30 Hz | proyección de ruta, orientación, animación |
| Personajes fuera de vista | dormido visualmente | mixer `timeScale=0`, sin cara/IK/accesorios |
| Puertas/máquinas activas | 30 Hz | solo transformaciones pequeñas |
| Transferencias de producto | 30 Hz | temporales reutilizados; duración por tiempo transcurrido |
| Métricas | 2 Hz, solo QA | lectura de `renderer.info`, sin DOM a 60 Hz |

### Cadencias no gráficas

| Sistema | Cadencia | Segundo plano |
|---|---:|---|
| Mundo | 10 Hz | detenido |
| Simulación económica/IA | 0,2 Hz | detenida |
| Autosave periódico | cada 15 s | detenido; guarda una vez al ocultar |
| Interacción | por sensor/input | sin raycast global |
| UI React | por cambio de store | no recibe `setState` por cada frame de animación |

Implementación: `src/components/game/GameRuntime.tsx:22-62`.

### Sistemas buscados y ausentes

No existen `EffectComposer`, bloom, SSAO/GTAO, SSR, DOF, TAA/FXAA/SMAA adicionales, CubeCamera, espejos, reflection probes dinámicos, render targets de cámaras de vigilancia, minimapa 3D, VideoTexture, CanvasTexture dinámica, partículas masivas, ShaderMaterial propio, `logarithmicDepthBuffer`, `Raycaster.intersectObjects(scene.children, true)` ni polling de red rápido. Las cámaras de seguridad del decorado son geometría estática; no renderizan una segunda vista.

## B. Baseline e inventario vivo

Entorno común: build de producción con QA, Chrome móvil 390 × 844, device scale 2, CPU 4×, misma revisión de escena/assets. El baseline histórico se conserva únicamente detrás de `NEXT_PUBLIC_MARKET_QA_ENABLED=1` + `?perf&perf-baseline`; no queda accesible en producción pública.

Inventario típico con supermercado abierto:

| Tipo | Cantidad |
|---|---:|
| Object3D | 1.488 baseline / 1.484 final |
| visibles | 1.270 / 1.266 |
| Mesh | 558 |
| InstancedMesh | 143 |
| SkinnedMesh / skeletons | 2 / 2 |
| Sprite | 0 |
| luces totales | 7 / 3 |
| luces con sombra | 1 / 1 |
| shadow casters / receivers | 94 / 168 |
| objetos transparentes | 80 |
| asignaciones DoubleSide | 61 |
| geometrías únicas de escena | 555 |
| materiales únicos | 557 |
| texturas únicas referenciadas en escena | 6 |
| MeshStandardMaterial | 477 |
| MeshPhysicalMaterial | 15 |
| MeshBasicMaterial | 66 |

El contador WebGL durante render llegó a 21 texturas y 33 programas finales; incluye targets/recursos internos, por eso no coincide exactamente con el recorrido de materiales.

### Distribución geométrica típica

| Grupo | Mesh | InstancedMesh | Triángulos |
|---|---:|---:|---:|
| ciudad/exterior | 120 | 1 | 7.954 |
| edificio | 36 | 0 | 724 |
| muebles/productos | 310 | 109 | 201.118 |
| granja | 77 | 33 | 37.002 |
| jugador LOD móvil | 2 | 0 | 8.888 |
| cliente LOD móvil | 2 | 0 | 5.988 |

El batching estático existente consolida 215 mallas en 49 lotes, ahorrando 166 draws. Los productos repetidos ya usan InstancedMesh con identificación/transformaciones conservadas. No se sustituyó este sistema por un merge indiscriminado.

## C. Diez problemas principales

| # | Problema demostrado | Severidad | Impacto | Archivo/línea | Solución | Riesgo |
|---:|---|---|---|---|---|---|
| 1 | render continuo cercano a 60 Hz incluso quieto | crítico | GPU, CPU, batería, calor | `MarketScene.tsx:227,317-355` | scheduler móvil 30 Hz | bajo; delta/paso fijo verificados |
| 2 | framebuffer 469 × 1016 en 390 × 844 | crítico | fill-rate, overdraw, VRAM temporal | `AdaptiveQuality.ts:42-69` | DPR móvil 0,8–0,9; mínimo adaptativo 0,75 | bajo-medio; ligera suavidad |
| 3 | MSAA + `high-performance` en móvil | alto | GPU y selección energética | `AdaptiveQuality.ts:53-58` | AA off y `low-power` móvil | bajo; captura visual aprobada |
| 4 | cuatro PointLights de techo sobre iluminación ya emisiva | alto | fragment shading/programas | `MarketKit.tsx:949-983` | emisivo sin PointLight en móvil | bajo; escritorio intacto |
| 5 | sombra 1024² actualizada continuamente | alto | pase de sombra y fill-rate | `MarketScene.tsx:449-470` | 512²; congelar tras 3 actualizaciones de carga | medio; vigilar objetos móviles |
| 6 | 15 materiales físicos; cristal con transmisión a resolución completa | alto en GPU limitada | render intermedio | `MarketScene.tsx:282-295`; cristales en `MarketKit.tsx` y `MarketScene.tsx` | transmission scale 0,5 móvil | bajo-medio; vidrio conserva propiedades |
| 7 | render/timers activos al ocultar pestaña | alto | batería en background, delta gigante | `MarketScene.tsx:329-353`; `GameRuntime.tsx:22-62` | cancelar RAF/timers, guardar al ocultar y reiniciar reloj | bajo |
| 8 | personajes fuente de cientos de miles de triángulos | alto en carga máxima | vertex/skin GPU, RAM/VRAM | `CharacterPresentation.ts:63-90,178-195` | cargar solo LOD1/LOD2 por capacidad; dormir offscreen | medio; rigs/51 clips verificados |
| 9 | arrays/filtros temporales durante ráfagas de producto | medio | GC/CPU durante interacción | `MarketScene.tsx:497-602` | bucles sin asignación y contador incremental | bajo |
| 10 | 80 transparentes, 61 DoubleSide y 345 draws típicos | medio, pendiente | overdraw/sorting/GPU | inventario QA `MarketScene.tsx:706-816` | conservar por fidelidad; auditar asset por asset antes de tocar | medio-alto visual |

## D. Comparativa antes/después

### Jugador quieto, mundo congelado

| Métrica | Antes | Después | Cambio |
|---|---:|---:|---:|
| presentaciones | 60 FPS | 30 FPS estables | -50 % |
| frame de presentación | 16,67 ms | 33,33 ms | presupuesto intencional 30 Hz |
| p95 frame | 19,3 ms | 33,5 ms | estable dentro de 30 Hz |
| draw calls/frame | 320 | 320 | sin borrar contenido |
| triángulos/frame | 323.788 | 323.788 | sin pérdida visual |
| textura WebGL máx. | 15 | 15 | igual |
| programas máx. | 36 | 32 | -11,1 % |
| resolución interna | 469 × 1016 | 351 × 759 | -44,1 % píxeles/frame |
| TaskDuration | 10.288,6 ms | 6.348,9 ms | -38,3 % |
| ScriptDuration | 9.833,6 ms | 5.966,7 ms | -39,3 % |
| heap JS al cierre | 69,4 MB | 62,9 MB | -9,3 %; valor ruidoso |

Esta es la prueba más importante: quieto ya no intenta producir todos los frames que admita una pantalla de 60/90/120 Hz.

### Supermercado abierto, carga normal

| Métrica | Antes | Después | Cambio |
|---|---:|---:|---:|
| FPS intentados/obtenidos | 57 | 30 estables | carga de presentación casi a la mitad |
| draw calls mediana/máx. | 345 / 377 | 345 / 377 | mismo contenido |
| triángulos mediana/máx. | 364.080 / 373.232 | 364.080 / 373.232 | mismo contenido |
| programas máx. | 50 | 33 | -34 % |
| luces | 7 | 3 | -57,1 % |
| luces con sombra | 1 | 1 | igual |
| TaskDuration | 12.865,6 ms | 7.379,9 ms | -42,6 % |
| ScriptDuration | 11.638,3 ms | 6.951,8 ms | -40,3 % |

### Caminando

| Métrica | Antes | Después | Cambio |
|---|---:|---:|---:|
| FPS | 46 inestables | 30 estables | frame pacing estable |
| frame mediano / p95 | 21,76 / 34,3 ms | 33,33 / 33,5 ms | elimina jitter |
| TaskDuration | 11.879,6 ms | 9.455,5 ms | -20,4 % |
| ScriptDuration | 11.459,3 ms | 8.999,3 ms | -21,5 % |
| draw calls mediana | 416,5 | 417 | contenido equivalente |

### Proxy de GPU muy lenta

El proxy SwiftShader no representa la batería de un teléfono, pero sí magnifica el fill-rate/pase de transmisión:

| Métrica | Baseline | Final | Cambio |
|---|---:|---:|---:|
| FPS mediano | 4 | 11 | 2,75× |
| frame mediano | 250 ms | 94,45 ms | -62,2 % |
| p95 | 250 ms | 116,7 ms | -53,3 % |
| buffer | 403 × 873 | 301 × 653 | -44,2 % píxeles |
| programas | 50 | 35 | -30 % |

Al comparar el perfil optimizado antes/después de reducir únicamente la transmisión, el frame mediano observado pasó de 129,15 a 94,45 ms. Como las muestras no son una captura GPU de hardware y la población visible varía ligeramente, se trata como evidencia direccional, no como porcentaje físico garantizado.

## E. Escenarios A–H

| Escenario | Evidencia | Resultado |
|---|---|---|
| A. quieto | freeze A/B, 24 ventanas | 30 FPS; CPU/script -38–39 % |
| B. caminando | input ArrowUp A/B | 30 FPS estable; script -21,5 % |
| C. zona densa | máximo durante recorrido | 471 calls y 392.672 triángulos, sin error |
| D. zona sencilla | inicio exterior/tienda cerrada | 320 calls y 323.788 triángulos |
| E. interior | tienda abierta, cliente + muebles | 345 calls, 364.080 triángulos |
| F. exterior | cámara inicial sobre entrada/exterior | cubierto por prueba quieta y captura visual |
| G. interacción | transferencia de leche forzada a 5 FPS | 3/3 unidades; lag 1.122 ms < 1.500; WebGL estable |
| H. máxima carga | 30 clientes + 4 empleados en móvil | 30 FPS, p95 33,4 ms, 630 calls, 634.852 triángulos |

En el estrés de escritorio, los modelos completos producían 5.450.671 triángulos. El estrés móvil quedó en 634.852: -88,35 % gracias a seleccionar un único LOD móvil por actor. Los 630 draws incluyen el mundo de depuración, hitboxes y 31.704 líneas; producción no muestra esos helpers.

## F. Auditoría por subsistema

### Sombras y luces

- AmbientLight: 1, sin sombra.
- DirectionalLight principal: 1, única con sombra, 512² móvil / 1024² escritorio, `far=30 * WORLD_SCALE`.
- luces auxiliares activas según caja/escena: sin sombra.
- cuatro PointLights de techo: eliminadas solo en móvil; los GLB de lámpara permanecen y su material emisivo conserva el aspecto encendido.
- ContactShadows y Environment: `frames=1`, no se reprocesan continuamente.
- Shadow casters: 94; receivers: 168. Los personajes reducidos/no protagonistas no proyectan sombra individual.

La sombra móvil es híbrida: escenario congelado tras calentamiento; contacto/actores mantienen sus soluciones visuales baratas. Riesgo conocido: un objeto móvil que dependa exclusivamente de la DirectionalLight no refrescará su sombra en móvil. Las puertas, carros y productos se validaron visualmente y no se observó regresión crítica.

### Materiales, transparencia y overdraw

- 477 Standard, 15 Physical, 66 Basic.
- Los Physical se justifican en vidrio/personajes entregados; no se convirtieron globalmente.
- Los cristales mantienen `transparent`, opacity, transmission, clearcoat y depthWrite authored; solo su target de transmisión baja a 0,5 en móvil.
- 80 objetos transparentes y 61 DoubleSide siguen siendo el mayor margen GPU pendiente.
- No se desactivó sorting global ni se cambió cristal a opaco/alphaTest porque produciría una regresión visible.

### Draw calls, geometría y culling

- Productos repetidos: InstancedMesh y recursos compartidos.
- Escenario estático: batching seguro solo para meshes opacos, mismo material y sin interacción; 166 draws ahorrados.
- No se fusionan estantes, productos, puertas ni objetos que necesitan identidad individual.
- Frustum culling permanece activo; no se encontró `frustumCulled=false` injustificado.
- Personajes usan bounds conservadores y duermen mixer/cara/IK fuera de cámara.
- No se implementó culling por pasillos todavía: la cámara ortográfica aérea ve varias zonas simultáneamente y ocultar por celda sin un sistema de portales probado tiene alto riesgo de popping.

### GLB, texturas y memoria

- 203 GLB validados: 0 fallos.
- Peso GLB total servido: 88.842.192 bytes, pero no se cargan todos simultáneamente.
- Solo cuatro texturas externas WebP, todas 512² y entre 36–68 KB.
- Los atlas embebidos de personajes usan mipmaps y caché; geometría/texturas fuente se comparten, materiales por actor se liberan al desmontar.
- El preload de personajes prioritarios se reparte con `requestIdleCallback`/timeouts, no dispara todas las decodificaciones a la vez.
- No se añadió Draco/Meshopt/KTX2: el cuello medido era presentación/fill-rate y añadir otro decodificador no reduce automáticamente VRAM ni draw calls. KTX2 queda como experimento futuro para atlas embebidos grandes, con comparación visual y de decode.

### Animación, IA, física y raycasting

- Mixers: uno por SkinnedMesh activo; 2 en carga típica, hasta 34 actores en estrés.
- Offscreen: `timeScale=0`; rostro/IK/accesorios no se actualizan.
- IA/economía: 0,2 Hz, fuera del render y autoritativa en `engine.ts`.
- Navegación visual usa snapshots y tiempo; no cuenta frames.
- Física: Rapier, paso fijo 1/60, colliders simplificados; no usa las mallas GLB como collider complejo.
- Interacción: sensores/proximidad y listas específicas, no raycast recursivo contra toda la escena.
- Prueba a 5 FPS confirmó que stock/interacción termina por tiempo real, sin dependencia de frame count.

### Asignaciones, GC, búsquedas y traversal

- Se eliminaron `Array.from(...).forEach` y `filter(Boolean)` de los loops de transferencia.
- Vectores, matrices, quaternion, frustum y sphere críticos se guardan en refs/scratch reutilizable.
- `scene.traverse` por frame solo ocurre durante el breve warm-up de compilación; termina al marcar la escena lista.
- Traversals e inventarios periódicos restantes están dentro del modo QA, no en producción pública.
- `getObjectByName` repetido a 250 ms también está limitado a QA.
- El batching estático fija `matrixAutoUpdate=false` después de hornear la matriz; dinámicos conservan actualización normal.

### UI, eventos, audio, timers y red

- El panel de métricas actualiza cada 500 ms, no cada frame.
- No se encontró lectura/escritura DOM intercalada por frame ni polling API agresivo.
- Eventos input/resize/visibility tienen cleanup; movimiento 3D vive en refs y no hace `setState` React a 60 Hz.
- Audio no crea nodos por frame. Al ocultar la página se suspenden los procesos visuales; el comportamiento de reproducción debe validarse en la prueba física de PWA según política del navegador.
- Guardado: 15 s visible + una vez al ocultar; no se modificó concurrencia optimista ni autoridad de servidor.

### Shaders, depth y cámara

- No hay shaders personalizados que auditar ni cambios de defines por frame.
- No existe `logarithmicDepthBuffer`.
- Cámara ortográfica con rango apropiado para la escala del supermercado; no usa `near=0.0001/far=100000`.
- Los programas bajaron de 50 a 33 en carga normal por simplificar el perfil móvil, sin un cambio global de precisión.

## G. Sistema de diagnóstico

El probe opcional publica pocas veces por segundo:

- FPS, frame medio y p95;
- calls, triangles, points y lines;
- geometrías, texturas y programas WebGL;
- resolución interna, DPR/perfil y modo de sombra;
- Object3D, Mesh, InstancedMesh, SkinnedMesh, Sprite, lights/shadow lights;
- casters/receivers, transparencias, DoubleSide, materiales por tipo, skeletons;
- grupos de escena y ahorro de batching.

Implementación: `src/game/debug/PerformanceMonitor.ts`, `src/components/game/MarketScene.tsx:706-816` y `scripts/qa-mobile-render-budget.mjs`.

El benchmark guarda muestras y calcula promedio/mediana, mínimo, máximo, p50, p95 y p99 según la métrica. También captura long tasks, heap, nodos, listeners, errores de consola/página/red, input táctil y pérdida de contexto WebGL.

## H. Calidad adaptativa y modo batería

Perfil móvil normal/batería actual:

- 30 FPS;
- DPR inicial 0,8–0,9;
- DPR mínimo 0,75 si el frame supera 40 ms de forma sostenida;
- histéresis de 420 ms, recuperación de presión 2× y cooldown 1.200 ms;
- un solo descenso por sesión para impedir oscilación visible;
- MSAA off, low-power, shadow 512, transmission 0,5;
- luces puntuales de techo omitidas; luminarias emisivas visibles;
- personajes LOD1 o LOD2 según puntero, viewport, cores, memoria y DPR observado.

Se eligió no volver a subir calidad durante la misma sesión. La prioridad explícita es batería/temperatura y un upscale posterior provocaría oscilación y aumentaría consumo tras una ventana breve de margen. Al recargar se reevalúa el dispositivo desde el perfil inicial. Esta decisión puede ampliarse a tiers LOW/MEDIUM/HIGH si las pruebas físicas muestran que un móvil potente tiene margen energético real, no solo FPS libres.

La degradación térmica indirecta queda cubierta parcialmente: si el frame sostenido empeora, el DPR baja. No se afirma medir temperatura, ya que el navegador no la expone.

## I. Regresiones verificadas

- 317 tests Vitest pasan.
- TypeScript pasa.
- Build Next de producción pasa.
- 203 GLB pasan validación, 0 fallos.
- jugador, cámara, clientes, empleados, carro, agarres, caja, puertas, stock, animaciones y colisiones pasan QA automatizado.
- 30 clientes + 4 empleados: 30 FPS móvil, p95 33,4 ms, sin contexto perdido ni errores.
- transferencia a 5 FPS: correcta y dentro del tiempo límite.
- capturas baseline/final comparadas: composición, colores, iluminación y cristales conservados razonablemente.
- no se encontraron objetos desaparecidos, animación visible congelada, productos no interactuables, z-fighting nuevo ni texturas rotas.

El lint termina sin errores y mantiene cuatro warnings preexistentes por componentes de exhibición definidos pero no montados en `MarketKit.tsx`. No afectan runtime ni se borraron porque hacerlo no mejora el bundle ya tree-shaken y mezclaría limpieza funcional con esta auditoría.

## J. Riesgos y trabajo futuro priorizado

1. **Medición física Android (alta):** ejecutar sesiones de 20–30 minutos y registrar corriente, GPU/CPU rails y thermal throttling.
2. **Transparencia/DoubleSide (media):** identificar material por asset y probar FrontSide/opaque solo donde sea visualmente idéntico.
3. **Draw calls muebles (media):** 310 meshes/109 instanced; continuar batching solo con prueba de identidad/raycast.
4. **KTX2 para atlas embebidos (media):** medir decode, RAM y VRAM en Android antes de conservar.
5. **Culling por sectores (media):** prototipo con bounds visibles y margen para cámara isométrica; rechazar si produce popping.
6. **Anisotropía de personajes (baja):** actualmente alta para el atlas; probar 4× en LOD móvil con captura ampliada de rostros.
7. **Sombras móviles dinámicas selectivas (baja):** invalidar únicamente si un futuro objeto importante necesita sombra proyectada móvil.
8. **Audio background (baja):** confirmar suspensión efectiva en la PWA instalada de cada navegador objetivo.

No se recomienda bajar indiscriminadamente texturas a 512, eliminar cristales/sombras, fusionar objetos interactivos ni introducir BVH: las métricas no justifican esos riesgos hoy.

## K. Cómo perfilar en un Android real

### Chrome Remote Debugging

1. Activar Opciones de desarrollador y Depuración USB.
2. Conectar el móvil por cable y aceptar la huella de depuración.
3. En Chrome de escritorio abrir `chrome://inspect/#devices`, activar **Discover USB devices** y pulsar **Inspect** en la pestaña de `market.olcas.app`.
4. Desactivar el screencast durante la medición porque altera los FPS.
5. En Performance grabar exactamente 60 s por escenario: quieto, caminar, interior denso, exterior, interacción y estrés.
6. Revisar Frames, Main, Task/Scripting/Rendering/Paint, long tasks y GC; guardar cada trace con nombre de dispositivo/escenario/modo.
7. En Memory comparar heap snapshots antes/después de entrar/salir cinco veces de una zona; buscar crecimiento retenido.
8. En Network confirmar que no haya polling continuo ni recarga repetida del mismo GLB.

Guías oficiales: [Remote debug Android devices](https://developer.chrome.com/devtools/docs/remote-debugging) y [Analyze runtime performance](https://developer.chrome.com/docs/devtools/performance).

### Batería, GPU y temperatura

1. Cargar al mismo porcentaje, brillo fijo, mismo Wi-Fi, modo avión excepto Wi-Fi, cerrar otras apps y dejar enfriar el móvil.
2. Ejecutar 5 min de warm-up y luego 20–30 min por perfil; alternar el orden A/B para reducir sesgo térmico.
3. En Android Studio abrir System Trace/Power Profiler. En dispositivos compatibles ODPM permite correlacionar rails CPU, GPU, memoria, pantalla y red; en otros usar contador de carga/corriente.
4. Capturar una traza del sistema/Perfetto y buscar caída sostenida de frecuencia, jank, CPU scheduling, memoria y eventos de potencia.
5. Registrar: batería inicial/final, mAh/µAh cuando exista, temperatura inicial/final accesible por herramienta, FPS p50/p95/p99, frecuencia GPU/CPU y tiempo hasta throttling.
6. Repetir al menos tres veces y usar la mediana, no una sola corrida.

Referencias oficiales: [Android Power Profiler](https://developer.android.com/studio/profile/power-profiler), [System tracing](https://developer.android.com/topic/performance/tracing) y [profile types overview](https://developer.android.com/topic/performance/tracing/profile-types-overview).

### Criterio de aceptación físico

- 30 FPS estables en modo batería, p95 ≤ 40 ms en juego normal.
- ninguna pérdida de contexto WebGL ni crecimiento de memoria sostenido por ciclos de zona.
- menor corriente/consumo mediano que el baseline durante quieto y recorrido.
- temperatura estabilizada inferior o tiempo a throttling claramente mayor.
- sin diferencia visual material en cristales, iluminación, personajes y productos a distancia normal de juego.

## Conclusión

La batería se gastaba principalmente por presentar demasiados frames y píxeles, con una configuración de GPU agresiva y varios pases que seguían activos aunque la escena no lo necesitara. La optimización final reduce ese trabajo sin cambiar la geometría normal del supermercado ni las reglas del juego. Quedan oportunidades en transparencias/draw calls, pero son de riesgo visual mayor y deben abordarse únicamente después de una sesión física Android que demuestre que siguen siendo cuello de botella.

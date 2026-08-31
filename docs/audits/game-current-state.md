# Auditoría base anterior a la reconstrucción de personajes

Fecha: 2026-08-29
Ámbito: repositorio local `/home/ferney_oliveros/Mini Market`, sin despliegue
Especificación: `/home/ferney_oliveros/Descargas/KIT MARKET/INSTRUCCIONES_CODEX_SUPERMERCADO_3D.txt`

> Documento histórico: conserva el diagnóstico que motivó la reconstrucción. El estado vigente y la matriz final están en `docs/PROJECT-MAP.md`, `docs/audits/spec-compliance.md` y `docs/art/reference_manifest.json`; las secciones posteriores de este archivo describen deliberadamente el prototipo anterior.

## Resultado de la reconstrucción (2026-08-29)

- Se eliminaron los 18 GLB heredados, `AvatarHair.tsx`, `AnimalHat.tsx` y los dos scripts de reparación.
- Se generaron desde cero 4 cuerpos jugables, 6 visitantes, 16 peinados y 12 gorros mediante una fuente Blender propia.
- Cada cuerpo nuevo contiene 39 clips, 19 morph targets y el rig requerido; el conjunto final de 119 GLB —99 canónicos y 20 LOD— valida con cero errores y cero advertencias.
- `Walk`, `Enter`, `CarryBasket` y `Exit` tienen locomoción completa. Tras corregir el offset infantil, la suela no penetra el suelo: el mínimo medido es 0,24 mm.
- El E2E real cargó personalización, mundo y visitantes sin errores de consola, página, red ni modelos y confirmó la RTX 4080 SUPER mediante WebGL/Vulkan.

## Dictamen inicial

La aplicación actual es un prototipo funcional con autenticación, guardado, economía, escena 3D y PWA, pero todavía no cumple la definición de terminado de la especificación maestra. En particular, el control principal depende de teclado o de un joystick fijo móvil, las actividades ordinarias requieren una acción explícita, los clientes siguen rutas rígidas y los personajes proceden de una línea GLB heredada con errores de validación. Cabello, gorros, muebles y cultivos se construyen con primitivas en tiempo de ejecución y son provisionales.

Por instrucción expresa del usuario, los 18 GLB de personajes actuales se consideran legado no reutilizable. La sustitución será atómica: se construirán fuentes nuevas en Blender usando solo las PNG, se integrarán y validarán, y entonces se eliminarán los binarios antiguos y los componentes procedurales de apariencia.

## Carpetas y puntos de entrada

- `src/app/page.tsx`: decide entre autenticación y carga diferida del juego.
- `src/components/game/GameShell.tsx`: HUD, paneles, interacción, caja y composición de la escena.
- `src/components/game/GameRuntime.tsx`: carga, simulación periódica, guardado y service worker.
- `src/components/game/MarketScene.tsx`: `Canvas`, cámara, jugador, clientes, empleados, edificio, input por frame y zonas.
- `src/components/game/MarketKit.tsx`: mobiliario, máquinas, utilería y huerta procedurales.
- `src/game/engine.ts`: economía pura y autoridad de las acciones de simulación.
- `src/game/store.ts`: Zustand, recuperación local, sincronización y conflicto optimista.
- `src/app/api/game/save/route.ts`: carga y guardado autoritativo en PostgreSQL.

## Input y controlador del jugador

- `MarketScene.tsx/Player` escucha WASD, flechas, `E`, espacio y gamepad.
- `GameShell.tsx/MobileControls` implementa un joystick fijo visible solo bajo el breakpoint móvil y un botón `ACCIÓN`.
- `src/components/game/input.ts` contiene un vector global mutable usado por el joystick.
- Las fuentes se suman antes de normalizarse. No existe todavía selección por mayor magnitud ni mapeo según los ejes proyectados de cámara.
- El desplazamiento usa `position += velocity * delta` y colisiones AABB personalizadas de `world-scale.ts`; `@react-three/rapier` está instalado pero no se usa.
- No existe cuerpo cinemático, cápsula, shape cast, raycast de suelo ni paso fijo lógico.

## Interacción actual y dependencia de E

Zonas definidas en `MarketScene.tsx`: `farm`, `mill`, `bakery`, `shelf`, `checkout`, `supplier`, `office` y `door`.

Se disparan mediante:

- `E` o espacio desde `MarketScene.tsx`.
- Botón A del mando.
- Botón táctil `ACCIÓN`.
- Botón DOM emergente con texto «Acércate y pulsa».

Efectos actuales:

- `farm` despacha `HARVEST`.
- `mill` despacha `LOAD_FLOUR_MILL`.
- `bakery` despacha `BAKE_BREAD`.
- `shelf`, `supplier` y `office` abren paneles.
- `checkout` bloquea al jugador y abre una consola modal de caja.
- `door` despacha `TOGGLE_STORE`.

No hay sensores con histéresis, dwell, prioridad ni cadencia. El primer bloque sustituirá las acciones productivas ordinarias por permanencia automática; los paneles administrativos seguirán siendo UI explícita y marcarán sus elementos con `data-game-ui-interactive="true"`.

## Animación y modelos actuales

### Carga en ejecución

- `Avatar.tsx`: cuatro `*_kit_v2.glb`, `SkeletonUtils.clone`, `useAnimations` y accesorios procedurales sobre `Head`.
- `Customer.tsx`: seis `customer*_kit_v1.glb`, una instancia y `AnimationMixer` por visitante.
- Marcha actual: 73 muestras, clip in-place y animación matemática generada por `scripts/fix-character-walks.mjs`.

### Inventario GLB y validación

Todos los GLB actuales tienen `0` morph targets. Los cuatro avatares v2 tienen entre 22.730 y 53.352 triángulos; los seis clientes, entre 45.832 y 58.404. Cada rig tiene 20 o 21 huesos.

| Familia | Archivos | Clips | glTF Validator |
|---|---:|---:|---:|
| Avatares `*_kit_v2` | 4 | 15 por archivo | 32 errores, 1 warning por archivo |
| Clientes `customer*_kit_v1` | 6 | 24 por archivo | 120 errores, 1 warning por archivo |
| Bases `store_owner_*` | 4 | 15 por archivo | 2 errores, 1 warning por archivo |
| Bases `*_kit_v1` restantes | 4 | 15 por archivo | 32 errores, 1 warning por archivo |

Errores dominantes: `ANIMATION_SAMPLER_INPUT_ACCESSOR_WITHOUT_BOUNDS`, `ACCESSOR_ANIMATION_INPUT_NON_INCREASING` y `ANIMATION_DUPLICATE_TARGETS`. El último fotograma temporal de la reparación matemática vuelve a cero, por lo que el accessor deja de ser estrictamente creciente. Estos archivos no se repararán: serán eliminados tras integrar los reemplazos limpios.

### Clips existentes frente a clips requeridos

Los avatares actuales ofrecen `Idle`, `Walk`, `Run`, `Enter`, `Wave`, `ReceiveOrder`, `LiftBox`, `CarryBox`, `StockLow`, `StockHigh`, `ScanItem`, `Pay`, `Plant`, `Harvest` y `Happy`. Faltan, entre otros, `TurnLeft`, `TurnRight`, `CarryIdle`, `CarryWalk`, `HarvestLow/High`, `PickupLow/High`, `StockMid`, `CheckoutScan/Bag`, `ReceiveBag`, `Confused`, `Impatient`, `Talk`, `LookAround`, `Phone` y `Exit` en los cuatro avatares.

## Láminas PNG reales

Todas están en `/home/ferney_oliveros/Descargas/KIT MARKET/`:

- Personajes: `PERSONAJES.png`, `VENDEDOR HOMBRE.png`, `cliente1.png` a `cliente6.png`.
- Apariencia: `PEINADOS.png`, `GORROS.png`.
- Movimiento: `POSES DUEÑO.png`, `ANIMACIONES.png`.
- Mundo: `MOBILIARIO.png`, `MOBILIARIO2.png`, `HUERTA.png`.

Las láminas de personajes, clientes, gorros y mundo miden 1536×1024; `PEINADOS.png` mide 1254×1254. No hay modelos 3D fuente aceptados ni vistas geométricas ortográficas calibradas. La reconstrucción debe registrar cualquier ambigüedad de profundidad sin inventar que la referencia la resuelve.

## Estado artístico

- Definitivo como referencia: las 15 PNG anteriores y su paleta/silueta.
- Provisional: `AvatarHair.tsx`, `AnimalHat.tsx`, `MarketKit.tsx`, `CityPerimeter.tsx`, los cuatro mapas WebP y todos los GLB actuales.
- Faltante: fuentes `.blend` propias, cabezas continuas, 19 morph targets, ojos/párpados anatómicos, cabello y gorros GLB, locomoción final Blender, LOD1/LOD2, colliders/sockets por asset, animales de granja modelados y muebles GLB funcionales.
- La hoja `GORROS.png` contiene 12 especies: panda rojo, zorro, gallina, búho, elefante, rinoceronte, jirafa, panda, rana, vaca, conejo y capibara. Ratón y ajolote actuales no pertenecen a esa lámina y no forman parte del arte final.

## Clientes, navegación y cola

- `src/game/locomotion.ts` define seis recorridos deterministas sobre una línea temporal de 49 segundos.
- Los clientes no poseen lista de compra, cesta lógica, reserva de producto, máquina de estados completa, NavMesh, avoidance ni `QueueManager`.
- La cesta y bolsa son accesorios visuales. Las ventas del motor consumen el primer producto con stock; no están vinculadas al producto que un cliente tomó.
- `recast-navigation` y `@recast-navigation/three` se fijaron en 0.43.1 para su fase. Aún no están integrados.

## Mobiliario, cultivos, máquinas, puertas y luces

- `MarketKit.tsx` crea estanterías, góndolas, caja, refrigeración, horno, molino, proveedor, almacén y huerta con primitivas R3F.
- Los cultivos son representaciones fijas; no hay estados por timestamp ni inventario de parcela.
- Molino y horno no poseen inventarios de entrada/salida ni animaciones de proceso.
- La puerta cambia de color/estado con la tienda, pero no posee FSM, sensor ni collider variable.
- Las luminarias contienen `PointLight`, sin controlador horario o estado persistente.
- Caja, cinta, escáner, cajón, frigoríficos y puertas son principalmente decorativos.

## Economía, Zustand, servidor y base de datos

- `src/game/engine.ts` mantiene acciones económicas puras y dinero entero en unidades menores.
- `src/game/store.ts` conserva estado optimista, eventos contables pendientes, recuperación en `localStorage`, autosave y conflictos 409.
- El servidor autentica, valida con Zod y guarda `GameSave.state` JSONB con revisión y checksum.
- PostgreSQL contiene `User`, `Session`, `Account`, `Verification`, `PlayerProfile`, `GameSave` y `LedgerEntry`.
- Migraciones presentes: `20260826095000_initial_market` y `20260826095400_account_issuer`; no hay migraciones pendientes conocidas.
- El snapshot v2 no contiene carry inventory, estaciones, cultivos, colas de máquinas, transacciones de clientes, objetivos por nivel ni eventos idempotentes. La futura ampliación necesitará migrador probado y no puede reiniciar partidas.

## Pruebas existentes

- `engine.test.ts`: reglas económicas y migración v1→v2.
- `locomotion.test.ts`: delta, damping, rutas, continuidad y muebles.
- `world-scale.test.ts`: escala/obstáculos.
- `character-assets.test.ts`: canales articulados de los GLB heredados.
- Estado previo a esta auditoría: 4 archivos, 26 pruebas, typecheck, lint y build en verde.
- Faltan las pruebas unitarias, integración, E2E prolongado y QA 3D enumeradas en la especificación.

## Rendimiento base reproducible

Entorno medido: Chrome/ANGLE Vulkan sobre NVIDIA GeForce RTX 4080 SUPER.

- Muestra: 361 `requestAnimationFrame` durante 6 s.
- Mediana: 16,70 ms; p95: 16,70 ms; máximo: 16,80 ms, equivalente a 60 FPS sincronizados.
- Carga pública tras servidor caliente: 14–250 ms según compilación de desarrollo.
- Peso de `public`: 53 MB; modelos actuales: aproximadamente 51 MB.
- Texturas de superficie propias: 4 WebP, 225 KB totales.
- Advertencia observada: `THREE.Clock` obsoleto dentro de la dependencia; no hubo excepción WebGL.
- Draw calls, triángulos visibles y memoria GPU no estaban expuestos por la aplicación. Se añadirá un probe reproducible en modo QA antes de comparar el primer bloque; no se inventan cifras faltantes.

Evidencia base conservada en `/tmp/market-fix-qa-20260829/world-motion/report.json`.

## Dependencias

- Ya presente: `@react-three/rapier 2.2.0`, aún sin uso.
- Añadidas y fijadas: `recast-navigation 0.43.1`, `@recast-navigation/three 0.43.1`, `gltf-validator 2.0.0-dev.3.10`, `@gltf-transform/cli 4.4.2` y `playwright 1.62.1`.
- No se incorpora postprocesado sin una comparación de perfil que justifique su coste.

## Bloqueos y deuda exacta

1. Una imagen 2D no contiene profundidad exacta. Se pueden modelar siluetas frontal/lateral visibles en las láminas; los ángulos no mostrados requieren decisiones documentadas y revisión visual.
2. No existe arte 3D aprobado que pueda reutilizarse. Toda la línea de personajes debe generarse desde una fuente Blender nueva.
3. La fidelidad final no se declarará aprobada por el solo hecho de exportar GLB: exige turnarounds, morphs, clipping, validador con cero errores y revisión del usuario.
4. El juego no puede eliminar los assets en uso hasta que los reemplazos estén integrados; la eliminación y cambio de rutas ocurrirán juntos.

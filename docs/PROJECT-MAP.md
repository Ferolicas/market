# Mini Market — mapa vivo

Actualizado: 2026-09-13.

## Producto y stack

Mini Market es un simulador privado de supermercado 3D, browser-first e instalable como PWA. Usa Next.js 16.3.3, React 19, TypeScript, React Three Fiber 9, Three.js 0.185, Rapier 2, Recast 0.43, PostgreSQL 17, Prisma 7 y Better Auth.

Producción:

- dominio: `market.olcas.app`;
- proceso PM2: `market`;
- aplicación: `/var/www/market`;
- puerto interno: `4010`;
- base de datos: `market_db`;
- Caddy entrega todo el dominio mediante proxy al proceso Next.js en `127.0.0.1:4010`; no sirve el build Unity retirado;
- despliegue: push a `main`, controles de calidad y ejecución nativa con Node/PM2.

El bloque de referencia está en `deploy/Caddyfile.example`. La configuración
activa forma parte del Caddy central del VPS y debe validarse antes de recargar.

## Fronteras principales

- `src/app/page.tsx`: sesión, recuperación offline y carga diferida del cliente 3D.
- `src/components/game/GameShell.tsx`: HUD, paneles, notificaciones y enlace entre interfaz y estado.
- `src/components/game/MarketScene.tsx`: escena, cámara, física, navegación visual, estaciones y actores.
- `src/components/game/Avatar.tsx`: propietario y empleados animados.
- `src/components/game/Customer.tsx`: cliente, carro, productos y presentación de caja.
- `src/game/engine.ts`: reglas puras de economía y simulación. La escena únicamente despacha acciones.
- `src/game/store.ts`: estado React, carga, guardado y sincronización.
- `src/game/persistence/`: snapshots, recuperación local asíncrona en IndexedDB, revisión optimista y autoridad del servidor.
- `src/game/stations/`: única fuente para posiciones, huellas, imanes y sockets funcionales.
- `src/game/animation/`: locomoción, transiciones, contactos, carro y presentación del rig.
- `src/game/render/`: calidad adaptativa y agrupación de mallas estáticas.
- `src/components/game/MarketText.tsx`: fuente local común para texto 3D; no depende de CDN bajo la CSP de producción.
- `src/game/ai/`: comportamiento y colas de clientes.
- `public/models/market/`: GLB servidos por la PWA.

## Rutas

- `/`: autenticación y juego.
- `/reset-password`: restablecimiento de contraseña.
- `/api/health`: pública, salud del servicio.
- `/api/auth/[...all]`: Better Auth.
- `/api/game/config`: configuración pública no sensible.
- `/api/game/save`: autenticada, partida autoritativa con revisión y checksum.
- `/api/game/ledger`: autenticada, libro contable idempotente.

## Persistencia y economía

- El servidor es autoritativo para cuentas, revisiones de guardado y libro contable.
- La PWA conserva una copia local de recuperación y puede abrirla sin conexión.
- Las escrituras usan concurrencia optimista; un conflicto nunca destruye la copia local.
- Todo importe se almacena como entero en unidades menores y aplica `countryMoneyScale` a precios base.
- Los ticks agrupan el snapshot local más reciente y lo persisten con IndexedDB durante tiempo ocioso, sin serializar la partida completa en el hilo de render. `GameRuntime` sincroniza el servidor cada 30 segundos durante tiempo ocioso y fuerza persistencia/sincronización al ocultar o cerrar la pestaña; la simulación periódica se pausa en segundo plano.

## Escena y gameplay

- El vendedor se mueve con teclado, mando o arrastre táctil y usa una cámara ortográfica isométrica. El encuadre general conserva orientación y ángulo, con un `zoom` 1,3× más próximo; en una cámara ortográfica moverla sobre su eje no cambia el tamaño aparente.
- `BusinessDay.ts` define la jornada autoritativa 07:30–21:00: 810 minutos de juego equivalen exactamente a 3 horas reales con la tienda abierta. El tick visible avanza el reloj solo mientras la tienda está abierta; al ocultar/cerrar la aplicación los timers se detienen y no existe avance offline. Desde las 18:00 `daylightPresentation` interpola día, atardecer y noche. A las 21:00 (o al cerrar manualmente) se bloquean nuevos clientes, se cobra automáticamente a quienes ya estaban dentro, se mantienen encendidas las luces interiores y, cuando salen, se ejecuta una sola vez el cierre contable y se prepara el día siguiente a las 07:30.
- Cultivos, máquinas, estantes, almacén y cajas se activan por proximidad mediante imanes; la transferencia visible no bloquea al actor.
- Capacidad de estantes = huecos físicos. `RETAIL_SHELF_GRIDS` y `PRODUCE_LAYERS` (`retail-layout.ts`) describen la cuadrícula real de cada mueble; `retailShelfCapacityForTier` es la única regla de capacidad (motor, planificación de cesta, objetivos y presentación): en nivel de expositor 1 la capacidad de cada producto es exactamente la fila delantera de todos sus muebles (pan 24, harina/trigo 12, café 120 en tres góndolas, huevos 24, leche/queso 25, zumo 45, frutas y verduras 30 = 15 por mesa) y las mejoras de `shelves-1` abren filas hacia el fondo o capas apiladas, siempre con hueco visible. Las unidades se reparten por todos los niveles antes de usar la siguiente fila de fondo. Las máquinas conservan su búfer propio (`outputCapacity` en `products.ts`).
- Todo estante lleva su letrero: la mesa de frutas y verduras tiene cuatro cubetas inclinadas hacia la cámara, una por producto (`PRODUCE_BIN_COLUMNS`), con un cartel por cubeta (`retail-slot-sign:*`); panadería, despensa, huevos, lácteos y bebidas llevan una etiqueta compacta por producto (`retail-shelf-tag:*`, `ShelfTag`) girada hacia la cámara fija (`CAMERA_AZIMUTH`) en la esquina o la barra superior del mueble. Cada cartel muestra réplica del producto, nombre, `unidades/capacidad` de ese mueble y `faltan n` o `LLENO`. La cantidad dibujada es la autoritativa: unidades y capacidad se reparten entre los muebles de un departamento por turnos (`distributedFixtureQuantity`), un hueco sin stock se ve vacío y no existe decoración fija; los vuelos de reposición aterrizan en el mueble y hueco donde aparecerá la unidad (`retailStockFixtureSlot`).
- Orientación: la cámara mira desde +x/+z, así que lácteos y bebidas giran a `yaw: 90` (frente hacia el interior y la cámara; el punto de servicio de bebidas pasa a `[5.45, -0.9]`) y la fila delantera de cada balda va junto al borde para que la balda superior no la tape.
- Cultivos: el manzano (`crop-apple-1`, `FARM_PLOTS`, junto al espantapájaros) se abre en el nivel 2, el mismo que trae la demanda de manzanas; partidas anteriores lo reciben ya creciendo si están en nivel ≥ 2. Maíz y naranja siguen ligados a los niveles 11 y 20, que son los mismos en que los clientes empiezan a pedirlos (`CUSTOMER_PRODUCT_UNLOCKS`).
- Junto al poste izquierdo de la puerta de la granja hay una caja de devolución para todos los trabajadores y nunca para clientes (`WAREHOUSE_RETURN_STATION`, `fixture:warehouse-return`, x = 4,75 · z = −7,72 en unidades de diseño). Al pasar cerca, el jugador/propietario devuelve de una vez toda su cesta mediante un imán sin bloquearse. Si otro actor llena el estante mientras un reponedor lleva mercancía, el empleado entra en `NAVIGATE_RETURN`, camina al punto accesible delante de la caja y devuelve junta toda la carga restante antes de aceptar otra tarea. La caja es obstáculo de NavMesh y de física. Con QA privada, `__MARKET_QA__.warehouseReturnTarget` publica su centro y punto de trabajo.
- El personalizador de avatar (`AvatarCustomizer.tsx`) ilumina la vista previa con `Lightformer`s locales: el antiguo `Environment preset="studio"` descargaba un HDR de un CDN que la CSP de producción bloquea, y el fallo dentro de `Suspense` desmontaba el juego entero al abrir el panel. Un `PreviewErrorBoundary` limita cualquier fallo futuro de la vista previa a un aviso.
- Zancada y clips: `CLIP_NATURAL_SPEED` (`LocomotionController.ts`) guarda la velocidad de avance de cada clip en el sitio a escala 1 (Walk 0,35 u/s, Run 1,07, CarryWalk 0,24, CarryRun 0,46, BasketWalk 0,52), medida sobre el pie apoyado de los GLB entregados con `scripts/measure-character-rig.mjs` (sin Blender). `gaitTimeScale` = velocidad del cuerpo / (zancada × escala del actor) y `RUN_GAIT_RATIO` decide correr cuando la marcha tendría que ir a más de 2,4×. El clip `CarryBasket` de los clientes es una pose casi estática (0,004 u/s): los estados de desplazamiento usan `BasketWalk`, la entrada y la salida sin carro usan `Run`, y la velocidad autoritativa del cliente (`1.2 + identidad × 0.045`) queda dentro de lo que ese clip cubre sin patinar.
- Cesta de cosecha (jugador y empleados): los brazos congelados al cargar incluyen las clavículas y se muestrean de `CheckoutBag` a 13,8 s (`CARRY_POSE_SOURCES`), una sujeción simétrica a dos manos; `CarryBox` queda como reserva. `CHARACTER_PALM_OFFSETS` apunta al centro de la palma real (+Y del hueso de la mano, 0,04–0,06). `placeCarrySocket` deja la cesta nivelada, mirando al +Z del rig y centrada en el eje del cuerpo, con la barra a la altura y alcance de las palmas; el balanceo lateral de las manos solo las desliza por la barra (`HARVEST_BASKET_BAR_MIN_HALF_LENGTH`).
- Gorros: los GLB de capucha están autorizados alrededor de una cabeza 2–2,8× mayor que la de los rigs entregados (forro de 0,46–0,52 u frente a cráneos de 0,165–0,25 u). `HAT_FIT_SCALE` (`Avatar.tsx`) los escala sobre el hueso `Head` (adultos 0,49; niño 0,64; niña 0,68).
- `CharacterScale.ts` unifica la escala visible del reparto: el tamaño aprobado del niño (`1,65`) es el mínimo, todos los adultos (propietario, empleados y clientes) comparten una altura objetivo un 10 % mayor, y las calibraciones particulares de los GLB de clientes se conservan.
- Clientes: entrada, carro, selección de productos, fila, descarga, pago, bolsa, devolución del carro y salida.
- Empleados: granja, producción, reposición y caja según demanda y rol. El granjero puntúa todos los cultivos habilitados por escasez directa y por demanda de recetas (trigo/harina/pan, naranja/zumo, además de tomate y maíz), evita reservar el mismo bancal que otro granjero y lleva siempre la materia prima más necesaria; el operario conserva la carga y descarga de máquinas.
- Rapier resuelve al jugador y colliders; Recast calcula caminos de clientes y empleados.
- Las posiciones físicas y visuales comparten los módulos de `src/game/stations/` y `src/game/world-scale.ts`.

## Reparto aprobado

Los cuerpos proceden exclusivamente de:

`/home/ferney_oliveros/Descargas/KIT MARKET/PERSONAJES/NUEVOSPERSONAJES/PERSONAJES/`

Asignación:

- propietario: `HOMBRE.fbx`, `MUJER.fbx`, `NIÑO.fbx`, `NIÑA.fbx`;
- clientes: `CLIENTEHOMBRE1.fbx` y `CLIENTEMUJER1.fbx`–`CLIENTEMUJER4.fbx`;
- la sexta identidad de cliente reutiliza `CLIENTEHOMBRE1.fbx`, porque la entrega contiene cinco clientes distintos.

`tools/blender/build_mixamo_cast.py` copia el skin original y monta las acciones entregadas en `NUEVOSPERSONAJES/` y `GRANJA.zip`. Normaliza nombres de huesos, elimina desplazamiento horizontal de raíz y exporta acciones con los nombres consumidos por el runtime. `scripts/build-market-lods.mjs` genera dos niveles reducidos que conservan el rig y las animaciones.

La PWA cambia de cuerpo completo según capacidad del dispositivo:

- escritorio potente: modelo completo;
- móvil/tablet o equipo limitado: LOD1/LOD2;
- nunca carga a la vez las tres variantes de un mismo actor.

El service worker usa `mini-market-v9`; el cambio de versión invalida los antiguos GLB cacheados bajo la misma URL.

El suelo se monta fuera de los límites `Suspense` de edificio, mobiliario y granja. Cada bloque pesado tiene su propio límite, de modo que una fuente o GLB pendiente no puede dejar toda la escena mostrando únicamente el color de fondo. Los textos Troika usan `/fonts/OpenSans-SemiBold.ttf`, servido desde el mismo origen. La CSP pública permite `blob:` en `script-src`, `connect-src`, `worker-src` e `img-src`: Troika crea workers desde blobs y GLTFLoader convierte texturas GLB embebidas en URLs blob; bloquearlas deja los límites Suspense pendientes y oculta el mundo.

## Perfil de batería móvil

`src/game/render/AdaptiveQuality.ts` decide el perfil antes de crear el renderer:

- 30 FPS de presentación en móvil cuando el jugador está quieto y 60 FPS durante locomoción; escritorio permanece a 60 FPS;
- la presentación móvil se decide contando ticks de `requestAnimationFrame` contra el refresco medido del panel (`DisplayCadenceEstimator`, `presentationDivisor`): 60 Hz presenta cada tick en movimiento, 120 Hz cada dos, 90 Hz cada dos (45 FPS regulares en lugar de 60 con cadencia 22/11 ms);
- DPR máximo 2 en móvil y 2 en escritorio (dos píxeles físicos por píxel CSS; dibujar menos píxeles que la pantalla y estirarlos es lo que se veía como personaje pixelado);
- MSAA activo para recuperar bordes nítidos, preferencia de GPU de bajo consumo y atlas de sombra 512 en móvil;
- en móvil el cristal físico conserva tinte, opacidad, clearcoat y reflejo de entorno, pero `glassTransmission` es `false`: el pase de transmisión de Three redibuja todos los objetos opacos y re-resuelve el programa de cada material dos veces por frame (`getParameters` + `getProgramCacheKey` eran el 19 % de la CPU); en escritorio se mantiene a resolución completa. `useGlassTransmission` en `MarketRenderProfile.tsx` aplica la política en cada cristal;
- luminarias emisivas sin cuatro PointLights redundantes en móvil;
- sombra principal estática después del calentamiento;
- render bajo demanda: no hay frames 3D cuando la pestaña está oculta;
- timers de mundo, simulación y autosave periódico detenidos en segundo plano;
- la calidad adaptativa sólo mide juego real: empieza cuando `SceneReadinessProbe` declara la escena lista más 2,5 s de gracia (antes, la carga de GLB y la compilación de shaders contaban como presión sostenida y bajaban el DPR de forma permanente en todos los dispositivos). Cada paso baja ×0,86 hasta `minDpr` (1,5 móvil, 0,85 escritorio) tras presión sostenida (40 ms en reposo o 24 ms en locomoción) y se devuelve tras 8 s de frames dentro de presupuesto;
- el paso de locomoción del jugador corre dentro del paso fijo de Rapier (`useBeforePhysicsStep`, 1/60): un único acumulador para objetivo cinemático y física, de modo que la interpolación de Rapier presenta al jugador de forma regular a cualquier refresco; el giro del cuerpo se suaviza por frame y la cámara sigue la cápsula interpolada;
- tick autoritativo de IA/economía a 5 Hz con `deltaTime`, desacoplado de la física y presentación del jugador a 60 Hz, para evitar clonar/reconciliar todo el mundo 10 veces por segundo;
- suelo, perímetro urbano, edificio, mobiliario y granja estáticos fusionados por `StaticMeshBatch`: el color del material se hornea por vértice (`diffuse × vertexColor` es exactamente lo que ya calcula `material.color`), de modo que piezas que sólo difieren en color comparten un draw, y las `InstancedMesh` estáticas ya colocadas (montantes, baldas, tubos de carro, decoración) se expanden dentro del mismo lote. Todo lo que cambia en ejecución debe colgar de un nombre `dynamic:*`, `retail-stock:*`, `retail-cold-door:*`, `fixture:returns`, `fixture:cart-bay` o `fixture:promotional-endcap` (o marcar `userData.disableStaticBatch`); los optimizadores de lote son el último hijo de cada raíz para que las instancias ya tengan sus matrices. Las mallas fuente ocultas dejan de recomponer su matriz cada frame. Con `?perf`, `window.__MARKET_PERF_DRAWS__()` devuelve los draws del último frame por grupo, tipo y prefijo de nombre, con su tiempo de envío.

Estas medidas no cambian reglas, dinero, inventario, IA ni tiempos autoritativos; reducen píxeles, pases GPU y trabajo de presentación.

## Fluidez: qué no puede pasar por React a 5 Hz

El tick autoritativo clona el mundo con `structuredClone`, así que cada 200 ms cambia la identidad de todos los objetos. La escena está organizada para que ese tick no reconcilie árboles grandes ni relance trabajos de GPU:

- `src/game/render/LiveActors.ts` publica en cada render de `MarketScene` los snapshots de clientes, transacciones y empleados en mapas por id. `Customer` y `Npc` son `memo` por una clave de presentación (estado, carro, cesta, transacción, rol) y leen la posición y la ruta más recientes dentro de `useFrame`; el snapshot de movimiento se refresca sólo cuando cambia el reloj de simulación o el estado, nunca por identidad del objeto.
- La puerta del escaparate es estado autoritativo que avanza por tick; `StorefrontDoorMotion` desliza una copia de presentación a la velocidad del motor (450 ms) cada frame y `MarketBuilding` y `StoreColliders` mueven hojas y colisionadores por referencia, sin re-render. La puerta trasera de la granja hace lo mismo con refs en vez de estado por frame.
- `StoreColliders`, `InteractionSensors`, `RearDoorAssembly` y las piezas de `KitFurniture` son `memo`; los sensores y el jugador reciben firmas de texto (`unlockedSignature`, `cropSignature`) en lugar de arrays. Los componentes de departamento y máquina usan `sameFixtureProps` (igualdad estructural), de modo que un cambio de stock o un escaneo en caja sólo re-renderiza su departamento.
- `MarketText` es `memo` con comparación por valor: `Text` de drei relanza `troikaMesh.sync()` (worker + subida de geometría) en cada render, aunque el texto no cambie.
- Los vuelos de producto reportan cada aterrizaje desde el bucle de frames; `GameShell` los agrupa en una única actualización por `requestAnimationFrame`.
- `CustomerWarmup` monta los tres primeros cuerpos de cliente, minúsculos y dentro del encuadre, mientras la pantalla de carga cubre el lienzo: el GLB se decodifica, el atlas sube a la GPU y el programa físico con skinning se compila antes de `sceneReady`. Los clips compuestos (`composeCarryAnimations`, alias de runtime) se cachean por GLB.
- Nada que se monte en mitad del juego usa `RoundedBox` de drei: ese componente extruye una forma nueva y recalcula normales suavizadas en un `useLayoutEffect` en cada montaje. La cesta (`HarvestBasket`) y los productos de cesta, vuelo y carro (`BasketProduct`) comparten geometrías y materiales de módulo. `useCharacterModelTier` cachea su snapshot hasta un cambio real de viewport o de puntero.
- El propietario se presenta a escala 1,65 (×1,5 respecto a 1,1); la cápsula de colisión conserva su huella para no bloquear pasillos.

## QA y publicación

Control obligatorio antes de publicar:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Pruebas de navegador relevantes:

- `pnpm qa:mobile-render`;
- `pnpm qa:character-performance`;
- `pnpm qa:avatar-panel`;
- `pnpm qa:customers`;
- `pnpm qa:workers`;
- `pnpm qa:production-surface`.

`scripts/measure-character-rig.mjs` mide un GLB de personaje sin Blender: límites de cabeza y palmas en la pose de reposo, geometría de las manos en cualquier clip/tiempo y velocidad natural de cada ciclo de marcha (`node scripts/measure-character-rig.mjs public/models/market/characters/owner_man.glb`).

`scripts/qa-mobile-render-budget.mjs` valida el perfil móvil de 30 FPS en reposo/60 FPS en movimiento, DPR, MSAA, draw calls, triángulos, texturas, input táctil y errores de consola/red. Una prueba física prolongada en el teléfono sigue siendo la autoridad final para batería y temperatura.

La auditoría, baseline A/B, inventario de escena, riesgos pendientes y protocolo Android están en `docs/audits/MOBILE-PERFORMANCE-AUDIT-2026-09-12.md`.

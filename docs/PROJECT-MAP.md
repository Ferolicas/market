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
- Cultivos, máquinas, estantes, almacén y cajas se activan por proximidad mediante imanes; la transferencia visible no bloquea al actor.
- Clientes: entrada, carro, selección de productos, fila, descarga, pago, bolsa, devolución del carro y salida.
- Empleados: granja, producción, reposición y caja según demanda y rol.
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
- `pnpm qa:customers`;
- `pnpm qa:workers`;
- `pnpm qa:production-surface`.

`scripts/qa-mobile-render-budget.mjs` valida el perfil móvil de 30 FPS en reposo/60 FPS en movimiento, DPR, MSAA, draw calls, triángulos, texturas, input táctil y errores de consola/red. Una prueba física prolongada en el teléfono sigue siendo la autoridad final para batería y temperatura.

La auditoría, baseline A/B, inventario de escena, riesgos pendientes y protocolo Android están en `docs/audits/MOBILE-PERFORMANCE-AUDIT-2026-09-12.md`.

# Mini Market — mapa vivo

Actualizado: 2026-09-12.

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

- El vendedor se mueve con teclado, mando o arrastre táctil y usa una cámara ortográfica isométrica.
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

- 30 FPS de presentación en móvil y 60 FPS en escritorio;
- DPR máximo 0,9 en móvil y 1,4 en escritorio;
- sin MSAA, preferencia de GPU de bajo consumo y atlas de sombra 512 en móvil;
- transmisión de cristales a media resolución y luminarias emisivas sin cuatro PointLights redundantes en móvil;
- sombra principal estática después del calentamiento;
- render bajo demanda: no hay frames 3D cuando la pestaña está oculta;
- timers de mundo, simulación y autosave periódico detenidos en segundo plano;
- nueva reducción de DPR sólo si los frames de 30 FPS exceden 40 ms de forma sostenida.

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

`scripts/qa-mobile-render-budget.mjs` valida el perfil de 30 FPS, DPR, MSAA, draw calls, triángulos, texturas, input táctil y errores de consola/red. Una prueba física prolongada en el teléfono sigue siendo la autoridad final para batería y temperatura.

La auditoría, baseline A/B, inventario de escena, riesgos pendientes y protocolo Android están en `docs/audits/MOBILE-PERFORMANCE-AUDIT-2026-09-12.md`.

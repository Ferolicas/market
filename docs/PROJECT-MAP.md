# Mini Market — mapa vivo

Actualizado: 2026-09-01 · Base: supermercado 3D premium, huerta magnética con rebrote, arte propio, simulación por estaciones y QA integral

## Identidad y stack

Simulador empresarial 3D individual y privado para la familia, jugable en navegador e instalable como PWA. Combina trabajo manual por proximidad, automatización mediante empleados, proveedores, contabilidad educativa por país y expansión con caja global. Producción: `market.olcas.app`, PM2 `market`, puerto `4010`, PostgreSQL `market_db`.

- Next.js 16.3.3, React 19.2.8 y TypeScript 5.
- React Three Fiber 9, Drei 10 y Three.js 0.185 para la escena low-poly y los personajes GLB animados; Rapier 2 para control/colliders y Recast 0.43 para navegación.
- Zustand 5 para estado y recuperación local; Vitest 4 para el motor económico puro.
- Prisma 7 con adaptador `pg` y PostgreSQL 17.
- Better Auth 1.7 con correo, contraseña y username; Resend para magic links.
- Sin pagos, analítica, CRM ni multijugador en esta versión.

## Mapa de rutas

| Ruta | Archivo | Qué muestra | Auth | Datos |
|---|---|---|---|---|
| `/` | `src/app/page.tsx` | Login/registro o juego 3D | Sesión opcional | Sesión Better Auth; partida al entrar |
| `/reset-password` | `src/app/reset-password/page.tsx` | Cambio de contraseña mediante token | Token temporal | Better Auth |
| `/manifest.webmanifest` | `src/app/manifest.ts` | Metadatos instalables PWA | No | Estático |
| `/sw.js` | `public/sw.js` | Caché `mini-market-v7` del shell y assets 3D en producción; cache-first para modelos/texturas e invalidación de GLB anteriores | No | Caché del navegador |

`src/app/layout.tsx` aporta metadatos, viewport y tipografías. `GameRuntime` registra el service worker únicamente en producción y elimina registros/cachés PWA en desarrollo para que nunca controlen los chunks de `next dev`. `src/app/globals.css` contiene todo el sistema visual responsive.

## Endpoints API

| Método y ruta | Archivo | Responsabilidad | Consumidor | Tablas |
|---|---|---|---|---|
| `GET/POST /api/auth/[...all]` | `src/app/api/auth/[...all]/route.ts` | Registro, login, sesión, logout y reset | Componentes de auth | `user`, `session`, `account`, `verification` |
| `GET /api/game/save` | `src/app/api/game/save/route.ts` | Recupera o crea la ranura 1 | `src/game/store.ts` | `GameSave`, `PlayerProfile` |
| `PUT /api/game/save` | `src/app/api/game/save/route.ts` | Valida y guarda con revisión optimista | `src/game/store.ts` | `GameSave`, `PlayerProfile`, `LedgerEntry` |
| `GET /api/game/ledger` | `src/app/api/game/ledger/route.ts` | Últimos 100 movimientos del jugador | Panel financiero | `LedgerEntry` |
| `GET /api/health` | `src/app/api/health/route.ts` | Salud de app y PostgreSQL | Caddy, CI y operación | Consulta `SELECT 1` |

Todas las rutas de juego exigen sesión Better Auth. Salud es la única API pública ajena a auth.

## Modelo de datos

El esquema vive en `prisma/schema.prisma`; las migraciones están en `prisma/migrations/`.

- `User`: identidad, correo y username únicos; dueño de sesiones, perfil, partidas y movimientos.
- `Session`: cookie/sesión revocable con caducidad, IP y agente.
- `Account`: credencial del proveedor; password cifrado por Better Auth y unicidad `issuer + accountId`.
- `Verification`: tokens temporales de recuperación.
- `PlayerProfile`: país, moneda y copia rápida de piel, camisa y sombrero seleccionados.
- `GameSave`: estado JSONB, ranura única por usuario, revisión y checksum SHA-256. El snapshot v4 incluye economía, mundo, clientes, carros, cola y fases unitarias de caja, cubículo de devoluciones, estaciones, timers, empleados, progresión, avatar, cesta mult producto y eventos procesados; partidas anteriores —incluida la antigua carga `carry.item`— se normalizan al cargar. La migración retira el antiguo gorro panda rojo únicamente cuando el avatar heredado coincide completo con el preset por defecto v1–v3; una personalización o una elección v4 se conserva.
- `LedgerEntry`: movimiento en unidades monetarias menores, día, franquicia, categoría y revisión. La migración `20260829181000_event_idempotency` define `eventId`, `sessionId`, secuencia, tipo, payload e idempotency key para que un reintento no duplique un asiento.

Las relaciones dependientes usan borrado en cascada. El dinero nunca usa decimales flotantes persistidos.

## Flujos clave

### Acceso y recuperación

1. `AuthScreen` llama a `src/lib/auth-client.ts` para registro o login por email/username.
2. `src/lib/auth.ts` valida con Better Auth, limita solicitudes y persiste mediante Prisma.
3. En recuperación, Better Auth genera el enlace y Resend lo envía desde `no-reply@olcas.app`.
4. `ResetPasswordForm` consume el token; al cambiar la clave se revocan las sesiones anteriores.

### Carga y guardado

1. `GameShell` monta `src/game/store.ts` y solicita `GET /api/game/save`.
2. Si no existe partida, el servidor crea estado inicial y perfil en transacción.
3. Acciones de UI/3D se delegan a `src/game/engine.ts`; este devuelve estado y eventos contables.
4. Zustand guarda inmediatamente acciones discretas. La distancia recorrida y las actividades automáticas de proximidad se acumulan fuera de React y se incorporan juntas al siguiente tick mundial de 10 Hz: una sola clonación, normalización y revisión autoritativa, aunque una zona emita varias veces. La recuperación del tick se serializa como máximo una vez por segundo; el store reconcilia una recuperación local más nueva cuando parte de la misma revisión del servidor y sincroniza cada 15 segundos, al ocultar la pestaña, al reconectar y al desmontar. La creación inicial de empresa fuerza además un guardado inmediato.
5. `PUT /api/game/save` valida con Zod, compara revisión, valida la transición contra la autoridad del servidor —incluida la capacidad e inventario de las cestas del jugador y de cada empleado activo—, rechaza replays de eventos, actualiza estado/perfil y añade libro contable en una transacción.
6. Un conflicto 409 conserva una copia local y carga la versión más reciente del servidor.

### Simulación y expansión

1. `GameInputSurface`, `InputManager`, `PlayerController` y `MarketScene.tsx` traducen Pointer Events desde cualquier área libre, teclado, táctil y mando a un control cinemático Rapier. Los ejes usan la orientación fija de la cámara ortográfica y su perpendicular derecha (`-forward.z, forward.x`), no la dirección instantánea de la cámara amortiguada, para que las cuatro flechas permanezcan rectas y coincidan con la pantalla durante el seguimiento. El jugador usa paso fijo de 60 Hz, aceleración/frenado cortos y giros por el arco mínimo. `WorkstationController` separa manipulación estacionaria y locomoción: máquinas, animales y caja detienen y orientan el cuerpo; huerta y surtido usan sensores continuos que transfieren producto sin cortar el paso. La distancia recorrida se acumula fuera de React y se integra en el siguiente tick mundial de 10 Hz, sin clonar ni guardar la partida desde el frame de movimiento. Se renderiza a `1.1×`; `world-scale.ts` separa la escala visual base `3×`, la planta `2×` y los elementos `1.6×`, y exporta los volúmenes compartidos. La cámara ortográfica conserva ángulo y distancia ampliada `15%` y mantiene al vendedor exactamente centrado.
2. `Avatar.tsx` clona uno de los cuatro GLB reconstruidos desde `PERSONAJES.png` y `VENDEDOR HOMBRE.png` de `public/models/market/characters/`. Los cuerpos finales contienen rig humano, 39 clips y 16 morph targets faciales. `CharacterPresentation.ts` aplica materiales cartoon suaves, doble cara fuera de overlays faciales y suelas cerradas alineadas al suelo; `LocomotionController` conserva la fase del paso durante los blends y amortigua la velocidad. `CharacterAccessories.tsx` monta sobre el `Head` animado una variante ajustada específicamente a hombre, mujer, niño o niña de cada uno de los 16 cabellos y 12 gorros. Seleccionar un gorro sustituye todo el cabello, no lo superpone.
3. `CustomerBrain`, `QueueManager` y `Customer.tsx` gobiernan las seis identidades exactas de `cliente1.png`–`cliente6.png` con FSM persistente: spawn, puerta, toma de carro, lista real, reserva/socket de producto, espera de stock, fila de dos carriles, descarga unitaria, espera de cajero, escaneo, embolsado, pago idempotente, recogida de bolsa, devolución del carro, salida y despawn. La espera máxima de caja es de cinco minutos reales de simulación; al vencer, el cliente adopta expresión de enfado, cancela la transacción y deja todo en el inventario de devoluciones antes de retornar el carro. Si se agotó su paciencia de producto sin recoger ninguna unidad, no entra en la fila ni reproduce `CheckoutItem`: devuelve directamente el carro sin crear una transacción o simular un pago. Al entrar o salir, el motor lo retiene en su lado de la fachada hasta que `doorState=OPEN` y `doorProgress=1`. Recast calcula rutas sobre la geometría transitable y el mundo publica posiciones a 10 Hz; `CustomerVisualMotion` proyecta sobre toda la polilínea restante. `CustomerCartMotion` ancla el manillar a ambas manos, calcula giro de ruedas/casters y mueve cada unidad estante → mano → cesta; mercancía y bolsa permanecen visibles en el carro hasta su transferencia real. Cada instancia conserva esqueleto, morphs, materiales y vectores temporales propios.
4. `MarketKit.tsx` carga y compone mobiliario premium: caja a escala humana con cinta, rodillos, escáner iluminado, monitor, datáfono y bolsa; cubículo de devoluciones y bahía de carros; refrigeración, góndolas con divisores, barandillas y precios; horno, molino, proveedores y almacén con mercancía visible. Los seis departamentos conservan rótulo/color propios y unidades 3D reconocibles —tomates, manzanas, maíz, huevos, leche, queso, zumo, pan, harina, trigo y café— cuyo inventario coincide con `shelves`. La huerta usa cuatro bancales abiertos de `farm-layout.ts`, cultivos densos por etapa y utilería integrada, sin portón, carteles, porcentajes ni pads. La fachada combina cerámica cálida, zócalo, paneles y vidrio lateral con puerta corredera automática. Los modelos estáticos no se suscriben al frame loop; solo los elementos realmente animados montan un conductor.
5. `AvatarCustomizer.tsx` permite cambiar en cualquier momento cuerpo, 16 peinados, color de pelo, piel, camisa y 12 gorros animales opcionales; la vista previa es 3D y gira 360°.
6. `engine.ts` procesa cultivos, animales, maquinaria, stock, checkout, empleados físicos, pedidos, tiempo, cierre diario, 30 niveles, tiers y expansiones. El nivel 1 comienza con tomates creciendo automáticamente y una guía plegada: cosechar, surtir, abrir, recibir y cobrar. Cada parcela aplica `GROWING → READY → GROWING`; una pasada consume unidades maduras hasta la capacidad mixta de la cesta y el último fruto inicia el rebrote. Tier y nivel aceleran el crecimiento, y el tier también escala el rendimiento. La demanda de clientes usa desbloqueos explícitos: las manzanas entran desde nivel 2 con Ruta Fresca y el café desde nivel 9 con Origen Andes. Obras, contratación y mejoras se financian directamente desde el panel, no desde pads; sus cotizaciones y eventos usan nombres humanos de estaciones, nunca IDs internos. La proximidad física abre las hojas de la puerta, pero nunca abre comercialmente la tienda. Un cajero contratado navega primero a `CASHIER_WORK_POINTS` y solo escanea en `OPERATE_CHECKOUT`; el jugador cobra únicamente mientras permanece en su puesto. La compra conserva fases visibles de descarga, escaneo, embolsado, pago y entrega. La escena solo despacha acciones y no duplica economía.
7. `catalog.ts` es la fuente única de países, escalas monetarias, productos, proveedores, roles, sombreros y seis franquicias.
8. Cambiar de franquicia modifica la ubicación activa, no la caja global ni los recursos compartidos.

## Dependencias compartidas

- `src/game/types.ts`: contrato común de partida, acciones y eventos; cambiarlo afecta motor, UI, validación y persistencia.
- `src/game/catalog.ts`: balances y contenido; los importes base pasan siempre por `countryMoneyScale`.
- `src/game/engine.ts`: autoridad única de reglas económicas; debe permanecer puro y cubierto por Vitest.
- `src/game/store.ts`: sincronización cliente-servidor, snapshot v4, colas privadas de telemetría/interacción, recuperación local, autosave, offline, eventos pendientes y conflictos.
- `src/lib/game-validation.ts`: frontera de confianza para partidas recibidas por API.
- `src/components/game/GameShell.tsx`: orquesta HUD, paneles, escena y ciclo de autosave.
- `src/components/game/MarketScene.tsx`: render, cámara centrada, control Rapier, sensores y dispatch 3D; no duplica lógica económica.
- `src/components/game/CityPerimeter.tsx`: manzana low-poly alrededor de la tienda. Agrupa los bloques repetidos en una única geometría instanciada para añadir ciudad sin multiplicar llamadas de dibujo.
- `src/game/core/GameLoop.ts`: acumulador de paso fijo a 60 Hz independiente de la frecuencia de render.
- `src/game/input/`, `src/game/player/` y `src/game/interaction/`: input universal, movimiento cinemático, carry y actividades automáticas por proximidad.
- `src/game/navigation/NavMeshService.ts`, `src/game/ai/CustomerBrain.ts` y `QueueManager.ts`: NavMesh Recast único para runtime/debug, FSM, reservas, rutas y filas.
- `src/game/stations/StationSystem.ts` y `src/game/progression/levels.ts`: timers/estados de cultivos y máquinas, balance, objetivos, desbloqueos y niveles 1–30.
- `src/game/stations/checkout-layout.ts`: geometría compartida de ambas cajas, puestos, frentes de cliente, bolsas, dirección de fila y cámara; motor, escena, mobiliario, colliders y debug consumen esta única orientación.
- `src/game/stations/retail-layout.ts`: mapa único de los seis departamentos; motor, arte, interacción y navegación consumen sus productos, colores, expositores y puntos de servicio.
- `src/game/stations/workstation-layout.ts`: fuente única de los puestos manuales físicos; gerencia y mejoras ya no montan pads. `src/game/stations/farm-layout.ts` define cada bancal y su sensor independiente. `WorkstationController.ts` garantiza exclusión mutua entre gesto estacionario y locomoción sin intervenir en la cosecha magnética.
- `src/game/persistence/Snapshot.ts` y `SaveAuthority.ts`: migración/selección de recuperación y validación autoritativa de transiciones/eventos.
- `src/game/animation/`: mezcla de locomoción, contacto de pies, presentación/materiales cerrados, rostro, cinemática del carro y proyección visual continua de clientes y trabajadores.
- `src/game/feedback/`: bus de señales y audio Web Audio; el cooldown se separa por tipo, fuente y actor para que jugador y NPC no se silencien mutuamente.
- `src/game/debug/PerformanceMonitor.ts`: FPS, p95, draw calls, triángulos, texturas y programas; el overlay añade NavMesh, colliders, sensores, rutas, sockets y filas. Solo con `?debug=1`, el jugador expone al QA un buscador de ruta y una entrada analógica determinista conectados al mismo NavMesh/InputManager del runtime; las pruebas separadas siguen validando eventos reales de ratón, teclado y touch.
- `src/game/locomotion.ts`: delta seguro, amortiguación y giro angular; cubierto por Vitest y contrastado con `world-scale.ts`.
- `src/components/game/GameShell.tsx`: HUD/paneles y pulso de caja por proximidad real del trabajador, sin bloqueo modal ni tecla de acción.
- `src/components/game/Avatar.tsx`: rig visual compartido por jugador y empleados. Reproduce los clips incluidos en cada GLB, conduce parpadeo/expresiones con morph targets, une apariencia a `Head` y coloca `HarvestBasket` entre ambas manos con contenido mixto real.
- `src/components/game/CharacterAccessories.tsx`: carga diferida, clonación y color de los 16 peinados y 12 gorros GLB.
- `public/models/market/characters/` y `public/models/market/customers/`: diez cuerpos finales más veinte LOD; cada archivo conserva las animaciones, los 16 morph targets faciales y los huesos requeridos.
- `public/models/market/hair/` y `public/models/market/hats/`: 64 cabellos y 48 gorros finales. Son las 16 y 12 identidades visuales del kit ajustadas de manera independiente a los cuatro tipos de cabeza.
- `public/models/market/environment/`: 61 GLB propios de edificio, mobiliario, equipo, cultivos, animales y outputs.
- `tools/character_pipeline/`: prepara las vistas de referencia del kit y reconstruye la geometría 3D base sin reutilizar GLB antiguos.
- `tools/blender/assemble_trellis_character.py`: ensambla el cuerpo reconstruido, rig, pesos, 39 clips, rostro expresivo y limpieza de uniones de la reconstrucción. `fit_hair_to_character.py` y `fit_hat_to_character.py` hornean cada accesorio para cada cabeza.
- `scripts/build-market-lods.mjs`: produce los LOD y la entrega Meshopt/WebP utilizada por el navegador.
- `tools/blender/build_market_environment.py`: fuente reproducible de los 61 activos de tienda y huerta.
- `tools/blender/check_foot_contact.py`: mide la distancia real de ambas suelas al suelo sobre los GLB exportados.
- `scripts/validate-market-assets.mjs`: ejecuta `gltf-validator` sobre los 203 GLB actuales y comprueba huesos, clips y los 16 morph targets que consume el runtime.
- `scripts/qa-checkout-targeted.mjs`: prueba dirigida de caja; congela una escena visual reproducible, valida el encuadre cercano, confirma que sin trabajador no cambian escaneo ni saldo, entra de forma continua en el sensor físico, espera pago único y comprueba bolsa, puerta y devolución del carro. El resto de scripts conserva los recorridos generales y de rendimiento.
- QA huerta/surtido de nivel 1 (2026-09-01): la parcela empezó en `GROWING`, maduró con tres tomates T1 y una única pasada de 20,02 m cosechó las tres unidades sin bloquear la locomoción; al agotarse volvió a `GROWING`, rebrotó a `READY` y las tres unidades pasaron de la cesta mixta al expositor real. El aviso normal de guardado permaneció oculto y no hubo errores de consola, página, red ni WebGL (`/tmp/market-level-one-final-v5-20260901`).
- QA de clientes, carro y caja (2026-09-01): tres clientes produjeron 926 fotogramas de movimiento con avance mediano 1:1, pausa de 0,54 %, salto máximo de cabeza de 0,645° y agarre máximo de manillar de 0,353. La descarga reproduce `CheckoutItem` por cada unidad de 900 ms; la mercancía deja el carro al cargarla y la bolsa completa permanece en mostrador hasta pasar una sola vez a la mano. La prueba dirigida presentó simultáneamente una compra activa y la bolsa pagada del cliente anterior, escaneó y embolsó 2/2 unidades, conservó pago y entrega visibles 5,379 s, registró una única venta de `424`, devolvió el carro y no cruzó la puerta antes de abrir (`/tmp/market-customers-final-v9-20260901` y `/tmp/market-checkout-final-v5-20260901`).
- QA móvil, persistencia y activos (2026-09-01): con tres clientes activos, 390×844 y 360×800 mantuvieron 60 FPS de mediana/p95 19,05 ms, movimiento táctil de 1,466 unidades, cabecera y dock dentro del viewport, cero solapes, panel financiero completo y autoguardado normal oculto. Servidor y recarga reprodujeron sin diferencias la revisión 3. Los 203 GLB pasaron `gltf-validator` sin errores ni advertencias, y se cargaron los 112 accesorios sin contaminación entre instancias ni pérdida WebGL (`/tmp/market-mobile-final-d-20260901`, `/tmp/market-persistence-final-20260901`, `/tmp/market-character-final-v2-20260901` y `/tmp/market-accessories-final-v2-20260901`).
- QA de concurrencia (2026-09-01): cuatro empleados de niveles 1/2/3/5 avanzaron 1:1 con velocidades distintas de 1,50/1,58/1,66/1,82 y solo 1,67 % de pausas. Treinta clientes más esos cuatro empleados sostuvieron 60 FPS/p95 17 ms, 1,294 M de triángulos y WebGL Vulkan estable sobre RTX 4080 SUPER, sin errores (`/tmp/market-workers-final-20260901` y `/tmp/market-30-clients-final-20260901`).
- Último recorrido integral (2026-08-30): 15:03 minutos, nivel 6, cinco clientes, 60 FPS/p95 16,8 ms, persistencia exacta, touch efectivo y cero errores de consola/página/red (`/tmp/market-full-game-15m-20260830-perfect-v2`).
- Recorrido integral de referencia previo a retirar los pads de gerencia (2026-08-31): 15:07 minutos de juego real, nivel 6, cinco clientes, 12 reposiciones, trigo/molino, cuatro cuadrantes de ratón, liberación, UI y touch móvil; snapshot local/servidor y recarga fueron idénticos en revisión 63, sin diferencias ni errores de consola, página o red (`/tmp/market-full-game-isolation-final-v12-20260831`). La navegación actual conserva aquella polilínea completa del NavMesh, mientras gerencia y mejoras viven ahora exclusivamente en el tablet.
- QA dirigido de caja (2026-08-31): sin empleado ni jugador en el puesto, 1,5 s de mundo activo conservaron `scanned=0`, clientes atendidos `0` y saldo `220000`; al entrar en el rectángulo se activó el plano cercano, se escanearon dos unidades, el pago por tarjeta se registró una sola vez, la bolsa pasó al carro y el cliente lo devolvió antes de salir. Chromium usó la RTX 4080 SUPER mediante Vulkan, sin error de consola, página, red ni pérdida WebGL (`/tmp/market-checkout-targeted-20260831-v2`).
- Regresión dirigida puerta/caja (2026-08-31): el cliente de salida permaneció exactamente en `z=7.25` durante los estados `CLOSED/OPENING` y solo avanzó al llegar la puerta a `OPEN/1`; no hubo ninguna muestra de cruce prematuro. En caja, dos unidades conservaron saldo y contador en cero sin trabajador, el cliente permaneció en `PAY` y en `queueSlot=0` sin cobro, y pago más entrega permanecieron visibles 5,205 s antes de recoger la bolsa. Venta única, carro devuelto, RTX 4080 SUPER Vulkan y cero errores de consola, página, red o WebGL (`/tmp/market-door-checkout-targeted-20260831-v2`).
- Regresión de orientación y compra vacía (2026-08-31): un cliente sin artículos pasó directamente a `NAVIGATE_TO_CART_RETURN`, quedó fuera de `queueCustomerIds` y nunca obtuvo transacción. El puesto real se alcanzó en `[16.1, 10.24]`, al lado del escáner y opuesto a la sala de ventas; el plano de cajero mostró cliente, carro, cinta, datáfono, monitor y bolsa con la caja orientada hacia el trabajador. Dos artículos no avanzaron sin presencia, el pago permaneció visible 5,257 s y se registró una sola vez; RTX 4080 SUPER Vulkan y cero errores de consola, página, red o WebGL (`/tmp/market-checkout-facing-store-20260831-v3`).
- QA específico de clientes (2026-08-30): dos pasadas consecutivas midieron 977/981 fotogramas de movimiento, avance mediano 1:1 y solo 0,82 %/0,20 % de muestras bajo el umbral; el salto máximo de cabeza fue 2,39°/1,72° por fotograma y la cesta siguió la mano durante más de 1.200 muestras combinadas. El estrés de 30 clientes se mantuvo en 60 FPS/p95 16,8 ms sobre la RTX 4080 SUPER, sin errores ni pérdida WebGL (`/tmp/market-customer-runtime-final-v3-a`, `-v3-b` y `/tmp/market-30-clients-customer-fix-v3-final`).
- QA específico de trabajadores (2026-08-30): el avance visual mediano subió de 85,4 % a 100,0 % de la distancia prevista. Tres pasadas posteriores midieron solo 1,25 %, 0,41 % y 0,62 % de fotogramas bajo el umbral, manteniendo velocidades diferenciadas por nivel: 1,50 (T1), 1,58 (T2), 1,66 (T3) y 1,82 (T5). La regresión de clientes permaneció en avance 1:1, pausa 0,61 % y sin errores; 30 clientes más cuatro empleados sostuvieron 60 FPS/p95 16,8 ms (`/tmp/market-worker-runtime-final`, `/tmp/market-customer-runtime-worker-regression` y `/tmp/market-30-clients-worker-motion-final`).
- QA de aislamiento jugador/NPC (2026-08-30): mientras el vendedor caminó seis segundos, los clientes mantuvieron avance mediano 1:1, p10 0,88, solo 0,66 % de pausas y 59 capturas en 5,9 s, sin snapshots ni revisiones por metro fuera del tick autoritativo (`/tmp/market-customer-player-motion-fix-v3`). El retest de trabajadores dio 0,31 % de pausas; el estrés con 30 clientes y cuatro empleados sostuvo 60 FPS/p95 16,8 ms; móvil sostuvo mediana de 60 FPS; y los 112 accesorios cargaron sin contaminación, errores ni pérdida WebGL (`/tmp/market-worker-isolation-audit-rerun`, `/tmp/market-shared-state-30-client-audit`, `/tmp/market-shared-state-mobile-audit` y `/tmp/market-accessory-isolation-audit`).
- `src/components/game/Customer.tsx`: clientes independientes, morphs faciales, carro con contenido y bolsa sincronizados con el recorrido.
- `src/components/game/MarketKit.tsx`: catálogo visual de estanterías, góndolas, refrigeración, caja, carros, panadería, molino, proveedores, almacén, servicios y huerta completa.
- `src/components/game/AvatarCustomizer.tsx`: vestuario reutilizado en la creación de empresa y en el panel Avatar durante la partida.
- `src/app/globals.css`: sistema visual global y adaptación móvil.
- `src/lib/auth.ts` y `src/lib/db.ts`: autenticación y conexión compartidas por todas las APIs.

## Variables de entorno

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión Prisma/PostgreSQL; en local apunta al túnel `127.0.0.1:5432` |
| `APP_URL` / `BETTER_AUTH_URL` | Origen confiable y URLs de autenticación |
| `AUTH_SECRET` / `BETTER_AUTH_SECRET` | Firma de sesiones y tokens |
| `RESEND_API_KEY` | Envío de recuperación de contraseña |
| `PORT` | Puerto de `next start`; producción usa `4010` |
| `NODE_ENV` | Comportamiento desarrollo/producción |
| `LOCAL_DEV_ORIGINS` | Orígenes adicionales separados por coma para probar `next dev` y Better Auth desde la LAN |
| `STRIPE_*`, `HUBSPOT_ACCESS_TOKEN` | Reservadas y vacías; no se usan en esta versión |

Los valores solo existen en `.env` local, secretos de Actions y `/var/www/market/.env`; nunca se versionan.

## Infraestructura y entrega

- Repositorio `Ferolicas/market`; producción en `/var/www/market`.
- Push a `main` ejecuta typecheck, lint, tests y build; luego migra, recarga PM2 y comprueba salud.
- Caddy termina HTTPS y redirige a `127.0.0.1:4010`.
- Comprobación previa al push: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Lecciones y gotchas

- 2026-08-26: Prisma 7 necesita `DATABASE_URL` incluso en instalación porque `postinstall` genera el cliente.
- 2026-08-26: el desarrollo local depende de un túnel SSH a PostgreSQL antes de iniciar Next.js.
- 2026-08-26: la clave Resend es de solo envío; enviar funciona aunque consultar la API administrativa de dominios responda 401.
- 2026-08-26: los mensajes `Server Reference ID` observados coincidieron con el reemplazo del build durante deploy; PM2 quedó con cero reinicios inestables.
- 2026-08-26: `walking` no puede estar activo permanentemente; debe seguir el input real y animar articulaciones para evitar el efecto de avatar flotante.
- 2026-08-26: el dueño adulto incluye los clips `Idle`, `Walk`, `Run`, `Enter`, `Wave`, `ReceiveOrder`, `LiftBox`, `CarryBox`, `StockLow`, `StockHigh`, `ScanItem`, `Pay`, `Plant`, `Harvest` y `Happy`, tomados de la intención corporal de las hojas PNG del kit.
- 2026-08-26: una malla triangulada con vértices UV separados se rompe al deformarse; el dueño debe conservar la retopología soldada antes de calcular pesos automáticos del esqueleto.
- 2026-08-26: `supermarket_characters_glb_pack.zip` no es fuente del juego. Las vistas y hojas de poses PNG son la especificación visual y de movimiento obligatoria.
- 2026-08-26: al optimizar GLB, cada acción debe conservar `fake user` antes de purgar datos huérfanos; de lo contrario Blender elimina los clips aunque el modelo se vea correctamente.
- 2026-08-26: los clientes usan rutas escalonadas y carriles de entrada alternos para no aparecer sobre el jugador; los objetos que llevan se muestran solo durante los clips correspondientes.
- 2026-08-26: una cámara perseguidora cercana impide leer un simulador de gestión. La escena usa proyección ortográfica isométrica para mantener tienda, entrada y exterior en cuadro; solo la caja cambia temporalmente a un encuadre cercano.
- 2026-08-26: `CHECKOUT` exige `paymentMethod` (`cash` o `card`). La venta y el libro contable conservan el método de pago, mientras los cobros automatizados se identifican como caja automática.
- 2026-08-26: Better Auth debe usar `http://localhost:3000` como `baseURL` durante `next dev`, aunque `.env` contenga la URL HTTPS de producción. Además, `localhost`, `127.0.0.1` y los valores explícitos de `LOCAL_DEV_ORIGINS` deben estar en `trustedOrigins`; de lo contrario el login local devuelve 403 o emite una cookie `Secure` inutilizable por HTTP.
- 2026-08-26: React puede solicitar dos veces la partida inicial durante el montaje en desarrollo. La creación de `GameSave` debe ser un `upsert` atómico por `userId + slot`, no una secuencia `findUnique` seguida de `create`, para evitar un 500 por carrera de unicidad en perfiles nuevos.
- 2026-08-26: el guardado debe rechazar cuerpos vacíos o JSON roto con 400; una petición interrumpida no puede convertirse en un 500.
- 2026-08-26: fiscalidad y licencias son una simulación educativa, no asesoría fiscal ni contable.
- 2026-08-28: el motor 3D debe cargarse después de confirmar la sesión; precargar todos los cuerpos GLB bloquea el hilo principal aunque WebGL use una GPU dedicada. Los personajes se resuelven por límites Suspense independientes y los clientes entran progresivamente. El entorno de iluminación es local y no depende del HDR remoto de Drei.
- 2026-08-28: un clip llamado `Walk` no garantiza que exista una marcha. Los cuatro cuerpos tenían 59 de 60 canales constantes y solo trasladaban `Hips`, por eso se deslizaban. La marcha debe mover piernas, rodillas, pies, brazos y torso, cerrar exactamente el ciclo y permanecer in-place porque `MarketScene` ya controla el desplazamiento mundial.
- 2026-08-28: los seis visitantes repetían el mismo defecto en `Walk`, `Enter` y `Exit`; `CarryBasket` añadía una rotación extrema y la ruta teletransportaba desde cola a caja. La locomoción de visitantes debe reparar los cuatro clips, mantener la cesta estable y probar continuidad de posición en todas las fronteras temporales.
- 2026-08-28: la sensación natural de control depende también del controlador: velocidad máxima instantánea y orientación directa hacen que un toque lateral parezca un giro completo. Se usan rampas de respuesta cortas, frenado rápido, delta máximo de 50 ms y giro angular limitado.
- 2026-08-28: la escala global `3×` queda como referencia visual del personaje. La planta se amplía aparte `2×` en X/Z y el equipamiento `1.6×`; rutas, puestos de empleados, límites, colisiones e interacciones consumen los mismos factores desde `world-scale.ts`. La cámara sigue la nueva posición lógica del vendedor sin límites ni zona muerta, conserva su ángulo y reduce el zoom para verse un `15%` más alejada. El movimiento del vendedor y su animación aumentan juntos un `30%`.
- 2026-08-28: ampliar muebles sin rediseñar los segmentos rectos de visitantes provoca que atraviesen góndolas aunque sus destinos sean válidos. Las rutas deben usar pasillos intermedios, orientar el cuerpo hacia un punto adelantado y probar cada muestra temporal contra el volumen escalado compartido. `ContactShadows` congelado a un fotograma no sigue actores móviles; cada personaje necesita una sombra ligera propia para conservar contacto visual con el suelo.
- 2026-08-28: la marcha v2 articulaba espinillas, pero unos 20° de flexión concentrados en media zancada seguían pareciendo rígidos. La v3 mantiene flexión basal, alcanza una flexión visible durante el vuelo y compensa tobillo, pelvis, torso y brazos. Al crecer el vendedor `10%` y acelerar otro `20%`, la cadencia se calcula por velocidad relativa al tamaño para no convertir la marcha en carrera ni deslizamiento.
- 2026-08-29: reutilizar el cabello incluido en cada GLB impide que los 16 peinados funcionen en los cuatro cuerpos: quedan coletas y mechones duplicados bajo la opción nueva. La v2 se limpia en Blender y monta todo el cabello seleccionable sobre `Head`; las vistas laterales siguen siendo la prueba obligatoria porque un PNG frontal no aporta una cabeza 3D limpia ni profundidad exacta.
- 2026-08-29: acelerar la traslación no obliga a multiplicar la cadencia en la misma proporción. La v5 conserva la cadencia de reproducción `1.12×`, aumenta a 73 muestras y mantiene contacto de talón, apoyo, despegue y vuelo para evitar el aspecto de carrera en el sitio.
- 2026-08-29: en la orientación +Z de los modelos, una rotación X positiva lleva el pie hacia atrás. La v6 inicia el apoyo con rotación negativa, barre hacia positiva y conserva los brazos en oposición; una prueba semántica valida ambos extremos para impedir que la marcha vuelva a reproducirse al revés.
- 2026-08-29: una recuperación local con la misma revisión de guardado pero una revisión lógica de juego mayor representa cambios aún no sincronizados; `loadGame` debe conservarla y volver a marcar la partida como pendiente en vez de reemplazarla por el servidor. La bienvenida guarda inmediatamente país y avatar.
- 2026-08-29: una cámara ortográfica no necesita tres LOD simultáneos por cliente: la distancia 3D no cambia el tamaño en pantalla. El runtime selecciona una sola fuente por viewport, y las cuatro texturas de superficie se comparten en GPU en vez de clonarse por mueble.
- 2026-08-29: el service worker de producción no debe controlar `next dev` ni recalentar todos los recursos ya solicitados. En localhost se desregistra y limpia su caché; en producción los GLB/texturas usan cache-first y una nueva versión de caché invalida assets anteriores.
- 2026-08-30: calcular los ejes de movimiento desde `camera.getWorldDirection()` durante el seguimiento amortiguado introduce una pequeña realimentación lateral (medida en 1,54 cm por 1,28 m al avanzar). Como la cámara conserva un ángulo fijo, el control debe usar su base XZ inmutable; el QA de apertura mide ahora las cuatro flechas y falla si cualquier eje fuga más del 0,3%.
- 2026-08-30: interpolar snapshots de clientes a 4 Hz produce avance/frenado visible y los waypoints Recast muy cercanos pueden añadir otra pausa. El mundo se actualiza a 10 Hz, `walkCustomer` consume la distancia del tick a través de varios puntos y el render extrapola como máximo tres ticks (300 ms) sobre la polilínea autorizada; ese margen absorbe un tick tardío del navegador sin cruzar el destino. Un hueso `Head` animado no debe recibir además rotaciones acumulativas: se conserva un solo pose driver con límite angular. Las cargas siguen la posición de `Hand_L`, pero mantienen vertical propia para que la cesta no copie el giro rígido de la muñeca.
- 2026-08-30: los trabajadores sufrían la misma pausa por dos causas heredadas: `walkEmployee` terminaba el tick al alcanzar cada waypoint y `Npc` aplicaba otro `lerp` sobre una posición ya discreta, dejándolos visualmente un 14,6 % por detrás. Empleados y clientes comparten ahora el integrador multipunto y la proyección visual continua. No se debe igualar su valor de velocidad: el tier del trabajador sigue siendo parte de la progresión.
- 2026-08-30: `applyGameAction` clona la partida completa también al registrar distancia del vendedor; depender de la referencia completa de `customer` o `employee.runtime` reiniciaba la extrapolación de todos los NPC cada metro y el frenazo se percibía especialmente al pasar cerca. Los snapshots visuales dependen del reloj autoritativo de 10 Hz y de transiciones reales de estado, no de identidades de objetos clonados por acciones ajenas al movimiento.
- 2026-08-30: incluso sin reiniciar snapshots, despachar y persistir una acción global desde el bucle Rapier cada metro añade trabajo síncrono en mitad del frame. La telemetría de locomoción queda desacoplada en el store y el motor la consume dentro del tick mundial ya existente; así distancia, progresión y recuperación siguen siendo autoritativas sin revisiones ni serializaciones adicionales.
- 2026-08-30: las zonas automáticas también pueden emitir cada 180–250 ms. No deben llamar individualmente a `applyGameAction`, porque cada llamada clona y serializa la partida completa; se encolan en memoria privada del store y `advanceWorld` las procesa sobre su única copia del tick, sellando eventos y aumentando la revisión una sola vez.
- 2026-08-30: la señal visual de una zona repetitiva tampoco debe crear un objeto React nuevo por pulso. `GameShell` conserva una sola actividad visual mientras el actor siga dentro, renueva únicamente su caducidad y cambia el estado renderizado solo al entrar, cambiar de zona o salir.
- 2026-08-30: un `useFrame` opcional sigue registrando un callback aunque su cuerpo no haga nada. `EnvironmentModel` monta el conductor solo para modelos animados; los estáticos no participan en el bucle. Cualquier GLB cuyo frame cambie un material debe clonar y liberar ese material por instancia.
- 2026-08-30: vectores Three.js reutilizados a nivel de módulo y materiales GLTF compartidos son estado mutable global disfrazado de optimización. Pies, escala, sockets de cesta, materiales de cliente y temporales físicos pertenecen a cada instancia; las geometrías y texturas inmutables sí permanecen compartidas. Los pasos usan además cooldown por actor, no uno global por cue.
- 2026-08-31: el centro visual de una máquina grande no siempre es un destino caminable después de erosionar el NavMesh por el radio del personaje. El molino dejaba solo 14 cm de solape entre el polígono accesible y su sensor, la oficina 24 cm y la panadería 34 cm. Sus centros de interacción —y el de caja— se colocan en el borde caminable visible del propio elemento; ampliar radios indiscriminadamente podría solapar oficina y contratación y disparar la acción equivocada.
- 2026-08-31: la presencia de un rol `cashier` no equivale a presencia física. El motor solo permite escaneo automático cuando su runtime llegó a `OPERATE_CHECKOUT`; el jugador solo emite `CHECKOUT` dentro del rectángulo. Carga, escaneo, embolsado, pago, bolsa, retorno del carro y abandono a los cinco minutos son fases separadas y persistentes.
- 2026-08-31: los clientes no usan los colliders Rapier de las hojas correderas, por lo que el sensor visual no basta para impedir un cruce. Entrada y salida deben tener una barrera lógica en el motor, abrir el sensor con anticipación y mantener velocidad visual cero en el umbral hasta la apertura completa. En caja tampoco se deben solapar descarga y escaneo ni liberar `queueSlot=0` al comenzar `PAY`: hacerlo reduce una compra corta a menos de un segundo y permite que la fila invada al cliente que todavía paga.
- 2026-08-31: `UNLOAD` usa el gesto de colocar artículos; permitir que un carrito vacío alcance ese estado se ve como una mano alzada seguida de un pago falso. La invariancia correcta es sacar cualquier compra de cero unidades de la cola antes de `UNLOAD`. La orientación de caja tampoco puede repartirse entre constantes de motor, escena y mobiliario: girar solo el modelo dejó pantalla, trabajador, fila y cámara en lados contrarios; todos consumen ahora `checkout-layout.ts`. Los puestos de cliente y la fila permanecen sobre un mismo eje de pasillo, porque escalonarlos hacia el mostrador invade el volumen ampliado de la caja; las rutas de entrada y salida rodean el mobiliario por ese corredor compartido.
- 2026-08-31: producción y movimiento usan exclusivamente `simulationTimeMs`. Una migración antigua creó cultivos con `lastServerTime` (reloj Unix), dejándolos creciendo indefinidamente frente al reloj del mundo; `normalizeGameState` rebasa esos cultivos y máquinas conservando el tiempo restante, y todo cultivo nuevo se crea ya en el dominio temporal de la simulación.
- 2026-09-01: la instrucción final reemplaza la siembra manual inicial por cultivo y rebrote automáticos. El nivel 1 parte creciendo, cada bancal T1 entrega tres unidades en una sola pasada y la guía plegada enseña cosechar, surtir, abrir, recibir y cobrar sin carteles sobre la huerta. El sensor de la puerta solo mueve las hojas; el estado comercial sigue cambiándose de forma explícita para impedir consumo antes de surtir.
- 2026-08-31: un estante genérico con cajas de colores no comunica qué vende. `retail-layout.ts` mantiene una sola relación producto/departamento/posición y los seis departamentos muestran mobiliario, rótulos, paleta y unidades 3D propias con stock real.
- 2026-09-01: los recuadros visibles y pads de compra ensuciaban el mundo y se eliminaron. Producción, animales y caja conservan sensores contextuales invisibles que detienen/orientan durante el gesto; cosecha y surtido nunca bloquean el controlador y muestran arcos de producto entre cultivo, cesta y expositor. Gerencia, contratación y mejoras viven únicamente en la interfaz compacta.
- 2026-08-31: las PNG originales del kit son fuentes privadas externas y no existen en GitHub Actions. `AssetRegistry.test.ts` valida siempre que cada recurso runtime aprobado exista dentro de `public/` y que cada referencia pertenezca a `MARKET_REFERENCE_ROOT`; solo comprueba físicamente las PNG fuente cuando ese montaje privado está disponible. Así el CI no depende de una ruta absoluta del ordenador de arte sin debilitar la validación local.

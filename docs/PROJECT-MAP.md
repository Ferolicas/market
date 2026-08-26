# Mini Market — mapa vivo

Actualizado: 2026-08-26 · Base local: cambios visuales sin publicar

## Identidad y stack

Simulador empresarial 3D individual y privado para la familia, jugable en navegador e instalable como PWA. Combina trabajo manual por proximidad, automatización mediante empleados, proveedores, contabilidad educativa por país y expansión con caja global. Producción: `market.olcas.app`, PM2 `market`, puerto `4010`, PostgreSQL `market_db`.

- Next.js 16.3.3, React 19.2.8 y TypeScript 5.
- React Three Fiber 9, Drei 10 y Three.js 0.185 para la escena low-poly y los personajes GLB animados.
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
| `/sw.js` | `public/sw.js` | Caché del shell y soporte offline | No | Caché del navegador |

`src/app/layout.tsx` aporta metadatos, viewport, tipografías y registro del service worker. `src/app/globals.css` contiene todo el sistema visual responsive.

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
- `GameSave`: estado JSONB, ranura única por usuario, revisión y checksum SHA-256. El esquema de partida v2 conserva cuerpo, peinado, color del cabello, piel, camisa y gorro; las partidas v1 se normalizan al cargar.
- `LedgerEntry`: movimiento en unidades monetarias menores, día, franquicia, categoría y revisión.

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
4. Zustand guarda recuperación inmediata en `localStorage` y sincroniza cada 10 segundos.
5. `PUT /api/game/save` valida con Zod, compara revisión, actualiza estado/perfil y añade libro contable en una transacción.
6. Un conflicto 409 conserva una copia local y carga la versión más reciente del servidor.

### Simulación y expansión

1. `MarketScene.tsx` traduce teclado, táctil, mando y proximidad a acciones. Usa una cámara ortográfica isométrica de plano general y una transición específica de caja; también centraliza límites, fachada y colisiones de todo el mobiliario.
2. `Avatar.tsx` clona uno de los cuatro GLB reconstruidos desde las vistas PNG: `owner_kit_v1.glb`, `woman_kit_v1.glb`, `boy_kit_v1.glb` o `girl_kit_v1.glb`. Todos usan malla soldada, esqueleto deformable y escalas por edad. Los gorros se montan sobre `Head` con la corrección de altura del nuevo rig.
3. `Customer.tsx` instancia los seis clientes del kit y ejecuta su ciclo autónomo de 47 segundos: recorrido desde la calle, entrada, compra, cola, pago, bolsa y ocho pasos de salida exterior. Cesta y bolsa son portales unidos a `Hand_R`; la cantidad crece con el nivel de caja hasta un máximo de seis.
4. `MarketKit.tsx` compone el mobiliario, maquinaria, accesorios, señalización y huerta; `MarketScene.tsx` mantiene las zonas de interacción y colisiones correspondientes.
5. `AvatarCustomizer.tsx` permite cambiar en cualquier momento cuerpo, 16 peinados, color de pelo, piel, camisa y 14 gorros animales opcionales; la vista previa es 3D y gira 360°.
6. `engine.ts` procesa cosecha, maquinaria, stock, caja, empleados, pedidos, tiempo y cierre diario.
7. `catalog.ts` es la fuente única de países, escalas monetarias, productos, proveedores, roles, sombreros y seis franquicias.
8. Cambiar de franquicia modifica la ubicación activa, no la caja global ni los recursos compartidos.

## Dependencias compartidas

- `src/game/types.ts`: contrato común de partida, acciones y eventos; cambiarlo afecta motor, UI, validación y persistencia.
- `src/game/catalog.ts`: balances y contenido; los importes base pasan siempre por `countryMoneyScale`.
- `src/game/engine.ts`: autoridad única de reglas económicas; debe permanecer puro y cubierto por Vitest.
- `src/game/store.ts`: sincronización cliente-servidor, autosave, offline y conflictos.
- `src/lib/game-validation.ts`: frontera de confianza para partidas recibidas por API.
- `src/components/game/GameShell.tsx`: orquesta HUD, paneles, escena y ciclo de autosave.
- `src/components/game/MarketScene.tsx`: render, controles 3D y estado caminar/parado; no debe duplicar lógica económica.
- `src/components/game/GameShell.tsx`: además del HUD y paneles, posee el modo de caja bloqueado, calcula la presentación del recibo y despacha `CHECKOUT` con el método elegido por el cliente.
- `src/components/game/Avatar.tsx`: rig visual compartido por jugador, empleados y clientes. Reproduce los clips incluidos en cada GLB, sin balanceo procedural ni elevación artificial. El animal siempre es gorro y no sustituye la cabeza humana.
- `public/models/*_kit_v1.glb`: los cuatro cuerpos del kit retopologizados con texturas derivadas de sus vistas PNG y clips `Idle`, `Walk`, `Run`, `Enter`, `Wave`, `ReceiveOrder`, `LiftBox`, `CarryBox`, `StockLow`, `StockHigh`, `ScanItem`, `Pay`, `Plant`, `Harvest` y `Happy`.
- `src/components/game/Customer.tsx` y `public/models/customer[1-6]_kit_v1.glb`: clientes independientes reconstruidos desde `cliente1.png`–`cliente6.png`, con 24 clips y accesorios de cesta/bolsa sincronizados con el recorrido.
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

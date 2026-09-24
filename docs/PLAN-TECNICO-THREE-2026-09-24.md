# Plan técnico — cliente Three.js (niveles, progresión, persistencia, multijugador, móvil, QA)

Fecha: 24-09-2026. Estado: **aprobado el 24-09-2026 salvo la fase C (multijugador, salas y sincronización), que el usuario descartó.** Avance: A, B, D y E hechas (ver las entradas del 24-09-2026 en `PROJECT-MAP.md`). B2, D1, D3, D4 (KTX2) y D5 descartados con medición; D6 queda como puerta local (CI sin GPU).

Alcance: solo el cliente Three.js/Next.js (`src/`, `scripts/`, `prisma/`, `deploy/`). `godot/` queda fuera y no se toca. Los GLB, PNG y audio existentes son la fuente de verdad: no se generan assets nuevos ni se usan créditos de Higgsfield. Toda la infraestructura es propia (VPS, PM2, Caddy, PostgreSQL 17); nada de Cloudflare Workers, Durable Objects ni `higgsfield website`.

Método: se tomó del skill `higgsfield-websites` (guías `game-flow.md`, `game-design-system.md`, `review-rubric.md`) únicamente la **arquitectura** — el contrato de seis funciones puras (`meta / setup / validateAction / applyAction / isGameOver / viewFor`), salas autoritativas en servidor, entrada como objetos de comando con id de jugador, paso fijo + RNG con semilla, presupuestos de rendimiento fijados antes de escribir código, pruebas contra el runtime real por WebSocket y playtest con dos pestañas. Lo que el skill asume sobre despliegue (Workers, D1, `bun`) se sustituye por el equivalente propio.

---

## 0. Diagnóstico: qué hay hoy (medido en el árbol actual)

| Área | Estado real | Hueco frente a la arquitectura objetivo |
| --- | --- | --- |
| Reglas | `src/game/engine.ts` (3 032 líneas) es puro: sin `Date.now`, sin `Math.random`; `CustomerBrain` usa `seededRandom`. Único no determinismo: `crypto.randomUUID()` en 5 puntos (pedidos, empleados ×2, transacciones de caja, ids de evento). | Con ids derivados de secuencia, el motor es **reproducible** → base para replay en servidor y para salas. |
| Tick | Mundo autoritativo a 5 Hz (`WORLD_TICK_INTERVAL_MS = 200`) con `structuredClone` del estado entero cada tick; jugador y física a 60 Hz en Rapier (`useBeforePhysicsStep`). | El clon completo a 5 Hz es coste móvil y bloquea una sala con N jugadores. |
| Niveles | 30 niveles: 1 + 27 compras (`OPENING_PURCHASES`, niveles 2–28) + tareas personales (29) + encargos (30). `CampaignLevels.ts` es la fuente común de motor, HUD y validador. Coexisten `levels.ts`/`objectives.ts` (campaña legada) con `Campaign*.ts` (campaña vigente). | Falta un **catálogo de nivel** único y por datos (qué enseña, qué abre, examen, recompensa) y una prueba automática de que los 30 son alcanzables con la economía actual (§7.1 del skill). |
| Persistencia | Servidor autoritativo por snapshot: `PUT /api/game/save` con revisión optimista, `SaveOperation` idempotente, `SaveAuthority` como firewall de invariantes, ledger, recovery IndexedDB (3 s) + sync cada 30 s. Slot 2, cabecera `x-market-release`, tope 600 KB, 30 escrituras/min. | El mapa ya lo dice: "el destino arquitectónico sigue siendo replay de comandos en servidor". Hoy el servidor **valida** el snapshot; no lo **reproduce**. |
| Multijugador / salas / sincronización | **No existe nada**: cero WebSocket en `src/`, un solo avatar de jugador, `FranchiseState.carry` es una sola cesta. | Todo por construir. |
| Móvil | Perfil adaptativo (`AdaptiveQuality.ts`): 30 FPS quieto / 60 en movimiento, DPR ≤ 2 (mínimo 1,5), MSAA, sombra 512, sin transmisión de cristal, `StaticMeshBatch`. Baseline móvil con 30 clientes: 30 FPS, p95 33,4 ms, 243 draws, 375 k triángulos. 213 GLB = 88 MB en `public/models/market`. | Riesgos abiertos de la auditoría del 12-09 (J.2–J.5): 80 transparentes / 61 DoubleSide, batching de muebles, KTX2, culling por sectores. NavMesh se construye en el arranque del navegador. |
| QA | Vitest (93 archivos, 870 pruebas), 20+ guiones Playwright (`qa-full-game.mjs` juega 15 min con bot), `load-test-game-api.mjs`, telemetría de campo (`ClientTelemetry`, ventanas de 1 min). | No hay bot a nivel de motor que recorra 1→30; no hay pruebas de entrada hostil; no hay pruebas de sala (dos pestañas) ni umbrales de rendimiento como puerta de CI. |
| Infra | PM2 `market` en 4010, Caddy → 127.0.0.1:4010, `deploy.sh` (git reset, `pnpm db:deploy`, build, reload), GitHub Actions quality + deploy. | Falta un proceso de tiempo real y su ruta en Caddy. |

Restricción adicional: `scripts/export-godot-*-oracles.mjs` leen el motor TS para generar oráculos. Cualquier cambio de reglas en `engine.ts` debe mantener esos scripts ejecutables (no se toca `godot/`, pero no se les rompe la entrada).

---

## 1. Decisiones de diseño (perfil del juego, §1 del skill)

Estas decisiones fijan la forma de todo lo demás. Las marcadas **[decidir]** necesitan tu respuesta antes de implementar.

- Tiempo: real, paso fijo 5 Hz autoritativo (se conserva).
- Espacio: 3D continuo, una tienda por sala (se conserva).
- Agencia: un vendedor por jugador.
- **Jugadores [decidir]**: propuesta **cooperativo en la misma tienda, 1–4 jugadores por sala**. El propietario es el anfitrión; los invitados trabajan en su tienda con su propio avatar y cesta; el dinero, el almacén, los estantes, las compras de nivel y el progreso son de la tienda (compartidos). Alternativas descartadas salvo que las prefieras: (b) "visita" asíncrona sin simulación compartida; (c) competitivo por clasificación.
- Conflicto: contra el sistema (demanda, paciencia, tiempo del día); sin PvP.
- Resultado: 30 niveles por tienda × 6 locales (se conserva).
- Sesión: minutos a una hora; jornada 07:30–21:00 = 3 h reales (se conserva).
- Fuente de interés: acumulación + ejecución (coordinación en cooperativo).
- Plataforma más débil: **móvil Android medio**; sus presupuestos mandan (§4).
- Un jugador sigue siendo **local y sin conexión** (PWA): el bucle actual no cambia para partidas de un jugador. Las salas cooperativas son **autoritativas en servidor**. Los dos caminos comparten el mismo `engine.ts`.

---

## 2. Fase A — Sistema de niveles y progresión (solo datos + pruebas; sin cambiar la economía)

Objetivo: un catálogo de nivel único y verificable, sin alterar precios, cupos ni el grafo de compras aprobados.

A1. `src/game/progression/LevelCatalog.ts`: 30 entradas por datos, una por nivel: `unlocks` (compra/instalación/producto/empleado que abre), `teaches` (el patrón nuevo, uno por nivel: §L3), `exam` (qué tarea o encargo cierra el nivel), `nextStep` (texto de "siguiente paso" para el HUD al volver, §10.1), `reward` (verbo nuevo, capacidad o cupo). Se construye **a partir** de `OPENING_PURCHASES`, `CAMPAIGN_TASKS`, `CAMPAIGN_CONTRACTS` y `CASHIER_UNLOCK_LEVELS`; no los duplica. Prueba: cada nivel tiene exactamente un patrón nuevo y un examen; los productos que un encargo pide están disponibles en o antes de su nivel (esto ya lo comprueba `campaignContracts`, se convierte en prueba de catálogo).

A2. Retirar la duplicidad `levels.ts`/`objectives.ts` (campaña legada) solo si `isCampaignGame` es siempre cierto en el slot 2 — se mide primero contra los guardados reales del VPS (`production-save-debugging`); si quedan partidas legadas, se conserva y se documenta.

A3. **Prueba de alcanzabilidad 1→30** (§7.1 "consistencia de parámetros"): un bot de motor (sin navegador) que ejecuta `advanceWorld` + acciones óptimas y prueba que se llega al nivel 30 en las seis tiendas dentro de un presupuesto de jornadas; el número se fija antes (propuesta: ≤ 40 jornadas de juego por tienda) y la prueba falla si un cambio de precio o cupo lo rompe. Reutiliza el planificador de `storeSupplyPlan`.

A4. HUD: al cargar, mostrar objetivo actual + siguiente paso (dato de A1). Solo lectura de estado; no cambia reglas.

Entregable: catálogo, 3 archivos de prueba, entrada en `PROJECT-MAP.md`. Riesgo bajo.

---

## 3. Fase B — Persistencia: del snapshot validado al replay de comandos

Objetivo: que el servidor pueda **reproducir** lo que el cliente dice que pasó, con el mismo `engine.ts`, y que el snapshot pase a ser una caché. Es la base compartida de las salas.

B1. **Motor determinista al 100 %**: sustituir los 5 `crypto.randomUUID()` por ids derivados (`${franchiseId}:${tipo}:${secuencia}`; el `eventId` a partir de `eventSequence`). Añadir `seed` a `GameState` (schema v5 con migración en `normalizeGameState`, como v3→v4). Prueba: dos ejecuciones del mismo guion de comandos producen snapshots byte a byte iguales.

B2. **NavMesh horneado**: hoy `ensureStoreNavigation` construye el Recast en el navegador. Se exporta una vez por `structureRevision`/áreas desbloqueadas a `public/navmesh/<firma>.bin` (`recast-navigation` funciona en Node), y cliente y servidor cargan el mismo. Sin esto el servidor no puede reproducir rutas y, de paso, el móvil deja de pagar la construcción en el arranque. No cambia la geometría ni los GLB.

B3. **Comandos como registro**: `GameRuntime` ya agrupa `interactions` y `playerDistanceMeters` por tick; se sellan con `tick`, `playerId` y `seed` en un `CommandBatch`. El `PUT /api/game/save` acepta `commands` además de `state`/`events`.

B4. **Replay en servidor en modo sombra**: el servidor reproduce `commands` desde el snapshot anterior y compara checksum con el snapshot enviado. Discrepancia → se acepta el snapshot (como hoy) pero se registra en `ClientTelemetry` (`kind: replay, name: mismatch`). Tras N días sin discrepancias en producción, se pasa a **modo estricto**: discrepancia = 422 `REPLAY_MISMATCH`.

B5. **Prisma**: nueva tabla `SaveCommandBatch { id, userId, slot, fromRevision, toRevision, tick range, seed, commands Json, createdAt }` con retención (mismo patrón de limpieza que `SaveOperation` a los 14 días), índice `(userId, slot, toRevision)`. Sin cambiar `GameSave`. Migración `prisma migrate` aplicada con `pnpm db:deploy` en `deploy.sh`, backup previo (`/var/backups/vps-admin/...`, como en la release 30).

B6. Cabeceras y límites: el tope de 600 KB se revisa medido (un lote de 30 s de comandos a 5 Hz son ≤ 150 ticks; se mide el tamaño real antes de fijar el nuevo límite).

Entregable: motor determinista, navmesh horneado, replay sombra, migración. Riesgo medio (la migración v5 toca todos los guardados; se bisecará con el validador contra copias reales del VPS antes de desplegar).

---

## 4. Fase C — Multijugador, salas y sincronización (infra propia) — DESCARTADA por el usuario el 24-09-2026; se conserva como referencia

### C1. Proceso de tiempo real

- Nuevo proceso PM2 **`market-realtime`** (Node 26, TypeScript compilado con `tsc`, sin Docker), puerto **4011**, entrada `src/realtime/server.ts`. Librería `ws`. Comparte `engine.ts`, `SaveAuthority`, Prisma y `lib/db`.
- Caddy: `handle /ws/*` → `reverse_proxy 127.0.0.1:4011` en el bloque de `market.olcas.app` (`deploy/Caddyfile.example` actualizado; la config activa del Caddy central se valida antes de recargar, como manda el mapa).
- Autenticación: el cliente abre `wss://market.olcas.app/ws/<sala>` con la cookie de Better Auth; el servidor valida la sesión leyendo la tabla `session` (mismo Prisma) — nada público, mismo criterio que el resto de rutas.
- `ecosystem.config.cjs` añade la app; `deploy.sh` la recarga; `/api/health` informa del estado del proceso de tiempo real.

### C2. Contrato de sala (traducción del `room.ts` del skill a infra propia)

Una sala = una tienda de un anfitrión = una simulación autoritativa en servidor a 5 Hz con **el mismo** `advanceWorld`.

| Función del skill | Equivalente aquí |
| --- | --- |
| `meta` | `{ minPlayers: 1, maxPlayers: 4 }` por sala |
| `setup` | carga `GameSave` del anfitrión (slot 2) + navmesh horneado (B2) |
| `validateAction` | **única defensa**: `applyGameAction` ya devuelve `ok:false`; se añade por delante `validateRoomAction(playerId, action)`: jugador presente en la sala, cesta propia, imán realmente cercano (posición autoritativa del jugador ≤ radio del fixture), ritmo máximo de acciones por jugador |
| `applyAction` | `advanceWorld(state, 200, pathfinder, { interactions por jugador })` |
| `isGameOver` | nunca; la sala se cierra cuando queda vacía y persiste |
| `viewFor` | por ahora todos ven lo mismo (no hay información oculta); se deja el punto de corte para no enviar `processedEventIds` ni el ledger al invitado |

Cambios de estado (schema v5, junto con B1): `FranchiseState.players: Record<playerId, { carry, x, z, avatar, speedTier, capacityTier, joinedAt }>`; `carry` actual pasa a ser el del anfitrión (migración). Las acciones llevan `playerId` (§6.2 "input as command objects"). Progreso personal (`player:*`) y contadores cuentan para la tienda; quién lo hizo se registra en el evento.

### C3. Sincronización

- **Comandos** cliente → servidor: `{ tick, playerId, actions[], move: {x, z, yaw} }` a 10 Hz para movimiento, inmediato para interacciones.
- **Estado** servidor → clientes: snapshot completo al entrar; después **parches** por tick (JSON Patch generado por diff estructural de `franchises[i]` — se mide contra el snapshot completo; objetivo ≤ 8 KB/tick con 30 clientes). El parche llega como un tick de 200 ms más, así los `Customer`/`Npc` ya interpolan con `CUSTOMER_VISUAL_HORIZON_MS`; no cambia la escena.
- **Jugadores remotos**: `RemotePlayer.tsx` reutiliza `Avatar.tsx` y el rig del propietario (cuerpos existentes); posición a 10 Hz con interpolación 150 ms. El jugador local mantiene predicción (Rapier local) — el servidor solo corrige si la distancia supera un umbral (2 u).
- Reconexión: la sala conserva al jugador 60 s; al reconectar recibe snapshot + `lastTick` y reenvía lo pendiente. Con tab oculta el cliente deja de simular (como hoy) y solo recibe.
- Persistencia de la sala: el proceso de tiempo real escribe con la **misma** transacción que `PUT /api/game/save` (extraída a `src/game/persistence/SaveService.ts` para que ruta y sala compartan código): cada 30 s y al vaciarse la sala. Mientras la sala vive, el navegador del anfitrión **no** hace PUT (evita conflictos 409 consigo mismo); su recovery IndexedDB sigue guardando por si se cae el servidor.
- Invitaciones: código de 6 caracteres emitido por `POST /api/game/rooms` (autenticada, límite 5/min), caduca en 24 h; máximo 1 sala abierta por anfitrión.

### C4. Límites y abuso

Ritmo por jugador (≤ 20 acciones/s), tamaño de mensaje ≤ 16 KB, 4 jugadores, 200 salas por proceso (medido: una sala a 5 Hz con 30 clientes ≈ coste de un tick actual del navegador; se carga con `load-test` antes de fijar el número), cierre por inactividad 10 min.

Entregable: proceso, contrato, parches, avatares remotos, invitaciones, Caddy/PM2. Riesgo alto → se entrega detrás de un flag (`NEXT_PUBLIC_MARKET_ROOMS=1`) y primero solo para tu cuenta.

---

## 5. Fase D — Optimización móvil (presupuesto primero, §6.5)

Presupuestos fijados **antes** de tocar nada, para la plataforma más débil (móvil, `coarsePointer`), medidos con `qa:mobile-render` en la build de producción con QA (`three-perf-measurement-workflow`):

| Métrica | Hoy (30 clientes) | Presupuesto |
| --- | --- | --- |
| p95 frame en reposo / en movimiento | 33,4 ms / — | ≤ 33 ms / ≤ 20 ms |
| draws | 243 | ≤ 200 |
| triángulos | 375 k | ≤ 300 k |
| long tasks por minuto | 0 | 0 |
| tiempo de tick de mundo (5 Hz) | sin medir | ≤ 8 ms p95 |
| descarga inicial GLB (primera visita) | 88 MB en disco (no todos se cargan) | medir; objetivo −40 % lo que sí se carga |

Trabajo, uno por uno y con medición antes/después (§0.5):

D1. **Tick sin `structuredClone`**: `advanceWorld` clona 200–600 KB cinco veces por segundo. Sustituir por copia estructural por franquicia con reutilización de los actores que no cambian (o clon solo de la franquicia visitada). Misma salida (prueba de igualdad profunda contra la versión actual sobre un guion de 1 000 ticks).
D2. **NavMesh horneado** (B2): quita la construcción de Recast del arranque móvil.
D3. **Transparencia/DoubleSide** (auditoría J.2): inventario material por material; `FrontSide`/opaco solo donde la captura sea idéntica píxel a píxel (comparación automática con `pixelmatch`).
D4. **Compresión de GLB derivada** (auditoría J.4): meshopt + KTX2 generados **a partir** de los GLB actuales por script (`art:lods` ya sienta el precedente), como salida de build en `public/models/market/compressed/`; los GLB originales no se modifican. **[decidir]** — cuenta como "transformar", no "generar"; se hace solo si lo apruebas.
D5. Culling por sectores (J.5): prototipo con bounds visibles; se descarta si hay popping (criterio de la auditoría).
D6. Puertas de CI: `qa:mobile-render` con los umbrales de la tabla; un PR que los supere falla.

Entregable: informe de medición antes/después por ítem, mapa actualizado. Riesgo medio-visual (D3/D5), por eso cada uno lleva comparación de imagen.

---

## 6. Fase E — QA y playtesting

E1. **Bot de motor** (`src/game/testing/CampaignBot.ts`): juega sin navegador con el planificador; lo usan A3 (alcanzabilidad), B1 (determinismo) y C (carga de salas con N bots).
E2. **Entrada hostil** (§0.3): pruebas Vitest de spam de acciones, acción cancelada a medio camino, dos métodos de entrada a la vez, desconexión en mitad de una transacción de caja; para salas, `validateRoomAction` rechaza acción fuera de alcance, cesta ajena y ritmo excesivo.
E3. **Pruebas de sala contra el runtime real**: Vitest levanta `market-realtime` en un puerto efímero y conduce la sala por WebSocket (como `room.test.ts` del skill): dos clientes, mismo estado, reconexión, persistencia al vaciar.
E4. **Playtest de dos pestañas** (`scripts/qa-rooms.mjs`, Playwright, Chrome+Vulkan): anfitrión + invitado, cosecha y reposición cruzadas, cobro, cierre de jornada, recarga a mitad; captura y `report.json` como los guiones existentes.
E5. **Carga**: `load-test-game-api.mjs` gana modo `rooms` (N salas × M bots) contra local/staging; producción sigue bloqueada sin `ALLOW_PRODUCTION_LOAD_TEST`.
E6. **Campo**: nuevas señales en `ClientTelemetry`: `replay/mismatch`, `room/join|leave|reconnect|desync`, tamaño de parche p95. Sin datos de partida ni correo, como hoy.
E7. Antes de cada push: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` + `qa:mobile-render` con umbrales + `qa:rooms` cuando C esté activa.

---

## 7. Orden, dependencias y tamaño

```
A (niveles, datos+pruebas)  ──┐
B1 determinismo ─ B2 navmesh ─┼─ B3–B6 replay sombra ─ C1–C4 salas ─ E3–E5
D1 tick sin clon ─────────────┘        D2 = B2        D3–D6 en paralelo
```

| Fase | Tamaño estimado | Toca guardados | Toca infra | Detrás de flag |
| --- | --- | --- | --- | --- |
| A | pequeño | no | no | no |
| B | medio | sí (v5, migración) | tabla nueva + backup | replay sombra sí |
| C | grande | sí (players) | PM2 + Caddy + puerto 4011 | sí |
| D | medio | no | no | no |
| E | medio | no | no | — |

Cada fase termina con: checks completos, `PROJECT-MAP.md` actualizado, commit, push, y comprobación de `/api/health` en el VPS.

---

## 8. Lo que necesito que decidas antes de empezar

1. **Modo multijugador**: cooperativo en la misma tienda con 1–4 jugadores (propuesto) — ¿o prefieres visita asíncrona o competitivo?
2. **Alcance de las salas**: ¿solo cooperativo, dejando un jugador local y offline como hoy (propuesto)? ¿O también un jugador pasa a servidor (pierde el juego sin conexión)?
3. **Compresión derivada de GLB (D4)**: ¿autorizas generar copias meshopt/KTX2 a partir de los GLB actuales, sin tocar los originales?
4. **Puerto 4011 y nombre `market-realtime`** para el proceso PM2, y ruta `/ws/*` en Caddy.
5. **Orden**: propongo A → B → D1/D2 → C → D3–D6, con E transversal. ¿Cambias algo?

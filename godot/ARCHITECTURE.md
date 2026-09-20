# Arquitectura nativa en curso

Estado y evidencias: [GODOT-STATUS](../docs/migration/GODOT-STATUS.md). La migración no está terminada.

## Capas

- `scenes/main.tscn` instancia `game/application.gd`. Este nodo posee MarketStore, CanvasLayer, autenticación, mundo y GameAudio. No hay autoloads ficticios.
- `game/engine.gd` es la fachada pura. Las reglas originales están en `core/engine_*.gd`; UI y escena solo despachan acciones o pulsos. Dinero entero en unidades menores con escala por país.
- `game/store.gd` conserva revisión de servidor, eventos pendientes, intento idempotente, copia local, conflictos y mensajes. `persistence/market_api.gd` usa HTTPRequest en nativo y fetch con cookies en Web. `MARKET_API_URL` configura el endpoint nativo; por defecto es localhost:4010. El backend existente sigue siendo autoridad de cuentas y revisiones. Las cookies persistentes nativas se conservan por origen con caducidad y permisos Unix 0600; las pruebas sin directorio configurado permanecen en memoria.
- `persistence/recovery_storage.gd` escribe snapshots atómicos por scope de cuenta en `user://recovery-campaign-30-20260915/`, con agrupación de escrituras de 3 s. `persistence/game_validation.gd` interpreta el esquema generado del Zod original; `util/json_exact.gd` preserva enteros seguros.
- El mundo avanza cada 200 ms, con delta acotada a 1 s; el guardado remoto se programa cada 30 s. La física del jugador corre a 60 Hz. La presentación de NPC proyecta snapshots por un máximo de 300 ms usando las rutas reales.
- `scene/market_world.gd` monta las partes de arte, física, cámara, jugador, empleados, clientes, zonas e inventario. `scene/market_actor.gd` instancia rigs originales y bibliotecas de animación compuestas por los helpers portados.
- `scene/authored_scene.gd` carga geometría GLB derivada del montaje original React/Three y reconstruye sus Label3D. `retail_inventory.gd` utiliza MultiMesh con prototipos y puntos de colocación originales. `cash_markers.gd` representa compras, indicación de nivel durante 9 s y cajones de efectivo. `production_presentation.gd` y `checkout_presentation.gd` actualizan máquinas, productos, cintas, bolsas, vitrinas y devoluciones. `transfer_bursts.gd` mantiene la trayectoria original de productos y fajos; `customer_cart.gd` sigue el rig y la caja.
- `render/source_pbr.gd` adapta materiales nativos a la suma de iluminación/BRDF/ACES de Three con sus PMREM originales y DFG. Conserva StandardMaterial3D como API de presentación y publica parámetros al shader; libera las bases de render antes de destruir materiales compartidos. `render_runtime.gd` aplica perfiles, MSAA y resolución adaptativa con la gracia original.
- `ui/avatar_gallery.gd` genera retratos con un solo rig en un SubViewport de 192 px y almacena sus imágenes; la previsualización y la galería usan sus propios entornos originales.
- `ui/auth_screen.gd` y `ui/game_shell.gd` implementan acceso y paneles sobre MarketStore. `mission_complete.gd` presenta la compra completada durante 3 s, sin repetirla al cargar o viajar. La presentación todavía está en revisión de paridad.
- `telemetry/client_telemetry.gd` reporta errores de guardado y ventanas de rendimiento al backend original con la identidad existente. El puente Web observa únicamente RAF/long tasks del navegador; no contiene gameplay. `ui/safe_area.gd` adapta insets CSS al viewport nativo.
- `feedback/` mantiene preferencias locales, muestras originales, música, vibración y reglas de repetición. El audio se desbloquea mediante un gesto real.

## Coordenadas

- Posiciones del catálogo: layout. X/Z se multiplican por 2; muebles por 1,6; un único padre World aplica la escala global 3.
- El cuerpo físico del jugador está fuera de World y usa unidades físicas globales; su presentación incluye la escala 3 una sola vez. NPC dentro de World usan posiciones de layout × 2.
- InteractionDirector recibe coordenadas físicas divididas entre 3. NavigationServer usa el espacio del layout compartido con el motor.
- Three y Godot conservan +Y arriba y el mismo sistema de coordenadas. El winding de la triangulación de navegación sí requiere conversión explícita.

## Autoría y pruebas

`scripts/export-godot-assets.mjs` convierte los GLB fuente; `scripts/export-godot-scene.mjs` monta los componentes originales en un navegador local sin backend para transferir el arte procedural. React/Three no forman parte del runtime Godot. Los scripts de oráculos ejecutan la fuente TS y generan expectativas; los tests Godot ejecutan las reglas nativas y comparan resultados completos.

`bash godot/tools/test.sh [filtro]` ejecuta Godot headless con supervisión de errores y timeout. `godot/tools/render_scene.gd` captura la escena nativa con una copia temporal aislada; no crea cuentas ni modifica partidas del usuario.

`node scripts/export-godot.mjs Web` exporta con Godot oficial y genera el service worker de `web/service-worker.js`: caché del pack por bloques de 8 MiB y confirmación final del manifiesto. Las API autenticadas quedan fuera de esa caché. `scripts/qa-godot-live-api.mjs` valida el backend real desechable; `MARKET_QA_WEB=1` añade el recorrido de navegador, desconexión, recarga offline y reconexión.


## Interfaz y densidad de pantalla

`application.gd` mantiene la UI Web en unidades CSS mediante `Window.CONTENT_SCALE_MODE_CANVAS_ITEMS`; la ventana conserva su búfer físico. `render_runtime.gd` aplica el DPR original al 3D usando el ancho físico de la ventana, y `glass_transmission.gd` usa esa misma resolución efectiva. Así el tamaño de botones, hitboxes y safe areas no depende del `devicePixelRatio`.

`auth_screen.gd` utiliza los endpoints Better Auth existentes para acceso, registro y recuperación. El callback de correo Web vuelve al formulario nativo `?auth=reset&token=…`; la aplicación prioriza ese flujo incluso si existe sesión. Al volver al inicio se elimina el token de la URL y se consulta de nuevo la sesión real. En escritorio se conserva el callback `/reset-password` del servidor original.

`assets/authored/closed-checkouts.*` se obtiene de `ClosedCheckoutKit` original y solo aparece en las partidas legadas mientras las cajas adicionales estén bloqueadas. Las zonas de compra de campaña conservan su presentación original. Los rótulos 3D comparten `MarketWorldText` con la fuente original y atlas MSDF; no se cambia la fuente de los controles de UI.

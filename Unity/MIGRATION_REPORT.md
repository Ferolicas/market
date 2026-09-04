# Mini Market Unity — informe de migración

Actualizado: 2026-09-03

## Estado ejecutable

- Proyecto: `Unity/MiniMarketUnity/`
- Editor: Unity `6000.3.23f1`, URP `17.3.0`
- Build Web/PWA: `Unity/MiniMarketUnity/Builds/WebGL/`
- Vista local: `http://127.0.0.1:4173`
- Producción: `https://market.olcas.app/`
- Release activo: `/var/www/market-unity/releases/20260903T152317Z`
- Arte fuente: `GameAssets/`; sus masters aprobados no se modifican.
- Next.js, `src/`, `public/`, Prisma y backend permanecen intactos.

## Sistemas migrados actualmente

- Arranque runtime y carga glTF asíncrona.
- Personaje jugable, cámara isométrica, teclado, ratón, touch y joystick virtual.
- Nueve identidades de personajes; el asset de jugador informa 47 clips y 16 blend shapes.
- Materiales runtime derivados de RoyalMatchRubber, cabellos, gorros y sockets.
- Runtime de personajes desacoplado en `Motion` (50 huesos/47 acciones/0 triángulos) + LOD2 (16 morphs), sin descargar simultáneamente tres mallas completas.
- Mundo modular, NavMesh, colliders, interacciones, expositores y productos visibles.
- Economía en unidades menores, jornada, objetivos, niveles, pedidos, inventario y contratación.
- Clientes con entrada, selección de existencias posibles, cesta física, productos visibles, dedos cerrados, compra, cola, cobro y salida.
- Granjeros, operarios y surtidores físicos gobernados por demanda de la tienda y con mercancía/cajas visibles durante el transporte.
- Cultivos con etapas visuales, máquinas y cadena de producción; estaciones, parcelas, animales y segunda caja respetan el nivel.
- Carga limitada del jugador, surtido compatible y devolución íntegra al almacén.
- Recuperación local y cliente HTTP para el backend existente.
- HUD responsive, inventario, pedidos, mejoras, vestuario y cierre de jornada.
- Licencias y compra/viaje entre franquicias con inventarios independientes.
- Perfiles de rendimiento, pooling, instancing, caché PWA y build Web compacta con nombres hash.

## Coherencia de producto validada

La política única evita productos imposibles: los clientes no solicitan artículos sin desbloqueo, expositor o stock; todos los SKU vendibles tienen estante y ninguna fuente productiva aparece después que su demanda. En nivel 4 el zumo no puede producirse. En nivel 6 una prueba de navegador confirmó:

1. El granjero priorizó trigo cuando faltaba pan.
2. El operario llevó trigo al molino y recogió harina.
3. Con harina disponible eligió el horno antes de repetir el molino.
4. Recogió el pan y el surtidor inició su traslado al expositor.

## Validación más reciente

- EditMode: `28/28` pruebas aprobadas.
- WebGL: compilación correcta, `0` warnings del proyecto.
- Browser gameplay: compra, cesta física, cola y cobro completos; 47 acciones, 16 morphs y sin fallos de página o red.
- Browser workers: trigo → harina → pan → surtidor, sin fallos de página o red.
- Browser producción: portada, acceso/registro/recuperación, backend, PostgreSQL, manifest y service worker aprobados sobre HTTPS.
- Catálogo: 237 fuentes runtime auditadas sin IDs duplicados; los nueve `Motion.glb` conservan 47 acciones/50 huesos y no incluyen geometría.
- Build desplegable: `124.794.128` bytes frente a `463.281.581` bytes antes de separar movimiento y podar copias no solicitadas (`−73,1%`).
- QA headless comparable: advertencias de autoplay `187 → 0`; memoria asignada `184,0 → 129,1 MB`; 963.303 triángulos visibles. El FPS headless/software no representa una GPU real.
- Evidencia temporal: `/tmp/mini-market-unity-gameplay-qa.json`, `/tmp/mini-market-unity-worker-qa.json` y `/tmp/mini-market-unity-worker-qa.png`.

## Publicación

Unity está publicado como cliente Web/PWA en el dominio principal. Caddy sirve el release estático y conserva el proceso Next `market` en el puerto `4010` para Better Auth, guardado, ledger y salud. El backup previo al hotfix vive en `/var/backups/vps-admin/2026-09-03-170421`; 120/120 archivos del release verificaron SHA-256 y los tres paquetes Brotli son legibles por Caddy. El alias `/sw.js` migra limpiamente las instalaciones PWA del antiguo cliente Next. `browser-production-game-qa.mjs` confirmó tanto la creación de la instancia como `MINIMARKET_READY` en producción. Android e iOS permanecen preparados pero, por instrucción del propietario, no se compilan todavía. Como observación diagnóstica, Chromium headless registra tres mensajes genéricos de shader sin material rosa ni fallo visual; deben vigilarse en el perfilado futuro sobre dispositivos físicos.

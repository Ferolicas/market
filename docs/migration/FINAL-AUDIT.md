# Auditoría final — 20 de septiembre de 2026

Resultado: **READY WITH NON-BLOCKING ISSUES** para versionar la migración. Esta clasificación no certifica publicación móvil ni sustituye pruebas en dispositivos físicos.

## Alcance y fuentes

Se revisaron `git status`, diff completo de archivos seguidos, estadísticas, eliminaciones y listado de archivos nuevos. Base local: `1ff16cd`; base remota antes de publicar: `3f056e0`. Se conservaron los cambios válidos previos. `migration_tasks/`, `.local-migration/` y `LOCAL_MIGRATION_PLAN.md` no se usaron como reglas ni se incluyeron en la publicación.

Se cotejaron engine/acciones, store, catálogo, escala/coordenadas, economía, clientes, empleados, jornadas, progresión, normalización, guardado/restore, navegación, escenas, puertas, interacción, input, UI, animaciones, audio, assets, HTTP y recuperación WebGL con `src/game/`, `src/components/game/` y los recursos originales. El TypeScript y sus tests no se modificaron. Los oráculos ejecutan las funciones TypeScript reales; no son respuestas inventadas para aprobar Godot.

Archivos centrales: `godot/game/engine.gd`, `core/engine_*.gd`, `store.gd`, `catalog.gd`, `world_scale.gd`, `application.gd`, `persistence/`, `navigation/`, `scene/`, `render/`, `ui/`, `feedback/`, `animation/`, `godot/web/` y sus exportadores/pruebas. Los paths literales de recursos resuelven y los 99 modelos del registro instancian. Los 213 GLB derivados cotejados equivalen byte a byte al original después de decodificar meshopt/cuantización. Las variantes sin pelo se generan desde las máscaras originales.

Los importes y cantidades se comparan exactamente. Las tolerancias existentes se limitan a coordenadas y magnitudes continuas (hasta 1e-8; acciones de posición 1e-12), no a dinero. Se revisaron cambios en tests: las implementaciones previas inválidas se contrastan ahora con el original; no se encontró un relajamiento de importes para ocultar errores. Las fuentes y fixtures quedan versionados para repetir las comparaciones.

## Problemas demostrados y corregidos

1. Un ACK de guardado que llegaba después de cerrar sesión podía revivir el estado anterior. Se demostró con dos aserciones fallidas (`audit-logout-before.log`). El cierre invalida la sesión antes del await y los resultados tardíos se descartan; dos regresiones verifican cierre y cambio de cuenta. No se modificó el protocolo del servidor.
2. Faltaban los eventos Web `pagehide`, visibilidad y `online` del runtime original. El pack anterior falla la prueba de flush (`audit-lifecycle-repro.log`). Se conectaron eventos a recuperación, guardado keepalive acotado, pausa/reanudación, audio e input existentes. La prueba real de recarga encontró después una ventana de ACK perdido: el servidor avanzaba mientras el identificador de la operación seguía en una escritura local diferida. Ahora cada intento se registra antes del HTTP; el puente crea las transacciones IndexedDB inmediatamente sobre una conexión abierta y la petición espera su confirmación. El formato de guardado y el protocolo HTTP permanecen iguales. Veinte escrituras concurrentes y un borrado tras escritura verifican el orden sobre IndexedDB real. También se corrigió un acceso nulo del diagnóstico Web durante logout. El test usa HTTP e IndexedDB reales. El evento `online` se entrega explícitamente porque Playwright restablece la red sin emitirlo tras la recarga offline; eso se documenta como evento emulado, no como prueba de cambio real de red móvil.
3. El antiguo `validate_godot.py` solo analizaba texto y podía terminar con éxito sin validar GDScript. Ahora delega en el runner real. Una suite inexistente devuelve error, al igual que parser, fallo de ejecución y suite vacía.
4. Faltaba contraste completo de `DELIVER_CONTRACT`. Se añadieron 756 resultados del motor TypeScript (7 países × 18 contratos × 6 estados), comparando estado completo, eventos, mensaje e inmutabilidad de entrada. No se cambió la regla del juego.
5. El test de accesibilidad de producción solo comprobaba transitabilidad de puntos. Ahora hornea la malla real y verifica rutas y extremos, como el test original. Se eliminó un `.gd.uid` huérfano sin script.
6. El pack Web repetía 32,71 MiB de cuerpos idénticos bajo paths distintos. `scripts/godot-pack.py` conserva todos los paths y bytes, valida MD5 y SHA256 y comparte únicamente offsets de contenido idéntico. El exportador actualiza tamaño y digest del service worker. No se eliminaron texturas, modelos, animaciones ni calidad.

## Validación ejecutada

Evidencia local ignorada por Git: `.migration-validation/`. Los scripts y fixtures necesarios para repetirla sí se incluyen.

| Comprobación | Resultado y evidencia |
| --- | --- |
| Godot 4.7.2, suite completa | PASS, 93 suites / 403 métodos, `audit-godot-verified.log` |
| Contratos originales | PASS, 756 casos, `audit-contract-parity.log` |
| Rutas de producción | PASS, malla real y 5 métodos, `audit-production-routes.log` |
| Runner y fallo negativo | PASS, `audit-harness.log`, `audit-validator-negative.log` |
| TypeScript | PASS, 93 archivos / 870 pruebas, repetidas antes de publicar |
| Typecheck / lint | PASS; lint conserva un aviso previo por `FARM_BARN` sin uso |
| Build Next de producción | PASS, `audit-push-build.log`; configuración de build aislada |
| Linux release | PASS, exportación y arranque sin errores, `audit-linux-export-verified.log`, `audit-linux-smoke-verified.log` |
| WebAssembly + HTTP real | PASS en la auditoría de base, `audit-web-full.log`; recorrido/paneles/telemetría repetidos en `audit-web-final4.log`; regresión final de persistencia/WebGL/logout/tacto/API en `audit-web-verified.log` |
| Guardado y restore | PASS, disco, IndexedDB compatible, cuenta, operación idempotente, conflictos, logout y backend PostgreSQL/Next/Better Auth aislado |
| PWA/offline | PASS, caché completa por bloques, recarga sin red, progreso conservado y guardado tras reconexión |
| Paneles y tacto | Ocho paneles × tres tamaños; input CDP real emulado con DPR 2, sin teléfono físico |
| Recuperación WebGL | Dos pérdidas reales del contexto del juego, sin reload/diálogo/pérdida de estado, comparación de imagen e input posterior; prueba GPU adicional de tres pérdidas con píxeles exactos |

Los recuentos de oráculos incluyen además 1.750 acciones, 915 escenarios de progresión, 152 restores, 3.659 entradas de validación, 588 formatos monetarios, 900 listas de clientes, 42 ventas, 121 rutas, 42 simulaciones largas, 13.608 selecciones de animación, 1.536 casos de guía y 504 fotogramas de transferencia. No equivalen a cobertura exhaustiva de todos los estados posibles.

`audit-web-final4.log` registra además el conflicto de recuperación que motivó la corrección; no se presenta esa ejecución parcial como una suite completa aprobada. `audit-web-verified.log` verifica la corrección manteniendo las aserciones de revisión, estado y ausencia de errores.

El recorrido del navegador también entrega una nueva pulsación tras cruzar un puesto que exige input neutral. La primera repetición quedó detenida en la caja por mantener el mismo gesto; el controlador Godot coincide con `WorkstationController.ts`. La prueba conserva la ruta, los límites de tiempo, las colisiones y todas las aserciones, y usa únicamente mouse real para soltar/continuar.

Las pruebas GPU adicionales de esta auditoría están en `audit-gpu-gl.log`, `audit-gpu-vulkan.log` y `audit-gpu-recovery.log`: OpenGL/Vulkan sin fallos y tres restauraciones WebGL con píxeles exactos.

## Tamaño y oportunidades pendientes

Pack final: **340.745.312 bytes (324,96 MiB)**, frente a 357,67 MiB anteriores. Carpeta Web completa de debug: **379.070.653 bytes (361,51 MiB)**, incluido WASM de 36,15 MiB. No confundir tamaño del PCK con descarga total ni memoria de ejecución.

El índice conserva 1.256 entradas sin cuerpos duplicados. Antes de compartir bloques, el peso lógico era principalmente escenas (277,04 MiB), texturas importadas (70,70 MiB), audio (4,18 MiB) y JSON (3,98 MiB). No se encontraron texturas mayores de 2048: las mayores inspeccionadas son 1024². Los diez audios corresponden al original. El PCK excluye tests, herramientas y código de integración/desarrollo. La build Web utilizada para QA es debug; una publicación debe generar y validar release.

Los GLB y las escenas de distintos LOD/variantes no son binarios redundantes completos. Comparten animaciones/texturas parcialmente; separarlas es una optimización futura que requiere validación de rigs/materiales. No se borraron por similitud. La compresión HTTP de WASM/JSON/JS también puede reducir transferencia sin cambiar contenido, pero no se alteró el despliegue en esta tarea.

## Pendientes no bloqueantes para commit; obligatorios antes de certificar móvil

- Medir memoria pico, carga, FPS sostenidos, batería y temperatura en iPhone/Android físicos. La recuperación WebGL mantiene unos 233 MiB de copias CPU además de pack/WASM/GPU; puede exceder el presupuesto de navegadores móviles modestos. No hay evidencia de que todos esos equipos funcionen.
- Probar gestos simultáneos, teclado, safe areas/notch, orientación, escala, control de volumen e interruptor de silencio en hardware. La emulación de viewport/DPR no certifica estas condiciones.
- Probar GPU/shaders/vidrio/compilación inicial en Safari/Metal y GPUs móviles; la GPU Linux no las representa.
- Probar suspensión larga, bloqueo, reanudación, terminación por el SO, cuotas/evicción de IndexedDB, modo privado, almacenamiento casi lleno y redes reales cambiantes. PWA y WebView pueden tener políticas distintas; no se ha creado un contenedor WebView.
- La ruta de producción sigue usando el cliente React original. Publicar Godot Web requiere decidir y validar su despliegue bajo el backend existente; no se cambió producción.
- Compilar un IPA no configura la URL del backend: el cliente nativo conserva `MARKET_API_URL` con fallback localhost. La petición posterior limita el trabajo iOS al pipeline; no se cambió ese comportamiento. Verificar/configurar conectividad nativa será necesario para jugar conectado desde un iPhone.

## Publicación e iOS posteriores a la auditoría

El usuario autorizó posteriormente «push a main». Se publica la implementación auditada necesaria para que un checkout limpio pueda compilar, además del preset y workflow iOS; no se publican logs, builds, secretos ni infraestructura local de microtareas. El commit final usa `[skip ci]` para evitar el despliegue automático al VPS. **Build iOS** solo se ejecuta por `workflow_dispatch` y no firma ni publica la aplicación. La validación real del compilador Xcode se registra en la ejecución de GitHub Actions, no se infiere de la exportación en Linux.

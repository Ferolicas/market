# Estado comprobado de la migración Godot — 20-09-2026

La migración funcional a **Godot 4.7.2 está implementada y validada localmente**. El proyecto carga, la suite nativa pasa y los recorridos críticos funcionan en el WebAssembly exportado contra el backend original. Se conserva el TypeScript como referencia funcional y backend de cuentas/guardados. La auditoría final y la publicación posterior solicitada se documentan en [FINAL-AUDIT.md](FINAL-AUDIT.md). No se ha desplegado a producción. `migration_tasks/` no gobierna este trabajo.

## Implementación y evidencia

- Motor nativo: `game/engine.gd` y `core/engine_{actions,progression,paths,checkout,day,customers,employees,normalization}.gd`. Reemplazan las implementaciones inválidas anteriores. Acciones, economía, jornadas, IA, cajas, progresión y normalización se comparan con resultados generados ejecutando el TypeScript original, sin sustituirlo por un modelo de prueba.
- Comparaciones de fuente: 915 escenarios de progresión; 1.750 acciones y 84 avances gruesos; 42 trazas de venta, 121 rutas y casos de marcha/puertas/evitación; 42 simulaciones largas y 152 restauraciones; 900 listas de compra; 588 formatos monetarios; 3.659 entradas del esquema Zod. Los fixtures voluminosos se guardan comprimidos y los exportadores están en `scripts/export-godot-*.mjs`.
- El generador de clientes reproduce las llamadas al comparador del V8 14.6 instalado (Node 26.8.2), en lugar de sustituir el `sort` aleatorio original por Fisher–Yates. UUID aleatorios se comparan conservando su identidad y referencias; dinero y contadores se comparan exactamente.
- Guardado nativo: autoridad, eventos, validación desde el esquema Zod, identidad, snapshots, recuperación por cuenta con escritura atómica, store y cliente HTTP. Diez pruebas cubren disco real, cambios durante el guardado, conflicto, reintento y ACK perdido. `JsonExact` conserva los enteros seguros que el parser numérico de Godot redondeaba incorrectamente.
- Catálogo y navegación: datos originales completos; horneado real de NavigationServer3D, mismas escalas/parámetros Recast, rutas y liberación de recursos verificados. Los 99 modelos del registro original cargan e instancian.
- Presentación nativa: `application.gd` monta autenticación, store, audio, mundo y UI nativos. Movimiento, colisiones, zonas, rigs, clientes/empleados, inventario visible, contadores, compras y dinero de cajas se conectan al estado. No se ejecuta JavaScript de gameplay dentro de Godot.
- Arte derivado: `scripts/export-godot-scene.mjs` monta los componentes originales con React/Three únicamente como herramienta de autoría. Exporta geometría, materiales, transformaciones, rótulos y prototipos de los 13 productos. Convierte extensiones glTF incompatibles; conserva aparte los rigs de animales y utiliza sus GLB originales. No requiere base de datos ni servidor de aplicación.
- Audio existente: GameAudio, preferencias y bus semántico conectados al arranque, gestos y eventos originales; el escáner produce PCM real verificado. Sigue pendiente la comprobación perceptual en hardware móvil, incluido el interruptor físico de iOS.
- Runner: errores de carga, parser, ejecución, suites vacías y timeouts fallan realmente. Los errores negativos esperados se cotejan exactamente; no se silencian errores arbitrarios.

La evidencia vigente y las correcciones de auditoría están en [FINAL-AUDIT.md](FINAL-AUDIT.md).

## Últimas comprobaciones

Logs locales: `.migration-validation/`.

| Comprobación | Resultado |
| --- | --- |
| Suite TS de referencia | PASS: 93 archivos, 870 pruebas (20-09-2026) |
| Suite Godot completa | PASS: 93 suites, 403 métodos, cero fallos (`audit-godot-verified.log`) |
| Cinco partes de escena, rótulos y rigs externos | PASS: carga e instanciación reales |
| Integración mundo/rig/física/clientes/paneles | PASS: 25 métodos de integración de mundo; selección/guía/transferencias en suites separadas |
| `godot --headless --path godot --quit-after 3` | PASS: escena principal carga |
| Render GPU Vulkan Mobile y OpenGL | PASS: capturas, transparencia y materiales comparados con el original |
| Referencia visual Three original | Capturada con el mismo encuadre para comparación |
| Autenticación y concurrencia con backend real | PASS: Better Auth, cookie persistente, revisión, replay y conflicto HTTP real |
| Exportaciones Web y Linux | PASS: WebAssembly en Chrome y binario Linux headless; primera venta física completa verificada |

Validación anterior a la auditoría (histórica): `final-native-full.log` (400 métodos), `dpi-web-regression.log` (acceso, paneles, guardado, PWA, recuperación gráfica y logout), `touch-final.log` (tacto/DPR 2 y API real), `final-linux-smoke2.log` (binario release sin errores). La primera venta física completa consta en `current-web-full.log`; las correcciones posteriores de densidad y scroll pasan la regresión y el recorrido táctil.

## Alcance y límites de la validación

- Reglas, estados, economía, persistencia, IA y progresión se contrastan con los oráculos ejecutados sobre el TypeScript original. Las escenas y sus recursos proceden de los componentes y modelos originales; autenticación y guardados utilizan las rutas existentes.
- Verificado en Godot 4.7.2 headless, GPU Compatibility y Vulkan Mobile, Chrome real, tres tamaños de pantalla y entrada táctil con DPR 2. Se verifican carga, controles, primera venta, compra, paneles, sesión, conflictos, recuperación local, offline y pérdida/restauración WebGL.
- El paquete Web contiene todos los recursos y ocupa **324,96 MiB** después de eliminar bloques binarios idénticos sin quitar recursos. La reconstrucción WebGL mantiene copias CPU adicionales (~227–233 MiB en las últimas comprobaciones). Son costes reales que deben considerarse al distribuirlo.
- No se dispone de medición en teléfonos físicos Android/iOS: consumo, memoria, batería y el interruptor físico de audio de Apple no quedan certificados por la emulación. Las capturas de ambos motores se comparan con fases de animación independientes; no se afirma igualdad píxel a píxel en todo hardware.

## Historial de implementación

Los pendientes y fallos descritos a continuación corresponden a cada etapa; los resultados vigentes son los de la tabla y los logs finales indicados arriba.

### Integración de presentación ampliada

- Selección de animación de clientes: 13.608 casos ejecutados contra la función original de `Customer.tsx`.
- Guía de la primera venta: 1.536 casos contra `LevelOneGuide` original.
- HUD superior, navegación inferior e iconos derivados de los SVG originales.
- Bancales: etapas de crecimiento y geometría exportadas del componente React; actualización de frutos por inventario y signos de disponibilidad.
- Recorrido real de motor/store/escena cosechar → cesta → surtir comprobado en headless.
- El original se volvió a verificar: 93 archivos y 870 pruebas pasan; lint sin errores (conserva aviso original de `FARM_BARN` sin usar).
- Detectada la incompatibilidad entre máscaras de pelo por índice de Three y reordenación de índices del importador Godot. Se generan variantes sin pelo antes de importar, conservando atributos, morphs, rig y animaciones.

Persisten diferencias visuales y sistemas de presentación por integrar. Estos resultados no constituyen aceptación final 1:1.


### Integración real, exportaciones y presentación (continuación)

- `scripts/qa-godot-live-api.mjs` crea PostgreSQL 17.11 temporal en loopback, aplica las migraciones Prisma originales y levanta las rutas Next existentes; elimina sus cuentas/base al terminar. No usa endpoints simulados ni cuentas de producción. `godot/integration/` comprueba 401, signup, sesión, guardado, repetición de operación, conflicto y logout. Una nueva instancia HTTP restaura la cookie nativa persistida; la aplicación aísla los archivos de sesión por origen y limita sus permisos en Unix.
- `scripts/qa-godot-browser-recovery.mjs` cruza escritura y lectura entre RecoveryStorage TypeScript y el puente IndexedDB de Godot, incluyendo cuenta, ACK pendiente y enteros seguros. `scripts/qa-godot-web.mjs` ejecuta la exportación auténtica en Chrome (1280×720 y 390×844), completa onboarding mediante clics, guarda en el servidor, mueve con teclado y recarga manteniendo sesión/progreso.
- Comandos: `node scripts/export-godot.mjs Web`; `MARKET_QA_WEB=1 node scripts/qa-godot-live-api.mjs`; `node scripts/export-godot.mjs Linux`. Plantillas oficiales 4.7.2 verificadas por SHA512. Linux arranca headless sin errores. El pack Web sigue siendo grande (~350 MB), pendiente optimización y aceptación móvil.
- Vista previa nativa del avatar con cámara original y giro por arrastre, color de pelo utilizable; miniaturas reales (un rig por turno, cuatro fotogramas y caché de texturas) y columnas adaptadas a escritorio/móvil; revisión final pendiente. Variantes de máscara de pelo previas al importador evitan borrar triángulos de cara/ropa. Carritos rígidos originales siguen las manos, se aparcan en caja, muestran inventario restante de la transacción y animan ruedas; bolsas originales acompañan la entrega.
- Se corrigió la escala de velocidad física (faltaba `WORLD_SCALE`), se conectaron poses de trabajo/rotación y transición de cámara de caja, y se limpia el mando desconectado. El test físico de teclado verifica la velocidad original.
- `transfer_bursts.gd` mantiene vuelos independientes de cosecha/reposición/devolución/pago y `VisualTransferLedger` retrasa únicamente la presentación hasta cada aterrizaje. `scripts/export-godot-transfer-oracles.mjs` ejecuta los callbacks `useFrame` originales con grupos Three reales: 42 trazas, 504 fotogramas, posiciones/giros/escalas/visibilidad comparados. La economía no se calcula dentro del efecto.
- Se corrigieron la conversión de colores lineales y la suma de luz antes del tone mapping. El shader nativo usa el BRDF/DFG/ACES y el PMREM original, conserva los materiales mutables y las luces de estado; capturas Vulkan y Compatibility sin errores. La transmisión del vidrio y la composición de retratos se verifican en la actualización siguiente; la aceptación visual completa sigue en curso. No se han modificado tests para silenciar errores.

- PWA offline real (20-09): PASS con Chrome desconectado, recarga desde caché, recuperación IndexedDB y guardado al reconectar. El service worker exportado guarda el PCK en bloques de 8 MiB y confirma su manifiesto solo tras completar todos; evita el `Cache.put: Unexpected internal error` del paquete único de 354 MiB. El test lee y suma los bloques antes de cortar la conexión y después arranca el WebAssembly real. Usar `scripts/export-godot.mjs` para conservar esta configuración al exportar.

- Compras: celebración pasiva de 3 s y resaltado de la siguiente compra durante 9 s, gobernados por cambios de snapshot; no se repiten al cargar o viajar. Recogida del cliente estante/mano/carro, inclinación de locomoción y estabilización de cabeza conectadas a los rigs reales.
- `render/source_pbr.gd` ya forma parte del runtime y de la exportación Web validada offline. `export-godot-scene.mjs reference preview-lighting thumbnail-lighting` regenera los tres entornos originales en media precisión. `render_runtime.gd` aplica MSAA, perfiles móvil/escritorio, resolución adaptativa y período de estabilidad/gracia. GPU verificó 20 retratos nativos en el vestuario.

- El supervisor corrige el delimitador de múltiples errores negativos esperados; continúa rechazando cualquier mensaje distinto y cualquier fallo de proceso. Se conserva la sesión multimedia silenciosa de iOS Web y se leen sus capacidades reales desde navigator; falta comprobar el interruptor físico en un dispositivo Apple.

### Recorrido físico, audio, telemetría y bloqueo WebGL

- `.migration-validation/full-physical-web5.log`: PASS del recorrido mediante joystick real y navegación física (cosecha → reposición → cliente → caja → recaudación → contribución al agricultor), sin inyectar acciones ni estado. FPS: mínimo 41, percentil 10 y mediana 60. También pasan recarga autenticada, desconexión completa y guardado tras reconectar.
- Se corrigieron `AudioStreamGeneratorPlayback.can_push_buffer` y el modo STREAM del escáner. Una captura real `AudioEffectCapture` comprueba PCM no silencioso en el bus de efectos. Se igualaron los gestos de desbloqueo del original, incluido touchend en iOS Web.
- `telemetry/client_telemetry.gd` integra las transiciones de error de guardado y las ventanas de rendimiento de un minuto. En Web usa requestAnimationFrame/PerformanceObserver reales, conservando el sampler nativo, identidad y endpoint original. El backend real valida la respuesta 201. No transmite a servicios nuevos.
- `ui/safe_area.gd` consulta los insets CSS del navegador/PWA y los aplica a HUD y paneles; el vidrio móvil conserva su opacidad original sin transmisión. La transmisión de escritorio ya está implementada; véase la actualización siguiente.
- **Bloqueo de equivalencia WebGL reproducido:** `.migration-validation/context-probe.log` y `godot-context-restored.png`. Chrome entrega un evento lost y uno restored, pero Godot 4.7.2 deja la imagen negra y muestra “WebGL context lost, please reload the page”; la simulación continúa. El original reconstruye los recursos y recupera la imagen sin navegación. Se ha solicitado decidir entre aceptar la recarga automática con recuperación de partida o mantener la recuperación sin recarga investigando/modificando el motor. No se ha aplicado una recarga que oculte esta diferencia ni se declara PASS de recuperación gráfica.

- `.migration-validation/telemetry-live-web.log`: PASS adicional de primera venta física, rendimiento (p10/mediana 60 FPS), telemetría del navegador con HTTP 201, PWA offline/reconexión y suite nativa contra backend original; incluye telemetría nativa persistida. `.migration-validation/current-linux-smoke.log`: binario exportado 4.7.2 oficial inicia headless sin errores. Lint: cero errores, un aviso preexistente en el TypeScript original.

- `.migration-validation/context-regression.log`: la última exportación Web pasa setup, teclado, recarga autenticada y PWA offline/reconexión; después **FAIL real** de recuperación WebGL. Hay 1 evento perdido y 1 restaurado; los fotogramas suben de 88 a 274, pero los tres canales de la captura tienen mínimo/máximo/media/desviación cero. El runner devuelve error y limpia el backend desechable. Este fallo bloquea la aceptación 1:1.

### Recuperación sin recarga — opción 2 implementada y verificada

El usuario eligió conservar la recuperación sin recarga. El bloqueo anterior está resuelto en las pruebas locales: `godot/web/context-recovery.js` reconstruye los recursos GPU y mantiene vivo el mismo runtime WASM. La integración comprobada está en el exportador; no se cambia la versión del motor ni se introduce gameplay JavaScript.

- `.migration-validation/recovery-gpu-unit.log`: tres pérdidas reales de GPU; igualdad exacta de píxeles en recursos de prueba, buffers/texturas con offsets, fuentes de dos canales, shaders borrados tras enlazado, uniforms y framebuffer real.
- `.migration-validation/recovery-context8.log`: dos pérdidas/restauraciones **solicitadas automáticamente por el adaptador**, cero navegación/diálogos/errores, comparación de imagen casi idéntica, misma posición/partida y movimiento físico posterior. Telemetría real de ambas pérdidas/restauraciones recibe 201; guardado posterior confirmado por el backend original.
- Reconstrucción de 20.727 recursos en 145–152 ms en Chrome/RTX 4080 SUPER; los espejos CPU añaden ~126 MiB en la campaña inicial. La aceptación móvil de memoria/rendimiento sigue pendiente; no se extrapola este resultado a hardware móvil.
- `.migration-validation/recovery-native-tests.log`: 91 suites, 391 pruebas PASS. El reloj del runtime usa tiempo monotónico real como el original, manteniendo el límite de 1 s por tick tras pausas largas.
- Se corrigió una carrera del test de onboarding: un guardado confirmado podía volver a `dirty` por un tick antes de desaparecer la cortina. Ahora se exige y coteja el snapshot realmente persistido por la API; no se ocultan errores ni se congela la simulación.

Continúa la aceptación completa de presentación y rendimiento. Resolver WebGL no declara terminada la migración.


### Vidrio y composición de retratos — GPU real

- `render/glass_transmission.gd` genera el búfer opaco HDR y dos niveles de reducción con cámaras nativas. `three_transmission.gdshaderinc` reproduce el muestreo bicúbico y la mezcla de transmisión de las superficies finas existentes. Conserva opacidad, Fresnel y clearcoat; el perfil móvil mantiene la transmisión desactivada como el original. Se exportan explícitamente los parámetros de clearcoat que el importador glTF omitía.
- Compatibility usa aproximaciones de sRGB que recortan colores oscuros. `source_pbr.gd`/`three_pbr.gdshader` compensan las conversiones de entrada y salida de Godot 4.7.2 y mantienen lineal el búfer de transmisión. Los materiales Basic originales se calculan sin depender de luces. Referencia del motor inspeccionada: commit `ed1daf0bf`, `drivers/gles3/shaders/tonemap_inc.glsl` y `scene.glsl`.
- Capturas originales/nativas 1280×720: una muestra del felpudo bajo el vidrio da RGB **73,105,88 en ambos**; las muestras de pavimento y vidrio claro difieren 0–1 niveles por canal. Vulkan Mobile y Compatibility producen HDR por encima de 1 y sus tres niveles reales. Esto verifica esas muestras, no identidad de todos los píxeles/poses.
- `export-godot-scene.mjs reference preview-reference` permite leer los atlas reales de ContactShadows del mundo y del AvatarCustomizer. Ambos resultaron completamente transparentes en las capturas originales. Se conserva la elipse `GroundingShadow` existente; no se añade una sombra inventada a partir del nombre del componente.
- Las vistas y miniaturas limpian a RGBA cero y componen color premultiplicado. En Vulkan se usa RGBA16F: el búfer Mobile RGB10A2 redondeaba alpha 0,2 a 0,333. `ui/viewport_composite.gdshader` codifica el color lineal antes de componerlo en el canvas SDR. Se eliminó un posprocesado de identidad innecesario que recortaba los tonos oscuros del retrato.
- `tools/test_gpu_presentation.gd` exige GPU real y comprueba color de la sombra contra la captura React, alpha, fondo transparente y retrato generado. PASS en Compatibility (`preview-gpu-regression.log`) y Vulkan Mobile (`preview-vulkan4-regression.log`); ambos dan RGB 205,204,194 en la muestra final. Un renderer headless no puede hacer pasar esta prueba.
- `.migration-validation/color-native-tests.log`: 91 suites, 393 métodos PASS. `.migration-validation/glass-web-journey.log`: venta física, telemetría, PWA offline y dos recuperaciones sin navegación PASS con el vidrio incorporado; 21.092 recursos, ~230 MiB de espejos CPU, 196–198 ms de reconstrucción; p10/mediana 60 FPS en esta máquina. La última corrección de color se está revalidando en Web.


### Acceso, paneles y escenas avanzadas

- `game/ui/auth_screen.gd` adapta acceso, registro, solicitud y cambio de contraseña a 360×640, 390×844 y escritorio, con Enter, foco, validación original y estados de petición. Ilustración de acceso rasterizada del CSS original mediante `export-godot-scene.mjs auth-art`; no se genera arte nuevo. Las URL Web `?auth=reset&token=...` tienen prioridad sobre una sesión existente y vuelven al acceso/juego sin conservar el token en la URL.
- Se corrigió el arranque sin sesión: Better Auth devuelve HTTP 200 con JSON `null`, que debe conservar la pantalla de acceso. `auth-live-api.log`: token generado por el backend real dentro de PostgreSQL desechable, cambio desde el formulario Godot, contraseña anterior rechazada, nueva aceptada y reutilización del token rechazada. No se envían correos externos en QA; el token se obtiene de la tabla real de verificación.
- `tools/render_auth.gd`: 12 capturas GPU y comprobación de acceso al botón mediante scroll; `auth-gpu5.log`, cero desbordamientos. `test_auth_screen.gd` cubre validación y teclado. Las pruebas de navegador introducen credenciales usando eventos de teclado y ratón reales.
- Paneles con cabecera y cierre fijos, cuerpo desplazable y pie visible: inventario, pedidos, equipo, franquicias, finanzas, configuración, ayuda y avatar. Tarjetas adaptables, iconos originales y retratos reales. `panels-web-full2.log` comprobó los 24 casos con input real; `auth-web-full3.log` repite los casos con país y finanzas actualizados. Ningún panel permite mover al personaje por debajo.
- La comparación de estados originales avanzados detectó que las cajas legadas todavía bloqueadas mostraban la caja completa. Se exportó `ClosedCheckoutKit` a `assets/authored/closed-checkouts.*`; ahora alterna con caja/suelo del empleado según los mismos desbloqueos. La campaña conserva vacías sus zonas de compra. La nueva prueba comprueba ambos modos y cada desbloqueo.
- `render/world_text.gd` conserva OpenSans del original y usa campos de distancia para los rótulos 3D, evitando aliasing del atlas de texto bitmap. La UI conserva su recurso independiente.
- `tools/render_scene.gd` y el exportador de referencia admiten `MARKET_QA_REFERENCE_STATE` para cargar el mismo snapshot original y `MARKET_QA_OVERVIEW=1` para comparar todo el local. Se capturaron campaña completa y partida legada nivel 30 con clientes, inventarios y producción. Son comparaciones de presentación con fases de animación independientes, no una afirmación de igualdad de cada píxel.
- `current-native-full.log`: **92 suites, 399 métodos PASS**, cero errores. `current-ts-tests.log`: **93 archivos, 870 pruebas PASS**. `current-typecheck.log` y `current-build.log`: PASS. La exportación Linux detectó recursos de navegación sin liberar en el cierre forzado; el cierre de `application.gd` ahora libera el mapa y la región también en `_exit_tree` (`native-exit-smoke.log` limpio).


### Validación final de tacto y alta densidad

- La comprobación a DPR 2 reprodujo un fallo real de escala: canvas 780×1688, ventana CSS 390×844, pero panel de 780 unidades. `application.gd` ahora mantiene las unidades CSS para la UI y `render_runtime.gd` separa el tamaño físico del búfer del tamaño lógico. Se contrastó con [`Window::_update_viewport_size` del motor exacto](https://raw.githubusercontent.com/godotengine/godot/ed1daf0bf/scene/main/window.cpp). `touch-final.log` mide panel de 390 unidades con el mismo búfer de 780 píxeles.
- Los botones dentro de ScrollContainer dejan pasar el gesto al contenedor; al comenzar el desplazamiento, Godot cancela el clic. Esto incluye selección de país, cuerpos, peinados y color. La vista 3D mantiene su gesto de órbita y su DPR original entre 1 y 1,5. Las sombras/transparencias siguen pasando el test GPU en Compatibility y Vulkan.
- `scripts/qa-godot-touch.mjs` usa eventos táctiles reales del navegador: arrastre del formulario fuera de la superficie de órbita, confirmación, espera del calentamiento real, movimiento físico, liberación y apertura/cierre de panel. Comprueba que desplazar sobre países no cambia la selección accidentalmente. No inyecta acciones ni snapshots.
- `final-native-full.log`: **93 suites, 403 métodos PASS**. `dpi-web-regression.log`: login real, recuperación de contraseña, los 24 casos de panel, PWA offline, guardado posterior, dos recuperaciones GPU automáticas y logout PASS. `touch-final.log`: controles táctiles/DPR 2 y dos pruebas de integración contra API/PostgreSQL originales PASS. `final-linux-smoke2.log`: exportación release oficial inicia y termina sin errores.
- `current-web-full.log`: primera venta mediante navegación física completa, con FPS mínimo 31, percentil 10 y mediana 60 en este equipo. Restauraciones posteriores sin navegación, con comparación de imágenes y estado. En la regresión final se reconstruyen 20.930 recursos en 198,5–198,6 ms.
- `pnpm godot:qa:web` reúne navegador, paneles, primera venta, offline, WebGL y tacto; `pnpm godot:test` ejecuta la suite headless. Se conservan las 870 pruebas TS, typecheck y build PASS; lint conserva únicamente el aviso preexistente de `FARM_BARN`.

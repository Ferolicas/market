# Cumplimiento integral del documento 3D

Actualizado: 2026-08-29

Fuente funcional: `/home/ferney_oliveros/Descargas/KIT MARKET/INSTRUCCIONES_CODEX_SUPERMERCADO_3D.txt`. Fuentes visuales: las quince PNG del mismo directorio. Este documento registra el resultado local; no implica push, migración del VPS ni despliegue.

## Matriz de cumplimiento

| Sección | Estado | Implementación y evidencia |
|---|---|---|
| 0–3. Orden, resultado, stack y auditoría | Cumplido | Auditoría base en `docs/audits/game-current-state.md`; decisiones en `docs/DECISIONES.md`; manifiesto en `docs/art/reference_manifest.json`; GLB heredados eliminados y fuentes `.blend`/Python propias bajo `art/` y `tools/blender/`. |
| 4. Arquitectura objetivo | Cumplido | Paso fijo `GameLoop`; `InputManager`, `PlayerController`, Rapier, `InteractionDirector`, `CarrySystem`, `CustomerBrain`, `QueueManager`, `StationSystem`, motor puro y snapshot/autoridad separados por responsabilidades. |
| 5. Arrastre universal | Cumplido | `GameInputSurface` y Pointer Events capturan ratón/dedo/lápiz desde cualquier área no-UI; teclado y gamepad alternativos. E2E mueve desde cuatro cuadrantes, libera junto al borde sin deriva y verifica que un clic de UI no mueve al jugador. |
| 6. Movimiento humano | Cumplido | Diez cuerpos propios con 39 clips, mezcla, cadencia según velocidad/tamaño, giro amortiguado, cadera/torso/brazos, flexión de rodilla/tobillo y apoyo correcto delante→atrás. `check_foot_contact.py` verifica 25 frames por cuerpo; mínimo final 0,24 mm sin penetración. Tira de ocho fases en `/tmp/market-walk-filmstrip-owner-man-side.png`. |
| 7. Caras, piel, ojos y expresiones | Cumplido | Cabezas cerradas, ojos/boca/cejas modelados, 19 morph targets por cuerpo/LOD, `FacialController` y `GazeController`. 400 renders de diez cuerpos × cinco expresiones × ocho vistas en `/tmp/market-character-expression-qa-20260829-final`. |
| 8. Peinados y gorros | Cumplido | 16 peinados sólidos y 12 gorros animales GLB, sockets consistentes y ajuste para hombre/mujer/niño/niña. El gorro oculta el cabello. 896 vistas en `/tmp/market-accessory-turnarounds-20260829-final`; el catálogo sigue los animales reales de `GORROS.png`. |
| 9. Catálogo canónico | Cumplido | 61 GLB de entorno en `public/models/market/environment/` cubren edificio, 14 displays, 22 equipos y 25 activos/fases de huerta requeridos. 488 turnarounds en `/tmp/market-environment-turnarounds-20260829-final`. |
| 10–11. Interacción y carga | Cumplido | Actividades automáticas por proximidad con prioridad, histéresis, repetición y cancelación; sin `E`. Carry visible, tipo único, capacidad persistente y transferencias cosecha/máquina/estante. |
| 12. Seis clientes | Cumplido | FSM completo con listas reales, reservas, espera de stock, NavMesh Recast, avoidance, dos filas, checkout por unidad, pago idempotente, bolsa y salida. Seis identidades GLB, LOD y gestos. |
| 13–14. Producción y mobiliario funcional | Cumplido | Tomate/trigo/maíz, gallinas, vaca, molino, horno, queso y zumo con estados/timers persistentes. Puerta automática con sensor/collider, luces y etapas visuales de cinta, escáner, cajón, datáfono, bolsa, frío y máquinas. |
| 15. Progresión | Cumplido | `levels.ts` define niveles 1–30, costes, objetivos y desbloqueos; pads aceptan contribuciones parciales; tiers 1–10, expansiones, dos cajas, seis roles físicos y automatización. Cubierto por unitarias e integración. |
| 16. Economía/persistencia | Cumplido local | Dinero entero escalado por país, venta solo tras `PaymentCommit`, transición validada por servidor, revisión optimista, eventos/idempotencia, snapshot v3, migración v1/v2 y recuperación local. `qa-persistence.mjs` obtiene cero diferencias estructurales tras guardar/recargar. La migración Prisma nueva está preparada pero no aplicada al VPS por falta de autorización de despliegue. |
| 17. Cámara/feedback | Cumplido | Cámara ortográfica 15% más alejada, vendedor exactamente centrado, frustum responsive; WebAudio y feedback para cosecha, pickup, stock, scanner, pago, máquina, puerta, mejora y pasos; partículas/estados no modales. La instrucción directa posterior de mantener al vendedor siempre en el centro prevalece sobre el look-ahead/zona muerta del documento. |
| 18. Rendimiento | Cumplido | LOD0/1/2 con transferencia de fase, DPR adaptativo, perímetro instanciado, materiales compartidos de multitud, sombras selectivas y recuperación local limitada a 1 Hz. Estrés de 30 clientes + 4 empleados + todas las estaciones: 60 FPS, p95 16,8 ms, 793.320 triángulos, WebGL estable en RTX 4080 SUPER; reporte `/tmp/market-30-clients-optimized-qa-final/report.json`. |
| 19. Pruebas | Cumplido | 21 archivos/64 pruebas Vitest, typecheck, ESLint, build, `gltf-validator` de 119 GLB, turnarounds, pie/suelo, estrés, persistencia, móvil y recorrido real de 15 minutos sin tecla de acción. El móvil sostuvo mediana de 60 FPS en diez muestras y movió 1,46 m mediante touch real. |
| 20. Definición de terminado | Cumplido local | No quedan recursos GLB heredados en carga, assets obligatorios ausentes, errores glTF, fallos de consola/red ni pérdida de contexto. Proyecto y evidencias documentados. Publicación queda fuera del alcance autorizado. |

## Inventario verificable

- 99 assets canónicos: 4 dueños, 6 clientes, 16 peinados, 12 gorros y 61 elementos de entorno.
- 20 LOD adicionales para los diez cuerpos; total validado: 119 GLB.
- 39 clips y 19 morph targets en cada cuerpo y cada LOD.
- 400 renders de cuerpo/expresión, 896 de accesorios y 488 de entorno.
- Pruebas automáticas: `pnpm validate:assets`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `node scripts/qa-30-clients.mjs`, `node scripts/qa-mobile-performance.mjs`, `node scripts/qa-persistence.mjs` y `node scripts/qa-full-game.mjs`.

## Evidencia del recorrido integral

El ensayo verde de 15:02 minutos llegó a nivel 6 mediante cosecha, reposición, caja, construcción, trigo y molino reales; atendió cuatro clientes. Midió 60 FPS, p95 16,8 ms, deriva tras soltar de 0,0125 m, deriva al usar UI de 0,00042 m y movimiento táctil de 1,32 m. Guardado y recarga conservaron revisión 44→44 con cero diferencias estructurales. No registró errores de consola, página o HTTP y mantuvo WebGL activo. Reporte: `/tmp/market-full-game-15m-20260829-green/report.json`.

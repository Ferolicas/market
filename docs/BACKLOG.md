# Backlog maestro de Mini Market

Actualizado: 2026-08-29 · Fuente: `INSTRUCCIONES_CODEX_SUPERMERCADO_3D.txt`

## P0 — bloquea la definición de terminado

- [x] Paso fijo de simulación a 60 Hz y separación lógica/render.
- [x] Input universal por Pointer Events desde cualquier punto vacío; teclado y gamepad alternativos.
- [x] Control cinemático Rapier, suelo, colisiones y sensores compartidos.
- [x] InteractionDirector automático, histéresis, prioridades, cadencias y cancelación al salir.
- [x] CarryContainer visible con capacidad, tipo único y transferencias coherentes.
- [x] Bucle integrado tomate → carga → estante → cliente → fila → caja → dinero.
- [x] CustomerBrain para seis identidades, listas reales, stock real, NavMesh, reservas y avoidance.
- [x] QueueManager y checkout idempotente con artículos reales y reanudación.
- [x] Cultivos, gallinas, vacas, molino, horno, quesera y zumos con timers persistentes.
- [x] Puertas, luces, refrigeración, cinta, escáner, cajón y datáfono con estados funcionales.
- [x] Progresión de niveles 1–30, pads parciales, tiers, expansiones y empleados físicos.
- [x] Snapshot versionado completo, migración desde v2, eventos idempotentes y recuperación sin duplicados.
- [x] Arte del kit integrado: 4 dueños, 6 clientes, 16 peinados, 12 gorros y catálogo de mobiliario/huerta.
- [x] Locomoción final con mezcla, carga, giros, contactos de pie y validación de suelo.
- [x] Audio/VFX/feedback no modal, accesibilidad y perfil adaptativo móvil.
- [x] Unitarias, integración, QA 3D, E2E real, persistencia, móvil y estrés de 30 clientes.

## P1 — cierre de lanzamiento local

- [x] Presupuestos de rendimiento, LOD, instancing, pooling y liberación de assets medidos.
- [x] Overlay debug de colliders, sensores, NavMesh, rutas, sockets, fila y métricas.
- [x] Matriz de cumplimiento final con evidencia por requisito.
- [x] Actualización final de `PROJECT-MAP`, diseño, auditoría y manifiesto de referencias.

## Fuera del alcance autorizado en esta sesión

- Push, despliegue en `market.olcas.app` o cambios de infraestructura de producción.
- Pagos Stripe, analítica, CRM o monetización: el producto se define como simulador privado sin pagos.

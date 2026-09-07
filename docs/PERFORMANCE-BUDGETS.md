# Presupuestos de rendimiento Unity

Fecha: 2026-09-07. Estos límites parten de mediciones WebGL reproducibles. Los
objetivos Android/iOS son provisionales hasta medir hardware físico.

| Métrica | Escritorio WebGL | WebGL móvil emulado | Gate |
|---|---:|---:|---:|
| `MINIMARKET_READY` | 7.619 ms | 15.934 ms con CPU 4x | ≤8.400 / ≤17.600 ms |
| FPS sostenido | 60 | 30 | ≥58 / ≥29 |
| p95 frame | 16,67 ms | ≤33,4 ms esperado | ≤20 / ≤40 ms |
| Spike tras `READY` al primer movimiento | ninguno de 3–4 s | ningún frame de página >100 ms | 0 frames >100 ms |
| Memoria allocated observada | 457,8 MB | 254,1 MB | no crecer >15 % en escenario equivalente |
| Triángulos visibles habituales | 258.146 | 47.050 | ≤500.000 / ≤300.000 |
| Build WebGL | 194.180.011 bytes | igual | ≤210 MB sin ADR |
| Asset individual | máximo observado 11,87 MB | igual | warning >15 MB |

`PerformanceGovernor` usa `Low`, `Mid` y `High`. WebGL móvil parte de `Mid`
porque el navegador no expone RAM/GPU fiables. Android/iOS clasifican por RAM y
CPU; todos los móviles priorizan 30 FPS estables y bajan resolución con dos
muestras lentas consecutivas. Para subirla exigen tres muestras rápidas.

Los perfiles cambian resolución, distancia de sombra, presupuesto de LOD y
cadencia de IA. No cambian dinero, inventario, producción, pedidos ni reglas de
simulación. `MINIMARKET_PERF` informa tier, FPS, p95/p99, spikes >100 ms,
resolución, renderers, materiales, triángulos y memoria.

Un cambio de rendimiento falla si cruza un gate o si degrada visiblemente la
escena. Batería, temperatura, ANR, PSS y memoria nativa requieren sesiones de
15/30/60 minutos en la matriz física descrita en `STORE-READINESS.md`.

## Verificación posterior al hardening

Build `20260907-045817`: escritorio 60 FPS, p95/p99 16,67 ms, cero frames
>50 ms, 258.146 triángulos, managed 16,5 MB y allocated 461,3 MB. Móvil
emulado CPU 4×: READY 15.149 ms, governor 30 FPS, p95/p99 34 ms, cero spikes
>100 ms, 47.050 triángulos, managed 10,8 MB y allocated 254,3 MB. Todos los
gates pasan.

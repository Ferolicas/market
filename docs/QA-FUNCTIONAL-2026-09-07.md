# QA funcional Unity — 2026-09-07

Artefacto: build `20260907-045817`, 194.209.926 bytes, Unity 6000.3.23f1,
commit incrustado `947d64a5f515cddfdba80c2b920aa52206cb2615`, catálogo
`31fbdb82758aa7a5`, save schema 1.

## Resultado

| Recorrido | Resultado | Evidencia |
|---|---|---|
| EditMode | PASS | 37/37, 0 fallos, 0 omitidas, 2,17 s |
| PlayMode | PASS | 2/2, giro inmediato y governor, 0,20 s |
| Next/API | PASS | typecheck, lint, 48 archivos/310 tests y build |
| Validator Unity | PASS | catálogo/settings/mobile/save schema; 0 warnings |
| Primer movimiento escritorio | PASS | 195 frames tras READY; máximo 16,7 ms; 0 >100 ms; 0 assets tardíos |
| Primer movimiento móvil CPU 4× | PASS | 193 frames; máximo 50 ms; 0 >100 ms; 0 assets tardíos |
| Giro | PASS | yaw error 0,02°; dot de trayectoria 1,000 en escritorio y móvil |
| Carga sostenida | PASS | 30 s, tienda abierta, empleados/clientes: 60 FPS; p95/p99 16,67 ms; 0 >50 ms |
| Checkout completo | PASS | cliente entra, compra, espera, descarga, escanea, embolsa, paga y actualiza balance |
| API anónima | PASS | health 200; save 401; ledger 401 |
| Producción actual | PASS | release `20260907-production-hardening-v2`; 174 hashes; Caddy puede leer los binarios; runtime READY |
| Primer movimiento en producción | PASS | escritorio: 198 frames, máximo 16,7 ms; móvil CPU 4×: 201 frames, máximo 50 ms; 0 >100 ms |
| Giro en producción | PASS | error 0,02° y dot de trayectoria 1,000 en escritorio y móvil CPU 4× |
| Carga API controlada | PASS limitado | config local: 16.959 requests/5 s, 3.391,8 RPS, 0 errores, p95 4,98 ms; no equivale a 10.000 sesiones completas |

## Métricas comparadas

| Métrica | Antes | Después | Cambio |
|---|---:|---:|---:|
| Ready móvil CPU 4× | 15.934 ms | 15.149 ms | −4,9 % |
| Memoria móvil allocated | 254,1 MB | 254,3 MB | +0,08 % |
| Memoria móvil managed | 11,5 MB | 10,8 MB | −6,1 % |
| Escritorio allocated | 457,8 MB | 461,3 MB | +0,8 % |
| Build WebGL | 194.180.011 B | 194.209.926 B | +0,015 % |
| p95 escritorio | 16,67 ms | 16,67 ms | igual |

No se observó pérdida de frames después de READY, carga de assets tardía,
request fallida, page error ni advertencia de política de audio. El runner de
checkout sin GPU informa FPS artificialmente bajo y mensajes internos de shader
conocidos; se excluye de performance. El escenario Vulkan dedicado es el que
produce las métricas de frame pacing anteriores.

El primer despliegue preservó el modo `600` que Unity asignó a los tres binarios
Brotli. Caddy no podía leerlos y el fallback devolvía `index.html` con
`Content-Encoding: br`, lo que producía `ERR_CONTENT_DECODING_FAILED`. El release
final se publicó con `MigrationTools/deploy-web.sh`, que fuerza permisos
legibles, verifica cada hash y comprueba el acceso como el usuario `caddy` antes
de activar el enlace. El arranque público pasó después de esa corrección.

## Pendientes que requieren entorno externo

- Dispositivo Android físico y iPhone para pausa/kill/restore, batería, thermal,
  PSS, 60 min soak y 16 KB pages.
- Cuenta QA autenticada en staging para pérdida/reconexión de red y load test de
  GET/PUT save.
- Publicar el endpoint ya implementado `/api/game/config` junto al próximo
  release limpio del backend. El Unity publicado recibe hoy 404, conserva el
  cache/default seguro y sigue arrancando; los flags remotos aún no se pueden
  cambiar desde producción.
- Export iOS con SDK 26 en Mac y AAB firmado con target API 36 confirmado.
- Simulacro de restore de PostgreSQL aislado.

# Unity production readiness report

Fecha: 2026-09-07. Estado después de aplicar las fases seguras y comprobables
del plan maestro.

| Área | Estado | Evidencia y límite |
|---|---|---|
| Architecture | GREEN | Runtime separado por sistemas; reglas económicas puras; backend autoritativo; ADRs de save, contenido y auth |
| Persistence | GREEN | store nativo atómico current/previous/temp, checksum, schema, legacy, conflictos y lifecycle; 8 tests de fallo |
| Performance | GREEN para WebGL | local y producción: primer movimiento sin frames >100 ms; 60 FPS escritorio y 30 FPS móvil emulado; tiers e histéresis |
| Battery | RED | imposible validarla sin teléfonos físicos y sesiones de 15/30/60 min |
| Memory | YELLOW | móvil 254,3 MB y escritorio 461,3 MB sin regresión; falta soak 60–120 min y PSS native |
| Networking | YELLOW | timeout, cancelación, clasificación, GET backoff y PUT seguro; falta auth native/reconnect físico |
| Security | GREEN en el alcance revisado | auditoría local y productiva sin vulnerabilidades; HSTS/CSP/anti-frame activos; límites distribuidos de save/ledger verificados con 429 |
| Backend | GREEN funcional | health/DB, auth por usuario, 600 KB, Zod, transacción, revisión optimista e idempotencia verificados |
| Scalability | YELLOW | cliente local y backend stateless/horizontalizable; config local sostuvo 3.391,8 RPS con 0 errores, pero faltan save autenticado, DB y staging para dimensionar 10.000 sesiones |
| Observability | YELLOW | logs categorizados, build identity, p95/p99/memoria y hook telemetry; falta proveedor de crash/ANR y dashboard |
| Testing | YELLOW | 311 web + 37 EditMode + 2 PlayMode + navegador real; falta matriz física/soak/offline native |
| CI/CD | YELLOW | workflow manual GameCI y builders preparados; requiere secrets/licencia y una ejecución remota |
| Store readiness | RED | faltan firma, iconos, metadata, privacy manifest, data safety, dispositivos y SDK iOS 26 |
| IAP readiness | YELLOW | no existe monetización solicitada; backend ya aporta patrones de ledger/idempotencia, pero no StoreKit/Play Billing |
| Addressables | YELLOW | paquete instalado y estrategia decidida; catálogo actual validado; piloto remoto no justificado todavía |
| Recovery | GREEN para restaurabilidad | recuperación local probada, release WebGL inmutable con 174 hashes y dump Market restaurado y comparado en una base aislada; falta medir el RTO en un simulacro completo |

## Listo

- Guardado local robusto, compatible con WebGL y partidas anteriores.
- Pausa, pérdida de foco y cierre fuerzan persistencia.
- Arranque y primer movimiento medidos sin congelación.
- Giro inmediato medido en escritorio y móvil emulado.
- Perfiles de dispositivo, histéresis, LOD/IA coordinados y menos trabajo por frame.
- Checkout, economía, inventario, empleados, clientes y progresión sin regresión.
- Red tolera fallos recuperables sin reintentar mutaciones a ciegas.
- Builds trazables y validador que falla antes de empaquetar assets/settings rotos.
- Remote config cache-first con defaults seguros y kill switches apagados.
- WebGL, AAB e iOS exportables desde métodos de build y CI manual.
- Release WebGL `20260907-security-hardening-final` publicado y comprobado desde
  el dominio real; el arranque, el primer paso y el giro pasan en escritorio y
  móvil emulado. Su identidad corresponde al commit limpio `246d850`.
- Configuración remota publicada con defaults seguros; auditoría de dependencias
  limpia, cabeceras de seguridad activas y límites de API compartidos probados.

## Falta antes de beta móvil

- Auth móvil con navegador del sistema, deep link y almacenamiento Keychain/
  Keystore; después probar cloud save entre dos dispositivos.
- Dispositivos físicos, soak, batería, thermal, ANR/crash y page size 16 KB.
- Firma y toolchains de tienda, privacidad, borrado de cuenta si se ofrece alta,
  iconos, splash, capturas, clasificación por edad y cuenta review.
- Ejecutar Unity CI remota con licencia; el build local de Unity y el restore
  PostgreSQL aislado ya pasaron.

## Solo con tráfico o necesidad real

- Redis para config cache u otros datos efímeros si las métricas lo justifican;
  el rate limit actual ya es distribuido mediante un upsert atómico PostgreSQL.
- Cola para emails/analytics y tareas que bloqueen requests.
- CDN/Addressables para contenido estacional descargable.
- Read replicas, particionado o servicios separados después de medir DB/RPS.

## No conviene implementar todavía

- Kubernetes, Kafka, microservicios o backend Go sin un cuello medido.
- Merge automático de saves complejos.
- Cifrado local presentado como anticheat.
- IAP antes de definir catálogo, entitlements y restore UX.
- Migración masiva a Addressables sin piloto, fallback y rollback.

Las pruebas y comandos reproducibles están en `UNITY-HARDENING-BASELINE.md`,
`QA-FUNCTIONAL-2026-09-07.md`, `PERFORMANCE-BUDGETS.md`,
`RECOVERY-RUNBOOK.md`, `STORE-READINESS.md` y `UNITY-CI.md`.

# Auditoría de seguridad — 2026-09-07

Alcance: repositorio Market, dependencias, autenticación, save/ledger,
cabeceras públicas, PM2/Caddy/firewall, límites de API y recuperación. La fase
inicial fue de solo lectura; el propietario aprobó después la corrección de los
siete hallazgos. Esta revisión no incluyó ataques destructivos, pagos ni una
prueba de carga de 10.000 sesiones.

## Resultado final

| ID | Riesgo inicial | Corrección y evidencia | Estado |
|---|---|---|---|
| SEC-01 | Alto upstream, exposición efectiva media/baja | `sharp` quedó en 0.35.3; smoke test de transformación y suite completa correctos. | Corregido |
| SEC-02 | Alto upstream, exposición efectiva baja | `deepmerge-ts` quedó en 8.0.2; Prisma valida, genera cliente y compila. | Corregido |
| SEC-03 | Alto/moderado upstream, no alcanzable con PostgreSQL | `mysql2` transitivo quedó en 3.24.3. | Corregido |
| SEC-04 | Medio | Caddy entrega HSTS por un año, CSP compatible con WebAssembly, `X-Frame-Options: DENY`, nosniff, referrer, permissions, COOP y COEP. WebGL arrancó bajo estas cabeceras sin fallos de CSP. | Corregido |
| SEC-05 | Medio a escala | Save y ledger consumen contadores atómicos compartidos en PostgreSQL por usuario y alcance: save GET 120/min, save PUT 30/min y ledger GET 60/min. En producción, las primeras 30 mutaciones llegaron a validación y la 31 devolvió 429, `RATE_LIMITED` y `Retry-After: 59`. | Corregido |
| SEC-06 | Bajo/defensa en profundidad | Next escucha únicamente en `127.0.0.1:4010`; PM2 quedó online y Caddy conserva el acceso público. | Corregido |
| SEC-07 | Operativo | Se restauró un dump dedicado de Market en una base temporal, se compararon exactamente las ocho tablas y se eliminó la base de ensayo. También se corrigieron los permisos mínimos de `star_backup`; el servicio terminó con éxito y su temporizador está activo. | Corregido |

## Verificación

- `pnpm audit --json` local: 0 vulnerabilidades en 876 dependencias.
- `pnpm audit --prod` en producción: ninguna vulnerabilidad conocida.
- TypeScript, ESLint, 49 archivos/311 pruebas y build Next: PASS.
- Prisma: cuatro migraciones aplicadas y esquema de producción al día.
- `/api/health` y `/api/game/config`: 200; save y ledger anónimos: 401.
- QA autenticado temporal: alta 200, creación de save 201, ledger 200 y límite
  PUT 429 en la solicitud 31. La cuenta y sus tres buckets se eliminaron al
  terminar; producción confirmó cero cuentas QA y cero buckets recientes.
- Caddy: configuración válida; HTTP redirige a HTTPS; UFW no publica 4010.
- Navegador real: `instanceReady=true`, `runtimeReady=true`, 125 respuestas de
  recursos, sin `pageerror`, `requestfailed` ni respuestas inesperadas.
- Release Unity `20260907-security-hardening-final`: 174 archivos, manifiesto
  SHA-256 íntegro, build `202609070852`, commit `246d850`.

## Recuperación comprobada

El dump dedicado es
`/var/backups/market/market_db-20260907-security-hardening.dump`, tiene 408.004
bytes y SHA-256
`d2e43fc05fe513f0e8158f69832944a6d671703520f2ef004111ab92083f33be`.
`pg_restore --list` lo aceptó, la restauración aislada conservó los conteos de
las ocho tablas públicas y la base temporal fue retirada. Esto comprueba que el
artefacto puede restaurarse; el RTO de cuatro horas continúa siendo un objetivo
operativo hasta cronometrar un incidente o simulacro completo de servicio.

## Riesgo residual fuera del alcance

La aplicación conserva controles de autoridad, tamaño de payload, Zod,
transacciones, revisión optimista e idempotencia. Dimensionar 10.000 sesiones
simultáneas todavía exige una prueba de carga autenticada sobre un entorno de
staging y capacidad observada de base de datos; este informe no convierte una
prueba funcional en una garantía de capacidad.

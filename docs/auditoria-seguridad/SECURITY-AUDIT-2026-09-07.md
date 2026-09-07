# Auditoría de seguridad — 2026-09-07

Alcance de solo lectura: repositorio Market, dependencias, auth, save/ledger,
headers públicos, PM2/Caddy/firewall y presencia de backups. No se ejecutaron
ataques, carga ni pagos.

## Hallazgos

| ID | Riesgo | Hallazgo | Estado |
|---|---|---|---|
| SEC-01 | Alto upstream, exposición efectiva media/baja | `pnpm audit` informa `sharp 0.34.5` vulnerable; se usa directamente para herramientas y llega por glTF Transform. Fix upstream ≥0.35.0. | Pendiente de actualización y regresión de imágenes/arte |
| SEC-02 | Alto upstream, exposición efectiva baja | `deepmerge-ts 7.1.5` llega por Prisma config; el vector descrito requiere un grafo recursivo y no se expone como entrada de usuario en la API revisada. Fix upstream ≥8.0.0. | Pendiente de compatibilidad Prisma |
| SEC-03 | Alto/moderado upstream, no alcanzable en el stack observado | `mysql2 3.15.3` llega transitivamente por Prisma/Better Auth; producción usa PostgreSQL y no conecta MySQL. | Pendiente de actualización transitiva |
| SEC-04 | Medio | La respuesta pública carece de HSTS y de política anti-frame/CSP. Ya tiene nosniff, referrer, permissions y aislamiento COOP/COEP. | Pendiente de hardening Caddy/Next y prueba WebGL |
| SEC-05 | Medio a escala | Better Auth limita 60/min, pero save/ledger no tienen límite distribuido propio. Auth, payload 600 KB, Zod, transacción, revisión optimista e idempotencia sí están presentes. | Añadir rate limiting compartido cuando haya tráfico/autorización |
| SEC-06 | Bajo/defensa en profundidad | Node escucha `*:4010`; UFW no abre 4010 y solo Caddy lo alcanza públicamente. Conviene enlazar loopback para reducir exposición lateral. | Pendiente de cambio de proceso y smoke test |
| SEC-07 | Operativo | Dump global diario válido incluye `market_db`; no hay simulacro de restore medido. `star-backup` falla por permisos en otra aplicación del holding. | Runbook creado; restore pendiente |

## Controles que pasaron

- No hay llaves privadas, tokens live ni credenciales conocidas versionadas;
  solo `.env.example`.
- `/api/game/save` y `/api/game/ledger` responden 401 sin sesión.
- Save valida tamaño antes y después de leer, JSON, esquema, transición de
  economía, revisión e IDs ya procesados; actualiza en transacción.
- Ledger y save se filtran por el usuario resuelto desde Better Auth.
- El cliente no contiene credenciales DB/admin ni claves de tiendas.
- Caddy valida; HTTP redirige a HTTPS; UFW está activo y no permite 4010.
- Health devuelve 200 y confirma DB sin exponer credenciales.

## Dependencias

`pnpm audit --json`: 0 críticas, 3 altas, 1 moderada, 0 bajas. Corregir SEC-01 a
SEC-03 requiere modificar lockfile y ejecutar toda la suite, build, validadores
de assets y QA visual. No se aplicó durante la fase de solo lectura.


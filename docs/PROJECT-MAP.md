# Project Map — Mini Market

Última actualización: 2026-08-26

## Arquitectura

- `src/app/`: interfaz Next.js, PWA y Route Handlers.
- `src/components/auth/`: registro, login y recuperación.
- `src/components/game/`: escena 3D, avatar, controles, HUD, paneles y autosave.
- `src/game/catalog.ts`: países, monedas, productos, proveedores, puestos, sombreros y franquicias.
- `src/game/engine.ts`: acciones puras, automatización, producción, ventas, cierre e impuestos.
- `src/game/store.ts`: Zustand, recuperación local, autosave y conflictos.
- `src/lib/auth.ts`: Better Auth + Prisma + Resend desde `no-reply@olcas.app`.
- `prisma/schema.prisma`: cuentas, sesiones, perfiles, partidas y libro contable.

## Rutas y API

- `/`: acceso o juego 3D. `/reset-password`: cambio por token. `/manifest.webmanifest` y `/sw.js`: PWA.
- `GET|POST /api/auth/[...all]`: Better Auth.
- `GET|PUT /api/game/save`: crea/carga y guarda con revisión optimista; 409 si otra sesión ganó.
- `GET /api/game/ledger`: últimos 100 movimientos autenticados.
- `GET /api/health`: salud pública de aplicación y PostgreSQL.

## Datos y flujos

- `User`, `Session`, `Account`, `Verification`: auth; `Account.issuer + accountId` es único en Better Auth 1.7.
- `PlayerProfile`: país, moneda y avatar. `GameSave`: JSONB, revisión y SHA-256. `LedgerEntry`: movimientos en unidades menores.
- Flujo manual: cosecha → molino → horno → estantería → caja.
- Empleados: granjero, operario, reponedor, cajero, constructor y gerente automatizan las mismas tareas.
- Pedidos tienen tiempo de entrega; cierre diario liquida nómina, operación, licencias e impuesto sobre beneficio positivo.
- Seis franquicias hasta nivel 32, viaje instantáneo y caja global.
- Autosave cada 10 segundos, copia local offline y resolución segura de conflictos.

## Infraestructura

- `Ferolicas/market`, `/var/www/market`, PM2 `market`, puerto `4010`, DB `market_db`.
- `https://market.olcas.app`, Caddy/SSL automático. Secretos solo en `.env` local/VPS.
- Push a `main`: typecheck, lint, tests, build y despliegue SSH con migraciones.

## Límites de esta versión

- Individual, sin pagos reales ni tiendas. Fiscalidad educativa simplificada, no asesoría.
- Arte 3D procedural low-poly optimizado; puede sustituirse por GLB sin cambiar el motor.
- Multijugador, compras y builds nativos quedan desacoplados para fases posteriores.

# Mini Market

Simulador empresarial 3D en tercera persona para navegador, Linux, iPhone y Android. La PWA combina trabajo manual, producción, proveedores, empleados autónomos, contabilidad por país y crecimiento mediante franquicias con una caja global.

## Desarrollo

```bash
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm dev
```

Comprobación completa:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Controles

- PC: WASD o flechas; E o espacio para interactuar.
- Mando: stick izquierdo y botón A.
- Móvil: joystick izquierdo, botón Acción y paneles táctiles.
- Las acciones de mundo funcionan por proximidad. Los clics se reservan para pedidos, inventario, mobiliario y gestión.

## Persistencia

Better Auth gestiona correo, contraseña, username y sesiones. Cada cuenta tiene una partida versionada en PostgreSQL, libro contable, checksum, autosave, copia local de recuperación y detección de conflictos entre dispositivos.

Consulta [docs/PROJECT-MAP.md](docs/PROJECT-MAP.md) para el mapa técnico.

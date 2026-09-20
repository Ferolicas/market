# Mini Market en Godot 4.7.2

Cliente nativo del juego implementado y validado localmente dentro del repositorio original. Las comprobaciones y límites de la validación están en [GODOT-STATUS](../docs/migration/GODOT-STATUS.md).

## Ejecutar

Se necesita Godot **4.7.2** y el backend original de Next/Better Auth/Prisma. El backend conserva la autoridad de cuentas, guardados y revisiones. No se necesita ejecutar el frontend React para jugar en Godot.

Desde la raíz del repositorio:

```sh
godot --headless --path godot --editor --import --quit
MARKET_API_URL=http://127.0.0.1:4010 pnpm godot:run
```

El backend se inicia con el procedimiento de desarrollo del repositorio (incluido el túnel PostgreSQL antes de `pnpm dev`). También puede configurarse un backend compatible mediante `MARKET_API_URL`. La exportación Web utiliza su propio origen y requiere servir las rutas `/api/` originales bajo ese origen.

## Comprobar y exportar

```sh
pnpm godot:test
pnpm godot:export:web
pnpm godot:export:linux
```

Las exportaciones quedan en `.migration-validation/web/` y `.migration-validation/linux/`. Instala las plantillas oficiales **4.7.2**. Añade `--release` al comando `node scripts/export-godot.mjs Web` o `Linux` para una exportación de publicación. La exportación Web debe pasar por este script: instala el service worker que permite guardar el pack en caché por bloques y arrancar offline.

`pnpm godot:qa:api` ejecuta autenticación, guardado y conflictos contra PostgreSQL/Next reales desechables. Requiere `MARKET_QA_PG_INSTALL` apuntando a una instalación PostgreSQL 17 (o el registro local `.migration-validation/postgres-root`). `pnpm godot:qa:web` añade navegador real, acceso y cierre de sesión, ocho paneles en tres tamaños, recorrido físico de la primera venta, desconexión/recarga/reconexión, dos recuperaciones WebGL sin recarga y entrada táctil de alta densidad. Usa Chrome local con `CHROME_BIN` si la ruta del equipo es distinta. Las cuentas y bases de datos se crean únicamente dentro de ese backend aislado.

Para verificar la recuperación WebGL sin recarga:

```sh
MARKET_QA_WEB=1 MARKET_QA_CONTEXT=1 node scripts/qa-godot-live-api.mjs
```

Esta comprobación fuerza dos pérdidas reales, exige que vuelvan la imagen y el input, y rechaza navegación o pérdida de estado. El exportador integra la reconstrucción de recursos documentada en [web/README.md](web/README.md).

## Arte y arquitectura

`game/` contiene reglas, persistencia y presentación nativas. [ARCHITECTURE.md](ARCHITECTURE.md) documenta sus límites y coordenadas. El TypeScript original permanece como referencia y para el backend; los oráculos ejecutan sus funciones reales.

`node scripts/export-godot-scene.mjs` regenera la geometría de todas las partes desde los componentes originales. `node scripts/export-godot-scene.mjs reference preview-lighting thumbnail-lighting` captura los entornos originales y su DFG. React/Three se utilizan únicamente durante esta autoría, no como motor dentro de Godot.

El acceso Web incluye recuperación de contraseña nativa (`?auth=reset&token=…`) usando Better Auth. Las comprobaciones de API utilizan tokens reales de su base desechable y verifican su consumo; no requieren enviar correo. `MARKET_QA_PANELS=1` añade los ocho paneles de gestión en tres resoluciones a la suite Web.

# Runbook de recuperación

## Partida local

Android/iOS guardan bajo `Application.persistentDataPath/MiniMarket`:

1. `save-current.json`;
2. `save-previous.json`;
3. `save.tmp` si el proceso terminó después de forzar el archivo y antes del
   rename;
4. `conflicts/save-conflict-*.json` para soporte.

La carga elige la primera copia cuyo esquema y checksum sean válidos. No editar
el archivo original de un usuario. Copiar primero toda la carpeta, registrar
build, save schema, estado de sync y timestamps, y reproducir la validación en
una copia. Si current falla y previous abre, el siguiente flush vuelve a crear
current sin borrar la evidencia de conflicto.

WebGL conserva `mini-market-unity-recovery-v1` y
`mini-market-unity-recovery-previous-v1` en PlayerPrefs/IndexedDB. Limpiar datos
del sitio elimina ambas; soporte debe revisar cloud save antes de recomendarlo.

## Conflicto cloud

Un 409 no se fusiona automáticamente. El cliente marca `conflict`, conserva el
estado y eventos locales en un backup y no acredita otra vez los eventos. Para
resolver: identificar usuario, slot, revisión de servidor, revisión local,
sessionId e IDs de evento; verificar ledger; elegir explícitamente la copia que
se conserva; volver a sincronizar con la revisión vigente.

## Backend y base de datos

- Producción: PM2 `market`, puerto interno 4010, health
  `https://market.olcas.app/api/health`.
- PostgreSQL: `market_db`.
- El dump global diario comprobado el 2026-09-07 contiene `market_db`.
- RPO actual documentado: hasta 24 horas. RTO objetivo provisional: 4 horas.

Antes de restaurar producción, restaurar el dump en una base aislada, comprobar
conteos y relaciones de User, GameSave y LedgerEntry, ejecutar health/API con
una cuenta QA y documentar el checksum del backup. El restore real requiere
ventana de mantenimiento y autorización explícita. Aún falta un simulacro de
restore medido, por lo que RTO permanece sin verificar.

El servicio cifrado `star-backup` observado como fallido pertenece a otra app
del holding. No invalida el dump global que contiene Market, pero debe corregirse
en su propio alcance de infraestructura.


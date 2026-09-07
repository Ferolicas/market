# ADR 0001: guardado local nativo atómico

Estado: aceptado · 2026-09-07

## Contexto

El cliente WebGL conservaba una única cadena JSON en PlayerPrefs. Ese mecanismo
es compatible con navegador, pero no ofrece una recuperación explícita ante un
archivo truncado durante suspensión o cierre forzado en Android/iOS.

## Decisión

`SaveCoordinator` depende de `ILocalSaveStore`. Editor y WebGL usan
`PlayerPrefsLocalSaveStore` con la clave histórica y una copia anterior. Los
players nativos usan `NativeAtomicFileSaveStore` dentro de
`Application.persistentDataPath/MiniMarket`.

Cada sobre contiene esquema, build, revisión local, revisión remota, eventos
pendientes, fecha UTC, estado y SHA-256 canónico. El flujo nativo escribe y
fuerza `save.tmp`, lo valida y después sustituye `save-current.json`, guardando
`save-previous.json`. La carga prueba current, previous y temp, en ese orden.
Los conflictos remotos crean artefactos separados bajo `conflicts/`.

El sobre antiguo sin esquema/checksum se acepta una vez y se reescribe al
formato actual. Un esquema futuro desconocido no se interpreta por conjetura.

## Alternativas

- SQLite: añade una dependencia y una migración sin beneficio para un snapshot
  de unos 17 KB.
- PlayerPrefs también en nativo: conserva el riesgo de copia única opaca.
- Cifrar el save como anticheat: no protege secretos en un cliente controlado
  por el usuario. El servidor sigue siendo autoridad para valor comercial.

## Consecuencias

El cierre, pérdida de foco y pausa fuerzan persistencia local. Puede perderse
como máximo el intervalo local de diez segundos ante una terminación abrupta;
los eventos críticos que ya llaman a guardado forzado se conservan antes. Los
tests cubren truncado, checksum inválido, ausencia, ambas copias corruptas,
interrupción en temp, eventos pendientes, conflicto y formato legacy.


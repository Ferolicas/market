# Unity hardening baseline

Fecha: 2026-09-07  
Proyecto: `Unity/MiniMarketUnity`  
Unity: `6000.3.23f1` (`09d2ecc7fb28`)  
Objetivo medido: WebGL; objetivos configurados: WebGL, Android e iOS

Este documento fija el estado funcional y de rendimiento anterior al refuerzo
de producción descrito en `CODEX_MASTER_PLAN_MINI_MARKET_UNITY.md`. Las cifras
se usan como puerta de regresión; no demuestran por sí solas el rendimiento de
un teléfono físico.

## Configuración comprobada

- URP `17.3.0`, Input System `1.14.2`, AI Navigation `2.0.9`, Addressables
  `2.7.6`, glTFast `6.18.0` y Newtonsoft JSON `3.2.1`.
- Identificadores: `app.olcas.market` en Android/iOS y
  `app.olcas.market.web` en WebGL.
- Android: ARM64, mínimo API 26, target automático e IL2CPP.
- iOS: mínimo 15.0 e IL2CPP.
- WebGL: IL2CPP, stripping e incremental GC.
- El paquete Addressables está instalado, pero no existe todavía un catálogo de
  contenido Addressables del juego. Los GLB se cargan desde StreamingAssets.
- Estado inicial serializado: 16.970 bytes, 23 claves raíz y 6 franquicias.
- Arte GLB fuente: 199 archivos y 292.450.236 bytes.
- Build WebGL desplegado: 194.180.011 bytes.

## Pruebas base

### Unity EditMode

Resultado: **28/28 pasan**, 0 fallos, 0 omitidas, 1,265 s.

Comando reproducible:

```bash
/home/ferney_oliveros/Unity/Hub/Editor/6000.3.23f1/Editor/Unity \
  -batchmode -nographics \
  -projectPath "/home/ferney_oliveros/Mini Market/Unity/MiniMarketUnity" \
  -runTests -testPlatform EditMode \
  -testResults /tmp/market-editmode.xml \
  -logFile /tmp/market-editmode.log
```

No existe todavía una suite PlayMode. Esto queda como brecha de cobertura.

### Aplicación Next.js y API

Resultado: **47 archivos, 309/309 pruebas**, `typecheck`, `lint` y build de
producción correctos.

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Rendimiento base de juego

Build WebGL `20260907-032845`, release inmutable
`20260907-double-space-glass-l`.

| Escenario | Ready | Frame pacing sostenido | Pico | Memoria observada |
|---|---:|---:|---:|---:|
| Escritorio, RTX 4080/Vulkan | 7.619 ms | 60 FPS; p95 16,67 ms | 116,66 ms durante activación inicial de NPC | managed 15,9 MB; allocated 457,8 MB |
| Emulación Pixel 9, CPU 4x | 15.934 ms | 30 FPS; escala 0,62 | ningún frame de página >100 ms al primer movimiento | managed 11,5 MB; allocated 254,1 MB |

Escena de escritorio habitual: 258.146 triángulos visibles, con pico de
462.994. Escena móvil medida: 47.050 triángulos, 10 renderers y 10 slots de
material visibles.

El primer movimiento no reproduce el bloqueo original de 3–4 segundos porque
productos, cultivos, empleados, clientes y materiales se calientan antes de
habilitar el input. Se conserva esta secuencia como requisito funcional.

## Persistencia base y riesgo P0

El cliente usa una única clave `mini-market-unity-recovery-v1` de
`PlayerPrefs`. El sobre contiene estado, revisión de servidor, eventos
pendientes y fecha. Carece de versión de esquema, checksum y copia anterior
validada. Un JSON truncado hace que el cliente descarte la recuperación local y
dependa del servidor o de un estado inicial.

El servidor ya aplica autenticación, tamaño máximo de 600 KB, validación Zod,
revisión optimista, transacción, idempotencia de eventos y ámbito por usuario.
El refuerzo P0 se concentra por tanto en la copia local nativa y en el ciclo de
vida de Android/iOS, manteniendo el contrato remoto.

## Límites de esta medición

- No se han ejecutado pruebas en iPhone o Android físicos.
- No hay medición térmica, de batería ni soak de 60 minutos en dispositivo.
- No se ha generado todavía AAB ni proyecto Xcode firmado.
- Las cifras de emulación de móvil sirven para detectar regresiones WebGL, pero
  no sustituyen el profiler de dispositivo.
- El test de carga del backend se hará solo en entorno controlado; producción no
  se someterá a carga sintética sin autorización expresa.


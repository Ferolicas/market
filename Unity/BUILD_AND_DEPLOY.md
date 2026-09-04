# Compilar y ejecutar Mini Market Unity

## Abrir en Unity

En Unity Hub, añade el proyecto:

`/home/ferney_oliveros/Mini Market/Unity/MiniMarketUnity`

Editor verificado: Unity `6000.3.23f1`.

## Build Web por terminal

```bash
/home/ferney_oliveros/Unity/Hub/Editor/6000.3.23f1/Editor/Unity \
  -batchmode -nographics \
  -projectPath '/home/ferney_oliveros/Mini Market/Unity/MiniMarketUnity' \
  -executeMethod MiniMarket.Editor.MiniMarketProjectBuilder.BuildWeb \
  -logFile /tmp/mini-market-unity-build.log -quit
```

La salida queda en `Unity/MiniMarketUnity/Builds/WebGL/`. Usa Brotli, WebGL/IL2CPP, URP, plantilla PWA y nombres hash para evitar assets antiguos en caché.

## Servir localmente

Desde la raíz del repositorio:

```bash
node Unity/MiniMarketUnity/MigrationTools/serve-web.mjs \
  Unity/MiniMarketUnity/Builds/WebGL 4173
```

Abre `http://127.0.0.1:4173` y pulsa `ENTRAR AL JUEGO`. Ese gesto inicia Unity y WebAudio de forma compatible con la política de autoplay. El servidor añade Brotli, MIME de WASM, COOP/COEP y caché inmutable para archivos hash. `index.html` permanece sin caché.

## Producción

Producción está activa en `https://market.olcas.app/`. Caddy sirve directamente el release inmutable enlazado desde `/var/www/market-unity/current`; no se introdujo Nginx ni un proceso Node adicional. El Next.js existente permanece en PM2 como `market`, puerto `4010`, y Caddy conserva allí `/api/*`, `/reset-password*` y `/_next/*` para Better Auth, guardado y recuperación de contraseña.

- Release: `/var/www/market-unity/releases/20260903T152317Z`
- Manifiesto: `/var/www/market-unity/releases/20260903T152317Z/SHA256SUMS`
- Backup previo: `/var/backups/market-unity-predeploy-20260903T135112Z`
- Configuración versionada: `Unity/MiniMarketUnity/Deploy/Caddyfile.snippet`

El rollback consiste en restaurar el `Caddyfile` del backup, validarlo con `caddy validate` y recargar Caddy. No exige revertir base de datos ni Next porque ninguno fue reemplazado.

Los builds Brotli de Unity pueden salir con permisos `600`. Toda publicación debe usar `MigrationTools/deploy-web.sh`, que fuerza `755` en carpetas y `644` en archivos durante `rsync`, comprueba lectura como usuario `caddy`, genera/verifica SHA-256 y solo entonces cambia el enlace `current`. Si Caddy no puede leer un `.br`, `try_files` devuelve `index.html` y el navegador informa `ERR_CONTENT_DECODING_FAILED`.

## Pruebas

```bash
/home/ferney_oliveros/Unity/Hub/Editor/6000.3.23f1/Editor/Unity \
  -batchmode -nographics \
  -projectPath '/home/ferney_oliveros/Mini Market/Unity/MiniMarketUnity' \
  -runTests -testPlatform EditMode \
  -testResults /tmp/mini-market-unity-tests.xml \
  -logFile /tmp/mini-market-unity-tests.log

node Unity/MiniMarketUnity/MigrationTools/browser-gameplay-qa.mjs
node Unity/MiniMarketUnity/MigrationTools/browser-worker-qa.mjs
node Unity/MiniMarketUnity/MigrationTools/browser-production-smoke-qa.mjs
node Unity/MiniMarketUnity/MigrationTools/browser-production-game-qa.mjs
```

Android e iOS se mantienen como objetivos futuros; no se generan builds móviles en esta fase.

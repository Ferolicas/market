# Store readiness Android/iOS

Verificado contra fuentes oficiales el 2026-09-07.

## Estado técnico actual

| Requisito | Estado | Evidencia o acción |
|---|---|---|
| Bundle ID | GREEN | `app.olcas.market` en Android/iOS |
| Arquitectura Android | GREEN | ARM64 e IL2CPP |
| Formato Google Play | GREEN preparado | Builder produce `.aab`; falta firma release |
| Target Android | YELLOW | `Auto` debe resolver API 36: desde 31-08-2026 las apps nuevas/updates de móvil deben apuntar a Android 16/API 36 ([Google Play](https://support.google.com/googleplay/android-developer/answer/11926878?hl=es-419)) |
| Páginas de memoria Android | YELLOW | comprobar el AAB en un dispositivo/emulador 16 KB; Google lo exige para target 35+ y bloqueará updates incompatibles desde 01-02-2027 ([Android Developers](https://developer.android.com/guide/practices/page-sizes)) |
| iOS SDK | RED hasta exportar en Mac | desde 28-04-2026 la carga debe construirse con SDK iOS 26 o posterior ([Apple](https://developer.apple.com/news/?id=ueeok6yw)) |
| iOS mínimo | GREEN configurado | iOS 15.0; confirmar metadata tras upload |
| Version/build | GREEN preparado | versión, build, commit, catálogo y save schema se incrustan en cada build |
| Save local | GREEN en código | escritura atómica native + previous/temp + lifecycle; falta dispositivo físico |
| Cloud save nativo | RED | falta auth móvil segura del ADR 0003 |
| Iconos/splash/capturas | RED | no existe paquete final de fichas de tienda |
| Firma | RED | faltan keystore Android y equipo/perfiles Apple; nunca entran en Git |
| Privacy manifest | RED | auditar binario/SDK y generar `PrivacyInfo.xcprivacy`; Apple exige declarar datos y required-reason APIs ([Apple](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)) |
| Data Safety/App Privacy | RED | completar desde datos reales cuando se fijen auth, telemetría y crash SDK |
| Borrado de cuenta | RED si se habilita alta/login | Apple y Google exigen inicio de borrado desde la app cuando permite crear cuenta ([Apple](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Google Play](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN)) |
| IAP/restore | No aplica hoy | no hay bienes digitales ni catálogo IAP; si se añaden, usar StoreKit/Play Billing y validación servidor |
| ATT | No aplica hoy | reevaluar si un SDK rastrea entre apps/sitios |
| Age rating | RED | responder cuestionarios con contenido real |
| Review access | RED | preparar cuenta demo o modo completo para revisión; Apple lo pide para funciones con cuenta ([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)) |
| Unity CI | YELLOW | workflow manual preparado; requiere secrets/licencia según `UNITY-CI.md` |

## Matriz obligatoria antes de beta externa

- iPhone reciente y uno con varios años: 15, 30 y 60 minutos.
- Android alta, media y el modelo bajo objetivo: 15, 30 y 60 minutos.
- En cada uno: arranque frío/caliente, touch y safe area, giro, pausa/reanudar,
  kill/restore, Wi-Fi perdido, Wi-Fi↔datos, memoria, temperatura, batería, FPS,
  save local, reconnect y cloud save cuando exista auth.
- Validar AAB en closed testing y iOS en TestFlight. Guardar versión/build,
  modelo, SO, p95/p99, PSS, thermal state, batería inicial/final y crash/ANR.

## Rollout

Primero internal/closed/TestFlight; después staged rollout pequeño. Detener ante
pérdida de save, login loop, compra duplicada, pantalla negra, ANR o caída del
crash-free. Los sistemas futuros de eventos, productos y contenido remoto deben
tener flags/kill switches cacheados con defaults locales seguros.

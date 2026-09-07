# ADR 0003: autenticación móvil

Estado: propuesta bloqueada por flujo de producto · 2026-09-07

## Contexto

La web usa Better Auth con cookies same-origin. Un player Android/iOS no puede
asumir que la cookie de un navegador del sistema aparecerá en UnityWebRequest.
Hoy el juego nativo puede jugar y guardar localmente; cloud save responde 401
sin una sesión válida.

## Decisión

No almacenar contraseña ni copiar cookies a PlayerPrefs. Cuando se habilite
login nativo, se usará navegador del sistema, deep link universal/app link,
código de autorización de un solo uso y tokens rotables guardados en Keychain o
Android Keystore. El backend intercambiará el código y seguirá resolviendo el
usuario; el cliente nunca enviará userId como autoridad.

## Alternativas

- WebView embebida y extracción de cookie: frágil y con una superficie de ataque
  mayor.
- Usuario/contraseña directamente en Unity: obliga a manipular credenciales y
  recuperación dentro del juego.

## Consecuencias

La beta nativa con cloud save requiere implementar y probar este flujo. Hasta
entonces, la UX debe presentar cloud sync como pendiente y mantener el guardado
local; no debe prometer sincronización entre dispositivos.


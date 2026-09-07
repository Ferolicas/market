# CI de Unity

`.github/workflows/unity-validation.yml` es manual y queda desactivado mientras
`confirm_license` sea falso. No forma parte del deploy web existente y por ello
no puede dejar `main` rojo por ausencia de licencia Unity.

Configurar secrets según la documentación actual de
[GameCI Test Runner](https://game.ci/docs/github/test-runner/):

- `UNITY_LICENSE`
- `UNITY_EMAIL`
- `UNITY_PASSWORD`

Al ejecutarlo, corre EditMode, PlayMode y el validador de producción. Después
permite elegir un artefacto: WebGL podado, AAB Android sin firma de tienda o
proyecto Xcode iOS. GameCI v4 admite el `buildMethod` estático usado por el
builder ([documentación](https://game.ci/docs/github/builder/)).

La firma Android requiere añadir el keystore mediante secrets y conectar sus
valores al build; Apple requiere un runner macOS con certificados/perfiles para
archivar/subir. Ningún certificado, contraseña o archivo de firma debe entrar
en el repositorio.

El workflow de Next.js `.github/workflows/deploy.yml` se conserva intacto.


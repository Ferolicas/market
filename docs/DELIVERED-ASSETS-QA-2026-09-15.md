# Recursos y correcciones visuales — 15 de septiembre de 2026

Estado: implementado y verificado en local; no publicado en producción.

## Cambios

- Franja de entrada de panadería: suelo y franja ya no comparten plano. El umbral queda íntegramente por encima del suelo.
- Modelos suministrados: molino, horno, exprimidora, queso, leche, vitrina de lácteos, huevo y expositor de huevos. Escala uniforme, conservación de geometría y UV; compresión WebP/Meshopt. Stock real instanciado y posiciones ajustadas a las nuevas baldas; capacidades guardadas conservadas.
- Gallina y vaca: fuentes estáticas sin rig ni clips. Versiones derivadas con esqueleto específico, Walk/Idle y Peck/Graze, mezcla y paseo limitado al corral. No se ha usado animación humana ni movido el animal completo para fingir picoteo.
- Suelo del corral: el radio original de 0,16 en una pieza de 0,075 de grosor deformaba el suelo hasta atravesar las patas. Radio corregido a 0,025; contacto validado en la escena escalada.
- Pelo: se conecta el selector al render, se oculta el pelo original fusionado mediante máscaras de índices y se adapta cada accesorio a la cabeza. Gorros: mismos modelos y ajuste, con la geometría original del personaje intacta al equiparlos.
- Interfaz: adaptación crema/oliva de las referencias entregadas mediante controles DOM funcionales. Las láminas contienen textos y cifras incrustados, por lo que no se convierten directamente en botones raster. Cámara de vestuario adaptativa, controles táctiles y conservación del giro 360°.

## Evidencia

| Puerta | Resultado | Alcance |
| --- | --- | --- |
| TypeScript, lint, Vitest | PASS | 378 pruebas, 54 archivos |
| Build de producción local | PASS | Next.js 16.3.3 |
| Validación GLB | PASS | 213 modelos, cero fallos; incluye los diez nuevos |
| Accesorios | PASS | 112/112 respuestas de modelos, sin errores de consola/página/red |
| Vestuario móvil | PASS | 390×844, DPR 2, cambio de cuerpo conserva juego y panel |
| Integración de recursos | PASS | Diez GLB cargados en el juego, fotografías y vídeo de máquinas, estantes y animales |
| Contacto de animales | PASS | Raycast al suelo real y vértices skinned en coordenadas de mundo |
| Paseo y alimentación en ejecución | PASS | 24 s observados: gallina recorre 0,44 unidades y cuello 1,49 rad; vaca 0,369 unidades y cuello 1,36 rad |
| Puertas de vitrina | PASS | Tres bisagras alcanzan −1,05 rad al acceder un cliente; revisión visual de poses intermedias |
| Presupuesto móvil emulado | PASS | CPU ×4, 8 ventanas, jugador en movimiento: 51 FPS mediana, p95 RAF 33,4 ms; el monitor de render registra p95/pico 83,4 ms. 164 draws máximo, 268.455 triángulos máximo, cero long tasks y errores |
| Teléfono físico / temperatura / batería | NOT_RUN | No extrapolar la prueba en RTX 4080 SUPER a Android/iPhone |
| Publicación y aceptación en producción | NOT_RUN | Pendiente de autorización para publicar |

La medición de rendimiento es una pasada corta en desarrollo, no una certificación de 60 FPS ni una comparación controlada contra el baseline de producción. La geometría original de los animales presenta pequeños huecos propios del modelo entregado; se conserva su apariencia y no se afirma una reconstrucción artística completa. Los movimientos son ciclos ligeros de juego, no mocap ni IK adaptativo de terreno.

La vitrina fusionada se prepara con tres hojas rígidas y bisagras, conservando los triángulos originales y añadiendo remates oscuros a los cortes. `DeliveredDairy.tsx` conserva la apertura vinculada al acceso de clientes y excluye las puertas del lote estático. No se desplaza el mueble entero para simular apertura.

## Reproducibilidad y conservación

- Originales de Descargas intactos. SHA-256, tamaños, escala y clips en `delivered-assets-manifest.json` y `delivered-animals-manifest.json`.
- Importación: `node scripts/import-delivered-assets.mjs`, `node scripts/build-delivered-animals.mjs`.
- Máscaras: `node scripts/build-avatar-hair-masks.mjs`; repetir si cambian los GLB de los cuerpos.
- QA de escena: `node scripts/qa-delivered-runtime.mjs /tmp/market-delivered-runtime-acceptance`.
- Evidencia local: `/tmp/market-delivered-runtime-acceptance`, `/tmp/market-accessories-final`, `/tmp/market-delivered-avatar-mobile-final`, `/tmp/market-delivered-performance-final`.
- No se cambia el esquema de base de datos, autenticación, revisiones de guardado ni economía. Los recursos anteriores permanecen disponibles; no se borraron originales ni assets anteriores.

# Decisiones del producto

Actualizado: 2026-08-29

## Fuente de verdad

- `INSTRUCCIONES_CODEX_SUPERMERCADO_3D.txt` es la especificación funcional y técnica completa.
- Las quince láminas PNG de `/home/ferney_oliveros/Descargas/KIT MARKET/` son la única especificación visual del arte del juego.
- My Mini Mart se usa exclusivamente como referencia del bucle de juego; no se copian nombres, mapas, interfaz ni recursos.

## Producto

- Simulador casual 3D privado, PWA y browser-first, con escritorio y móvil al mismo nivel funcional.
- El bucle central es proximidad sin tecla de acción: producir, cargar, surtir, vender, mejorar y expandir.
- Autenticación, servidor autoritativo, recuperación local, concurrencia optimista y dinero entero en unidades menores se conservan.
- Stack definitivo: Next.js/React/TypeScript, React Three Fiber, Three.js, Rapier, Recast, Zustand, PostgreSQL/Prisma y Better Auth.

## Experiencia

- El movimiento principal nace donde se pulsa o toca; teclado y gamepad son alternativas.
- La cámara ortográfica sigue al vendedor manteniéndolo exactamente en el centro. Esta instrucción directa posterior del usuario prevalece sobre la zona muerta/look-ahead del documento maestro.
- Las actividades no bloquean el desplazamiento y no requieren `E`, diálogos ni botones de acción.
- Arte, personajes, accesorios, mobiliario y huerta siguen las PNG propias.

## Operación de este encargo

- La orden del usuario de completar todo el documento constituye aprobación del backlog funcional completo.
- El trabajo actual es local. No se hará push, deploy ni mutación de producción sin una orden explícita posterior.
- Cada bloque debe conservar una app ejecutable y se valida con pruebas, navegador real y documentación viva.

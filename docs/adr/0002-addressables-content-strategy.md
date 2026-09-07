# ADR 0002: estrategia de contenido y Addressables

Estado: aceptado como evaluación · 2026-09-07

## Contexto

Addressables 2.7.6 está instalado, pero el juego carga 199 GLB desde
StreamingAssets mediante un catálogo propio verificado. El arte fuente suma
292,45 MB y el paquete WebGL podado suma 194,18 MB. Migrar claves o rutas ahora
rompería referencias y cachés que ya están medidas y desplegadas.

## Decisión

Se conserva el catálogo actual para el contenido núcleo. El validador exige ID
único, archivo presente y bytes exactos. No se crea un catálogo Addressables
vacío ni se renombran IDs existentes.

Addressables se introducirá por un grupo piloto reversible cuando exista una
necesidad concreta de contenido remoto. El piloto deberá incluir catálogo
versionado, CDN, hash, timeout, retry con backoff, copia cacheada compatible,
fallback local y rollback del catálogo. Nunca se eliminará la última copia
válida antes de validar la nueva.

## Alternativas

- Migración completa inmediata: mucho riesgo y ningún dato que demuestre mejora
  de arranque o memoria.
- Resources para todo: obliga a incluir y cargar contenido innecesario.

## Consecuencias

El cliente sigue siendo estable y medible. La descarga modular, eventos remotos
y reducción futura del binario quedan en amarillo hasta ejecutar el piloto y
medirlo en dispositivos físicos.


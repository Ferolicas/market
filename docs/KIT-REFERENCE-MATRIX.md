# Matriz de referencia del kit

Actualizado: 2026-08-30

Las hojas PNG de `/home/ferney_oliveros/Descargas/KIT MARKET` son la especificación visual. Esta matriz evita volver a sustituirlas por recursos genéricos.

| Referencia | Implementación del juego | Verificación |
|---|---|---|
| `PERSONAJES.png` | Cuatro GLB reconstruidos en `public/models/market/characters/` | Cuatro cuerpos en frontal, perfil, espalda, cenital, expresiones y marcha |
| `VENDEDOR HOMBRE.png` | `public/models/market/characters/owner_man.glb` | Identidad, uniforme, proporción, rig y 16 morph targets funcionales |
| `POSES DUEÑO.png` / `ANIMACIONES.png` | 39 clips GLB ensamblados en Blender; medición por `check_foot_contact.py` | Ciclo cerrado e in-place; apoyo delante→atrás, flexión de ambas rodillas y suela apoyada sin penetración |
| `cliente1.png`–`cliente6.png` | Seis GLB propios en `public/models/market/customers/` y `Customer.tsx` | Recorrido completo, parpadeo/expresiones, contacto con suelo y colisiones |
| `PEINADOS.png` | 64 GLB en `public/models/market/hair/` y `CharacterAccessories.tsx`: 16 cabellos × 4 cabezas | Sustitución completa del pelo y pruebas frontal, perfil, espalda y cenital |
| `GORROS.png` | 48 GLB en `public/models/market/hats/`: 12 animales × 4 cabezas; sin animales inventados | Ajuste individual, abertura facial y pruebas frontal, perfil, espalda y cenital |
| `MOBILIARIO.png` | Edificio, caja, datáfono, carro, cesta, horno, fregadero, frío, almacén y servicios | Escena ortográfica y volúmenes de colisión |
| `MOBILIARIO2.png` | Estanterías murales, góndolas, expositor plano/inclinado y refrigerado | Variantes de silueta y surtido |
| `HUERTA.png` | Seis cultivos, fases, valla, portón, riego, aspersor, regadera, saco, compost, invernadero y espantapájaros | Vista general y prueba de rutas |

Reglas de aceptación: no quedan mallas flotantes o a media altura; el cabello nativo no se duplica; los gorros no tapan ojos ni atraviesan la cabeza; cada locomoción cierra el ciclo y mueve cadera, piernas, rodillas, tobillos, torso y brazos; las rutas de clientes no intersectan mobiliario.

Evidencia local vigente: turnarounds de personajes, seis expresiones por identidad, 896 vistas de accesorios ajustados sobre los cuatro tipos de cabeza, una segunda selección y captura real de las 112 combinaciones en Chrome/Vulkan, 488 vistas de mobiliario/huerta y tiras de marcha frontal/lateral. `gltf-validator` revisa los 203 GLB actuales con cero errores y cero advertencias. Los diez cuerpos y sus veinte LOD conservan sus clips, 16 morph targets funcionales y todos los huesos requeridos. En los seis clientes, los 33 fotogramas de `Walk` mantienen al menos una suela exactamente en el suelo. Los PNG son la referencia visual; ningún GLB heredado participa en la carga ni permanece en `public/models`.

Resultados medidos: estrés real con 30 clientes, 4 empleados y todas las estaciones a 60 FPS/p95 16,8 ms en RTX 4080 SUPER. El recorrido final del 30 de agosto permaneció abierto 15:03 minutos, llegó a nivel 6, atendió cinco clientes y cerró a 60 FPS/p95 16,8 ms, 209 draw calls, 275.996 triángulos y 97 texturas; guardado servidor/recarga fueron idénticos, el arrastre móvil desplazó 1,247 unidades, WebGL permaneció estable y no hubo errores de consola, página ni red. El perfil móvil obtuvo mediana de 60 FPS en diez muestras. Evidencias: `/tmp/market-30-clients-v47`, `/tmp/market-full-game-15m-20260830-perfect-v2`, `/tmp/market-mobile-performance-v47`, `/tmp/market-persistence-away-from-door-qa-final`, `/tmp/market-character-runtime-v47`, `/tmp/market-accessory-runtime-v3` y `/tmp/market-environment-turnarounds-20260829-final`.

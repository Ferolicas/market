# Arquitectura del cliente Unity

## Límites

Unity es un cliente independiente. El backend Next/Better Auth/PostgreSQL sigue siendo autoritativo para cuentas y revisiones de guardado. Los masters de `GameAssets/` son fuente artística congelada; Unity usa copias runtime dentro de `StreamingAssets/Art/`.

En producción Caddy sirve Unity como PWA en `market.olcas.app` y enruta `/api/*`, recuperación de contraseña y chunks necesarios de Next al proceso PM2 `market:4010`. Por tanto, cambiar o revertir el cliente Web no altera cuentas, base de datos ni partidas.

## Composición

- `Core/MiniMarketRuntime`: arranque y composición de dependencias.
- `Data`: estado JSON, especificación extraída y política única de disponibilidad.
- `Inventory`: inventario por ubicación y carga del jugador.
- `Economy`, `Progression`, `Store`: caja, niveles, jornada, pedidos, contratación y mundo.
- `Farm`, `Production`: cultivos, recetas, temporizadores y máquinas.
- `Customers`: FSM de compra, navegación, cesta/productos físicos y cola.
- `Employees`: agentes físicos, mercancía visible y planificación de demanda ascendente.
- `Characters`, `Animations`: carga de cuerpos, Animator, morphs, LOD, sockets y manos.
- `Interactions`, `Player`: proximidad, control y cámara isométrica.
- `Persistence`, `Networking`: recuperación local, eventos pendientes y API existente.
- `UI`, `Audio`, `Performance`: HUD responsive, mezcla de audio y presupuestos de actualización.

## Flujo de mercancía

```text
Cultivo/proveedor → carga o empleado → almacén
                                     ↓
                          máquina de insumo
                                     ↓
                          máquina de producto
                                     ↓
                              expositor compatible
                                     ↓
                             cliente → caja
```

`ProductAvailabilityPolicy` autoriza cada frontera según nivel. `SupplyDemandPlanner` parte del faltante vendible y propaga esa demanda hacia recetas/cultivos, evitando producción aleatoria. `PlayerCarrySystem` garantiza que una carga siempre pueda surtirse o devolverse al almacén.

## Persistencia

Los cambios se guardan en recuperación local cada 10 segundos. La sincronización remota ocurre a los 30 minutos cuando hay cambios, en cierre de jornada o por llamada explícita. Los fallos mantienen el snapshot y eventos localmente; un conflicto remoto crea una copia de recuperación antes de informar al jugador.

## Rendimiento Web/móvil

- URP y preferencia GPU de bajo consumo en Web.
- Cámara ortográfica: un `Motion.glb` sin malla gobierna una sola malla LOD2 por actor; evita evaluar o descargar tres esqueletos equivalentes.
- Carga glTF asíncrona y geometría/texturas runtime compartidas cuando corresponde.
- Pooling por identidad para clientes y reutilización de cestas/productos.
- IA y decisiones a frecuencia reducida, separadas del frame de render.
- NavMeshAgent sin búsquedas globales por frame.
- Archivos WebGL hash y caché PWA controlada.
- El empaquetado Web conserva solo assets solicitables y deja LOD0/LOD1/masters fuera del despliegue, disponibles en las fuentes del proyecto.
- Sin sincronización al VPS en cada acción.

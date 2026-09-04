# Mini Market — índice profesional de referencias

Congelado: 2026-09-02

Este directorio organiza las 15 PNG privadas originales de `/home/ferney_oliveros/Descargas/KIT MARKET/` sin editar, recortar, recomprimir ni sobrescribir ninguna fuente. Cada copia debe conservar el SHA-256 registrado en `reference_manifest.json`.

## Reglas de uso

- Las PNG originales y sus copias byte idénticas son la única fuente visual de esta clasificación.
- Un mosaico permanece como mosaico; sus paneles no se presentan como imágenes fuente independientes.
- Una vista no documentada no existe y no debe inventarse.
- Los IDs de `asset_id_map.json` son permanentes. No deben reutilizarse para otra identidad.
- El reparto activo tiene exactamente nueve personajes: cuatro trabajadores, tres clientas y dos clientes. `CustomerFemale04` está retirado y no forma parte del juego.
- Los nombres actuales de los GLB no se cambian: el mapa establece una capa canónica estable sobre ellos.
- Los hashes `baselineSha256AtFreeze` identifican los diez GLB LOD0 existentes el día de congelación; no son autorización para modificar esos archivos.

## Estructura

```text
References/
├── Characters/   # 9 mosaicos de personajes, acciones y expresiones
├── Hair/         # 1 mosaico con Hair_01–Hair_16
├── Hats/         # 1 mosaico con Hat_01–Hat_12
├── Furniture/    # 2 mosaicos de mobiliario y equipamiento
├── Other/        # 1 mosaico de animación y 1 de huerta
├── reference_manifest.json
├── asset_id_map.json
└── REFERENCE_INDEX.md
```

## Referencias clasificadas

| Original | Copia organizada | Categoría | Representa | Contenido disponible |
|---|---|---|---|---|
| `PERSONAJES.png` | `Characters/OwnerCast_TurnaroundMosaic.png` | Personaje | `AdultMale`, `AdultFemale`, `Boy`, `Girl` | Frontal, perfil y espalda de cada uno, reunidos en un mosaico 4×3 |
| `VENDEDOR HOMBRE.png` | `Characters/AdultMale_TurnaroundMosaic.png` | Personaje | `AdultMale` | Ocho paneles: frontal, perfiles, espalda y tres cuartos |
| `POSES DUEÑO.png` | `Characters/AdultMale_ActionPoseMosaic.png` | Personaje | `AdultMale` | Acciones de locomoción, tienda, checkout, limpieza, cultivo y expresiones |
| `cliente1.png` | `Characters/CustomerMale01_ActionMosaic.png` | Personaje | `CustomerMale01` | Acciones comerciales y primeros planos de expresiones |
| `cliente2.png` | `Characters/CustomerMale02_ActionMosaic.png` | Personaje | `CustomerMale02` | Acciones comerciales y primeros planos de expresiones |
| `cliente3.png` | `Characters/CustomerFemale01_ActionMosaic.png` | Personaje | `CustomerFemale01` | Acciones comerciales y primeros planos de expresiones |
| `cliente4.png` | `Characters/CustomerFemale02_ActionMosaic.png` | Personaje | `CustomerFemale02` | Acciones comerciales y primeros planos de expresiones |
| `cliente5.png` | `Characters/CustomerFemale03_ActionMosaic.png` | Personaje | `CustomerFemale03` | Acciones comerciales y primeros planos de expresiones |
| `cliente6.png` | `Characters/CustomerFemale04_ActionMosaic.png` | Personaje archivado | Referencia heredada sin personaje activo | Acciones comerciales y primeros planos de expresiones; se conserva byte idéntica, pero no pertenece al reparto actual |
| `PEINADOS.png` | `Hair/Hair_01-16_CatalogMosaic.png` | Cabello | `Hair_01`–`Hair_16` | Mosaico 4×4; una vista frontal o tres cuartos por peinado |
| `GORROS.png` | `Hats/Hat_01-12_CatalogMosaic.png` | Gorro | `Hat_01`–`Hat_12` | Mosaico 3×4; una vista frontal o tres cuartos por gorro |
| `MOBILIARIO.png` | `Furniture/Furniture_EquipmentCatalog_Mosaic.png` | Mobiliario | Construcción, checkout, equipos y props | Vistas isométricas o de tres cuartos aisladas dentro del mosaico |
| `MOBILIARIO2.png` | `Furniture/Furniture_DisplayCatalog_Mosaic.png` | Mobiliario | Estanterías, góndolas y expositores | Vistas isométricas o de tres cuartos aisladas dentro del mosaico |
| `ANIMACIONES.png` | `Other/Animation_ActionCatalog_Mosaic.png` | Otra | Dirección de acciones de `AdultMale` | Es byte idéntico a `POSES DUEÑO.png`; ambos se conservan por procedencia |
| `HUERTA.png` | `Other/FarmCatalog_Mosaic.png` | Otra | Suelo, cultivos, cercas, riego y props agrícolas | Vistas isométricas o de tres cuartos y estados de crecimiento |

Las hojas `cliente1.png`–`cliente6.png` son mosaicos de acciones y expresiones, no turnarounds ortográficos. `cliente6.png` permanece únicamente como referencia histórica: no autoriza una cuarta clienta. `AdultFemale`, `Boy` y `Girl` no tienen una hoja individual de ocho vistas: solo existen sus tres paneles en `PERSONAJES.png`.

## IDs definitivos de personajes

| ID definitivo | ID actual del registro | GLB LOD0 vinculado | Referencia principal |
|---|---|---|---|
| `AdultMale` | `owner_man` | `public/models/market/characters/owner_man.glb` | `AdultMale_TurnaroundMosaic.png` |
| `AdultFemale` | `owner_woman` | `public/models/market/characters/owner_woman.glb` | `OwnerCast_TurnaroundMosaic.png` |
| `Boy` | `owner_boy` | `public/models/market/characters/owner_boy.glb` | `OwnerCast_TurnaroundMosaic.png` |
| `Girl` | `owner_girl` | `public/models/market/characters/owner_girl.glb` | `OwnerCast_TurnaroundMosaic.png` |
| `CustomerFemale01` | `customer_woman_young` | `public/models/market/customers/customer_03_woman_young.glb` | `CustomerFemale01_ActionMosaic.png` |
| `CustomerFemale02` | `customer_woman_adult` | `public/models/market/customers/customer_04_woman_adult.glb` | `CustomerFemale02_ActionMosaic.png` |
| `CustomerFemale03` | `customer_woman_mature` | `public/models/market/customers/customer_05_woman_mature.glb` | `CustomerFemale03_ActionMosaic.png` |
| `CustomerMale01` | `customer_man_young` | `public/models/market/customers/customer_01_man_young.glb` | `CustomerMale01_ActionMosaic.png` |
| `CustomerMale02` | `customer_man_senior` | `public/models/market/customers/customer_02_man_senior.glb` | `CustomerMale02_ActionMosaic.png` |

`CustomerFemale04` está registrado en `retiredCharacters` únicamente para impedir que su antiguo ID se reasigne por accidente. No está en `characterOrder`, no tiene build RoyalMatch y no debe aparecer en gameplay.

## IDs definitivos de cabellos

Cada peinado tiene cuatro ajustes existentes bajo `public/models/market/hair/{adult-man,adult-woman,boy,girl}/`.

| Orden | ID definitivo | ID actual del registro | Archivo interno actual | Observación |
|---:|---|---|---|---|
| 01 | `Hair_01_SidePart` | `hair_01_short_side_part` | `side-part.glb` | Correspondencia congelada |
| 02 | `Hair_02_Fade` | `hair_02_fade` | `fade.glb` | Correspondencia directa |
| 03 | `Hair_03_Wavy` | `hair_03_waves` | `waves.glb` | Singular canónico frente a plural interno |
| 04 | `Hair_04_SlickBack` | `hair_04_swept` | `swept.glb` | `SlickBack` corresponde al actual `swept` |
| 05 | `Hair_05_Bob` | `hair_05_bob` | `bob.glb` | Correspondencia directa |
| 06 | `Hair_06_Ponytail` | `hair_06_ponytail` | `ponytail.glb` | Correspondencia directa |
| 07 | `Hair_07_LongWavy` | `hair_07_long_wavy` | `long-wavy.glb` | Correspondencia congelada |
| 08 | `Hair_08_Bun` | `hair_08_bun` | `bun.glb` | Correspondencia directa |
| 09 | `Hair_09_MessyMale` | `hair_09_messy` | `messy.glb` | Correspondencia congelada |
| 10 | `Hair_10_CurlyMale` | `hair_10_curls` | `curls.glb` | Correspondencia congelada |
| 11 | `Hair_11_SideSweepMale` | `hair_11_short_fringe` | `short-fringe.glb` | Diferencia nominal conocida; no renombrar el GLB |
| 12 | `Hair_12_SpikyMale` | `hair_12_quiff` | `quiff.glb` | Diferencia nominal conocida; no renombrar el GLB |
| 13 | `Hair_13_FemaleBobBangs` | `hair_13_blunt_bob` | `blunt-bob.glb` | Correspondencia congelada |
| 14 | `Hair_14_Pigtails` | `hair_14_pigtails` | `pigtails.glb` | Correspondencia directa |
| 15 | `Hair_15_SideBraid` | `hair_15_braid` | `braid.glb` | Correspondencia congelada |
| 16 | `Hair_16_HighPonytail` | `hair_16_high_ponytail` | `high-ponytail.glb` | Correspondencia congelada |

## IDs definitivos de gorros

Cada gorro tiene cuatro ajustes existentes bajo `public/models/market/hats/{adult-man,adult-woman,boy,girl}/`.

| Orden | ID definitivo | ID actual del registro | Archivo interno actual |
|---:|---|---|---|
| 01 | `Hat_01_RedPanda` | `hat_red-panda` | `red-panda.glb` |
| 02 | `Hat_02_Fox` | `hat_red-fox` | `red-fox.glb` |
| 03 | `Hat_03_Chicken` | `hat_chicken` | `chicken.glb` |
| 04 | `Hat_04_Owl` | `hat_owl` | `owl.glb` |
| 05 | `Hat_05_Elephant` | `hat_elephant` | `elephant.glb` |
| 06 | `Hat_06_Rhino` | `hat_rhinoceros` | `rhino.glb` |
| 07 | `Hat_07_Giraffe` | `hat_giraffe` | `giraffe.glb` |
| 08 | `Hat_08_Panda` | `hat_panda` | `panda.glb` |
| 09 | `Hat_09_Frog` | `hat_frog` | `frog.glb` |
| 10 | `Hat_10_Cow` | `hat_cow` | `cow.glb` |
| 11 | `Hat_11_Rabbit` | `hat_bunny` | `rabbit.glb` |
| 12 | `Hat_12_Capybara` | `hat_capybara` | `capybara.glb` |

La relación completa de cada ID con sus cuatro archivos corporales está congelada en `asset_id_map.json`.

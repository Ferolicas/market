# Reestructuración de lógica — My Mini Mart

## Cambio de alcance vigente: reinicio desde nivel 1

## Cierre de niveles, contratación y reinicio — release campaign-30-20260915

Publicación verificada: código bc2acd0cb5d380dbfce49e4bbef4d2947498fc6b, push main y GitHub Actions 34954998554 SUCCESS (quality y deploy). 566 pruebas en 72 archivos, typecheck, lint y build PASS. Producción confirma release campaign-30-20260915. QA autenticado real PASS: cuenta de prueba anterior pasa a nivel 1/cesta 3/saldo 0/stock 0, configura avatar, guarda y recarga; cliente sin versión rechazado; repetición de operación devuelve replay sin duplicar. Evidencia /tmp/market-release30-production-report.json y /tmp/market-release30-production.png (captura móvil revisada). PostgreSQL confirma para esa cuenta slot 1 intacto con 8 leches y slot 2 nuevo con 0. Un primer intento de comprobación de reintento coincidió con el guardado al cerrar la página y recibió conflicto 409; repetido sin escritura concurrente, 200 y replay 200.

Backup específico previo: /var/backups/vps-admin/2026-09-15-114808/market-before-release30.dump, validado con pg_restore -l. Rollback de código: versión anterior 1d22ab6, que vuelve a usar slot 1 sin mezclar el nuevo progreso. No se eliminaron cuentas ni partidas. Salud global tras deploy igual al estado inicial: market/API/DB OK; las advertencias de workers sin puerto y worker.cfanalisis.com ya estaban presentes, sin cambios en otros servicios. La aceptación corresponde al alcance niveles/cupos/reinicio y los recorridos enumerados, no a certificación integral de todos los dispositivos.

Se conecta la campaña existente a 30 niveles: 1 inicial; cada una de las 27 compras completadas añade un nivel (hasta 28), conservando su grafo de requisitos y tareas; completar todas las tareas personales habilita 29 y completar también los encargos habilita 30. No hay pago separado para saltar de nivel ni avance por XP. Los requisitos previos siguen determinando qué compra está disponible; el número de nivel resume lo construido. CampaignLevels.ts es la fuente común del motor, HUD y validador. Cada local tiene su nivel; state.level conserva el máximo de los locales adquiridos para no retroceder al viajar. El HUD muestra el nivel del local actual. Se reutilizan las seis ubicaciones y su apertura secuencial existente.

Cupos totales por local, incluyendo empleados incorporados en compras: cajeros 1 tras su compra y 2 tras ampliar; granjeros 1/2 según sus compras; operarios 1 con molino y 2 con quesería; reponedor y constructor 1 tras ampliar; gerente 1 tras completar queso, zumos y café. El motor bloquea nuevas altas cuando se agota el cupo, el panel muestra cupos y el servidor rechaza snapshots que los exceden.

Reinicio sin migración: CampaignRelease.ts fija slot 2 y un espacio local nuevo para IndexedDB, fallback, scope y marcador. GET crea createCampaignGame con capacidad 3, saldo cero y compras vacías; slot 1 queda intacto pero no se carga. PUT exige x-market-release para impedir que una pestaña antigua escriba en la nueva campaña. Autenticación, revisión optimista e idempotencia se conservan. El historial contable visible empieza en la creación del nuevo guardado. Service worker v10 actualiza la caché; /api/health expone el identificador de release. No cambia el esquema Prisma ni se eliminan cuentas.

Verificación local: recorrido de todas las compras, niveles 28/29/30, trabajo y encargos, guardado validado, cupos y rechazo de nivel falsificado. Navegador 1440×1000 y 390×844 PASS: cobro de ambas cajas, compra física de cajero, reposición personal y recarga; apertura de Estación, viaje, nuevo Nivel 1, Marina bloqueada y recarga. Evidencia: /tmp/market-release30-cash-qa/report.json y /tmp/market-release30-expansion-qa/report.json. API aislada con validador real. No certifica teléfonos físicos ni una campaña de un año.

La prueba exploratoria de producción de conservas sigue separada con MARKET_QA_PRODUCTION=1; su recorrido anterior no pasó y no se presenta como aceptación completa. La release no añade más contenido que el ya trabajado; el cierre actual es niveles, cupos y reinicio. Pendiente registrar commit, despliegue y comprobación real del reinicio debajo.

## Revisión de publicación: alcance confirmado de 30 niveles (15-09-2026)

NO PUBLICABLE como reestructuración terminada. El usuario aclara: conservar el juego y sus 30 niveles/locales existentes; reorganizar condiciones, contratación limitada por avance, aparición de instalaciones al desbloquear y pagar, dinero en caja. No añadir más contenido como condición para cerrar.

Comprobado directamente:
- La capacidad inicial ya es 3 (createInitialGame y createCampaignGame).
- src/app/api/game/save/route.ts sigue creando createInitialGame, devuelve guardados existentes del slot 1 y conserva el mismo recoveryScope. No hay activación ni reinicio versionado que impida recuperar el progreso anterior.
- La campaña vacía buildProjects y rechaza CONTRIBUTE_BUILD. El avance numérico anterior depende de esos proyectos; no existe la conexión de las compras nuevas a los 30 niveles. El HUD muestra locales, no esa progresión.
- canHireEmployee condiciona el oficio a compras, pero no limita su cantidad. Reproducción aislada: con cashier-1 y expansion-1 habilitados, cinco HIRE cashier consecutivos resultan true y dejan cinco cajeros. No hubo escrituras en cuentas ni en producción.
- Las expansiones nuevas sí reutilizan FRANCHISE_TEMPLATES; falta integrarlas con los 30 niveles acordados, no crear ubicaciones.
- QA previo de cesta/enlatadora no está cerrado; el contenido adicional no debe convertirse en requisito de esta entrega.

Verificación ejecutada de nuevo: pnpm typecheck, pnpm lint, pnpm test (563 casos, 70 archivos), pnpm build y git diff --check PASS. Estas pruebas no cubren los huecos funcionales arriba y no certifican publicación.

Decisión: sin push a main; no se cumple la condición del usuario «si no falta nada o falta poco». Son conexiones funcionales pendientes, no un error de compilación ni la falta de productos nuevos. Prioridad de cierre: conectar la progresión 1–30 a compras e instalaciones existentes; fijar cupos de contratación por avance; activar campaña/reinicio aislando la recuperación anterior; verificar inicio, compras, caja, guardado y expansión; publicar. No se borraron ni migraron partidas.

## Enlatadora y producción propia — integración posterior (15-09-2026)

Estado de aceptación al pausar para informar: 563 pruebas de dominio, typecheck y lint PASS. QA físico completo FAIL en /tmp/market-canner-qa-3: el jugador llega al sensor canner, pero su cesta está vacía y no cumple la recogida esperada. Falta determinar qué transferencia ocurre durante el recorrido; no atribuirlo todavía a la máquina ni dar por aprobado el flujo. La reposición previa sin enlatadora pasó en escritorio, pero falló la espera de reposición en móvil. Sin push ni producción modificada.

corn-canner-1 añade una máquina original sin sustituir GLB ni muebles existentes. Compra posterior al expositor de conservas: 1.224 € en España (18 veces el primer cajero; escalado por país). Receta provisional propia: un maíz fresco produce tres latas en seis segundos; salida máxima nueve. El valor de tres latas (10,80 €) supera el maíz fresco (7 €); no se cambiaron precios de productos existentes. Sigue disponible el suministro externo de conservas.

La interacción del jugador toma el maíz de su cesta; los operarios pueden buscarlo en el almacén, procesarlo y devolver las latas. El granjero calcula la necesidad de materia prima teniendo en cuenta las tres unidades por ciclo. Nueva tarea personal: recoger tres conservas de la máquina, con multiplicadores por local. El conjunto pasa a 27 compras, 18 tareas y tres encargos (48 requisitos). No se hereda progreso ni se activa aún la campaña en producción.

Layout nuevo en la trasera derecha [10, 0, -7.4], sin mover los elementos anteriores. production-layout define huella, punto de operario y sensor; fixture-availability controla render y colisiones solo tras comprar. El modelo procedural propio representa cuerpo, prensa, indicador y latas terminadas; no hay todavía animación mecánica de la prensa. La lógica no depende de una animación.

Impacto: ProductRegistry, products, MartCampaign, CampaignTasks, engine, production-layout, workstation-layout, fixture-availability, GameShell, MarketKit y pruebas. No hay migración de base de datos. La receta usa los estados/deadlines serializados existentes.

Pruebas de dominio: consumo único, rechazo de operación repetida, recarga a mitad de proceso, recogida sin duplicar, operario con maíz en almacén y sin granjeros, no solapamiento y ruta almacén→máquina. QA físico y verificación final se registran a continuación; no dar por aceptada la escena solo por superar pruebas de dominio.

## Conservas de maíz — integración posterior (15-09-2026)

Navegador PASS a 1440×1000 y 390×844: ocho anclas de producto detectadas en el expositor de conservas, entrega de encargo, apertura, viaje y recarga conservando las ocho unidades. Evidencia: /tmp/market-preserves-qa-4/report.json y vídeos/capturas. API HTTP aislada con validador real, tienda preparada y stock sembrado: no prueba compra/reposición física de las latas, PostgreSQL, service worker ni teléfono real. La captura revisada muestra la entrada, no un primer plano del expositor; su aceptación visual cercana queda pendiente. Se corrigió una carrera del script al recargar y la espera de la pantalla de preparación.

Se añade cannedCorn, distinto del maíz fresco, sin retirar ninguno de los doce productos anteriores. Catálogo actual: 13 productos, 26 compras, 17 tareas personales y tres encargos por local (46 requisitos de maestría). La compra preserves-supply-1 depende del maíz y del suministro de café; balance propio provisional de 816 € en España, coste mayorista 1,60 € y venta final 3,60 €, con escalado de país.

Por ahora es suministro del proveedor Campo: pedido → entrega con tienda abierta → almacén → cesta → reposición → cliente → caja → recogida. No existe todavía una enlatadora ni se transforma maíz fresco en conserva. Una tarea exige reponer personalmente cuatro latas en Barrio, con multiplicadores existentes por local. El encargo terminal-destino incorpora conservas; el conjunto de encargos cubre los trece productos.

Nuevo expositor adicional en el lateral este, sin sustituir ni desplazar los muebles actuales. Reutiliza la geometría propia de góndola, con lata procedural original y geometría/materiales compartidos e instancias para el stock. El área preserves-supply controla render, navegación y colisiones; no aparece en partidas legadas ni antes de comprar. Capacidad base: 40. Pruebas de navegación desde almacén, entrada y caja, sin solapamientos con otros obstáculos.

Verificación de dominio: 558 pruebas en 70 archivos PASS; typecheck, lint sin avisos y build PASS. Se cubren bloqueo previo, precio, entrega única, recogida/reposición, recarga, conservación del maíz fresco, venta de 360 unidades menores y cobro no duplicable. El fallo inicial de entrega era un fixture con tienda cerrada, corregido sin cambiar las reglas de entrega.

Impacto: ProductRegistry, catálogo, ProductSupply, CarrySystem, MartCampaign, CampaignTasks, CampaignContracts, engine, retail-layout, fixture-availability, MarketKit, HarvestBasket, Customer, CannedCornModel y pruebas. El inventario y los esquemas derivados del registro incluyen el nuevo ID. No se ha activado la campaña ni reiniciado ninguna cuenta; sigue pendiente la publicación versionada desde nivel 1, sin migrar progreso.

Pendientes del proyecto completo: producción de conservas, otras cadenas/animales y contenido avanzado, balance prolongado, marcadores individuales, aceptación integral y publicación. Este bloque no acredita una campaña de un año ni calidad comercial final. Sin push.

## Encargos compuestos personales — integración posterior

Navegador PASS (1440×1000 y 390×844): entrega de «Despensa del vecino» desde el panel, cesta consumida, exactamente un evento de entrega y uno de apertura, viaje y recarga en Estación sin heredar compras. Captura móvil revisada. Evidencia `/tmp/market-campaign-contracts-qa-1/report.json`, capturas y vídeos. Fixture con Barrio preparado y dos encargos previos sembrados; el último se entrega realmente en navegador con el validador de guardado. No prueba PostgreSQL, service worker ni teléfono físico. Build normal de producción restaurado sin controles QA.

CampaignContracts.ts añade 18 encargos originales, tres por cada local, combinando los doce productos existentes. Ejemplos: tomates+huevos+maíz; trigo+harina+pan; pan+café+leche; manzanas+naranjas+zumo. Cada receta exige una unidad de tres productos distintos y cabe en la cesta inicial. No añade todavía productos comerciales ni máquinas nuevas: introduce entregas compuestas con el surtido propio.

DELIVER_CONTRACT exige pertenencia al local activo, productos desbloqueados, encargo anterior completado y las tres unidades en la cesta personal. La entrega se confirma desde el panel de objetivos, sin nuevo mueble ni desplazamiento obligatorio a un punto de entrega. Consume las tres unidades juntas, una sola vez; una cesta incompleta no pierde nada. No toma mercancía automáticamente del almacén ni de empleados. No concede dinero, por lo que no reintroduce bonos que descompensen la campaña.

La lista ordenada purchases.completedContracts se guarda por franquicia (campo opcional del esquema existente). Apertura del siguiente local y porcentaje de maestría exigen estos tres encargos además de las 25 compras y 16 tareas. El HUD divide el avance entre 44 requisitos completos; el mapa muestra encargos pendientes del anterior. Los locales nuevos no heredan entregas.

SaveAuthority reconstruye eventos contract_delivery de importe cero, verificando ID, local, orden, productos declarados y desbloqueos, y compara la lista de completados. Rechaza duplicados, lista inventada sin eventos y apertura anterior a la última entrega. Como el resto del guardado actual, esto no es una reproducción íntegra de inventarios/acciones en el servidor: no afirmar que impida todas las falsificaciones de mercancía. El motor sí prueba consumo real y conservación en los recorridos válidos.

Pruebas: 552 casos en 69 archivos; incluye los 18 encargos mediante recogida personal del almacén y entrega, guardado/recarga, cesta incompleta, producto bloqueado, encargo ajeno, duplicados, ausencia de bonos y orden entrega→apertura. Typecheck y lint PASS. Archivos: CampaignContracts.ts/.test.ts, PurchaseState.ts, CampaignExpansion.ts, engine.ts, types.ts, SaveAuthority.ts, game-validation.ts, GameShell.tsx y QA de apertura. Los fixtures de local completado ahora incluyen encargos, sin sustituir las pruebas reales de entrega.

Pendientes: productos, animales y máquinas adicionales; cadenas productivas nuevas; balance de costes/tiempos; marcadores de compra individuales y publicación con reinicio versionado. Este bloque no completa una campaña de un año ni cambia producción. Sin push.

## Especialidades y maestría por local — integración posterior

Verificación: 548 pruebas en 68 archivos, typecheck, lint y build normal PASS. Muestreo determinista de 3.000 cestas y distribución de 4.000 primeras elecciones; prueba de progreso 3→6 cafés en Estación con objetivo 12 y validación de guardado. Navegador PASS a 1440×1000 y 390×844: especialidad en mapa, HUD Local 2/progreso cero, apertura, viaje, guardado y recarga. Evidencia `/tmp/market-campaign-specialties-qa-1/report.json`, vídeos/capturas; captura móvil revisada. API aislada, sin PostgreSQL, service worker ni dispositivo físico. El navegador usa un local inicial preparado como completado; no acredita un recorrido integral de la campaña.

CampaignLocations.ts define perfiles propios: Barrio/proximidad; Estación/desayunos y café; Marina/frutas y zumos; Terminal/cestas variadas; Campus/lácteos y cereales; Mega Market/todo el surtido. Después de la primera expansión, los productos de especialidad tienen peso 3 frente a 1 en una selección ponderada sin repetición; todos los demás productos desbloqueados permanecen disponibles. Máximo de tipos por cesta: 3, 3, 3, 4, 4, 5 respectivamente; entre 1 y 3 unidades por tipo y techo de 15 unidades. Antes de ampliar siguen las cestas de un tipo y una o dos unidades, sin exigir productos bloqueados ni aumentar aquí el límite simultáneo de personajes. La selección usa una semilla determinista, sin ordenar con un comparador aleatorio, y no depende del nivel legado.

La maestría personal para abrir el local siguiente usa objetivos propios por ubicación: multiplicador general/especialidad de 1/1, 2/3, 2/4, 3/5, 3/6 y 8/8. Ejemplos: Estación pide reponer 12 cafés y hacer 3 pedidos; Marina pide 16 zumos. Las tareas cortas que enseñan una compra (por ejemplo cosechar 6 trigos para el molino) conservan sus cantidades iniciales, separadas de la maestría de salida. Los contadores se acumulan por local hasta su objetivo, como máximo 64, dentro del límite de guardado de 100. Motor, servidor, panel y mapa calculan el objetivo con el mismo ID estable de franquicia; recargar no recorta a la cantidad de Barrio.

El HUD muestra Local 1–6 en campaña y el porcentaje del conjunto completo de 25 compras y 16 tareas, incluidas cadenas aún bloqueadas; completar solo tomates no muestra 100 %. El mapa añade la especialidad. No se modifican modelos ni se descartan productos. Archivos afectados: CampaignLocations.ts/.test.ts, CampaignTasks.ts, CampaignExpansion.ts, engine.ts, SaveAuthority.ts, GameShell.tsx y la prueba de navegador de apertura.

Estas variaciones son balance propio provisional, no nuevos productos, recetas ni locales reproducidos de la referencia. Siguen pendientes contenido adicional, cadenas exclusivas, retos que no sean cantidades, calibración de precios/tiempos y la publicación con reinicio de partidas. No se ha acreditado duración de un año. Sin push ni producción modificada.

## Apertura secuencial de locales — integración posterior

Navegador PASS a 1440×1000 y 390×844: abrir Estación desde el mapa, viajar, guardar y recargar; exactamente un evento de apertura aceptado, compras/tareas nuevas vacías, sin proyectos legados y Marina bloqueada. Captura móvil revisada. Evidencia `/tmp/market-campaign-expansion-qa-1/report.json`, capturas y vídeos. Escenario preparado con Barrio completado mediante el motor y tareas sembradas para aislar la apertura: no es un recorrido completo de campaña. API HTTP simulada con validador real, sin base de datos ni teléfono físico.

Los seis locales actuales (Barrio → Estación → Marina → Terminal → Campus → Mega Market) se conectan por finalización del anterior, no por XP ni nivel legado. CampaignExpansion.ts exige las 25 compras y las 16 tareas personales del local precedente: queso, maíz, pedido/reposición de café y zumos ya bloquean la apertura siguiente. Cantidades y regla de maestría son balance propio, no una transcripción de niveles desconocidos de la referencia. Se conservan provisionalmente los precios de apertura del catálogo, escalados por país; falta calibrarlos.

createCampaignGame prepara compras vacías, cero stock y cultivo inicial en cada local, también los aún no adquiridos. BUY_FRANCHISE cobra una vez y abre sin importar compras, empleados ni trabajo personal; el dinero sigue siendo global y viajar conserva el local anterior. El servidor reconstruye el orden de compras, progreso y aperturas: rechaza propiedad sin evento, saltos de local, importes incorrectos y requisitos completados después del evento de apertura. No permite introducir campaña en una partida legada. La normalización ya no regenera proyectos de construcción del sistema antiguo dentro de la campaña.

GameShell muestra número de local, condición del anterior, tareas completadas y compras pendientes. Archivos: progression/CampaignExpansion.ts y .test.ts, engine.ts, persistence/SaveAuthority.ts, GameShell.tsx y scripts/qa-campaign-expansion.mjs. Verificación de dominio: 542 pruebas en 67 archivos; typecheck, lint y build normal PASS. Pruebas de orden de eventos, apertura a nivel 1, doble compra, guardado/recarga, viaje, bloqueo del tercer local y tareas específicas de queso/maíz/café/zumos.

Límite importante: son las seis ubicaciones existentes con el grafo de compras actual, todavía sin contenido diferenciado por local. No afirmar que estén diseñados los locales avanzados de la referencia ni completada una campaña larga. Quedan productos/animales adicionales, cadenas y desafíos propios por local, balance económico y espacial, marcadores individuales y publicación con reinicio versionado. Sin push ni modificación de producción.

## Economía de campaña — revisión posterior

Navegador PASS (1440×1000 y 390×844): cobro de dos cajas, compra física del cajero, reposición 1/8, guardado/recarga sin bonos restaurados, licencia permanente sin botón de renovación, equipo de pago único y panel financiero coherente. Capturas de finanzas revisadas en ambos tamaños. Evidencia `/tmp/market-campaign-economy-qa-1/report.json`, capturas y vídeos del mismo directorio. API HTTP aislada con validador real; no PostgreSQL, service worker ni teléfono físico. Sin push ni modificación de producción.

Esta sección sustituye el hallazgo histórico de bonos y gastos pendientes que aparece más abajo. Balance propio autorizado: sin bonos diarios, nóminas recurrentes, alquiler automático ni impuestos de campaña. Contrataciones, mercancía, compras y mejoras siguen costando dinero; el personal se contrata con un pago único y la licencia es permanente. Los precios de venta son finales y se registran completos como ingresos, sin deducciones fiscales. Las partidas legadas conservan sus reglas hasta el reinicio de publicación.

El constructor, la normalización y el cierre no regeneran misiones diarias. CLAIM_MISSION se rechaza en campaña, y SaveAuthority rechaza eventos de recompensa legados aunque el cliente introduzca una misión en su snapshot. El cierre conserva cajas pendientes de recoger, compras y trabajo personal; restaura energía y reinicia solo estadísticas diarias. No descontar costes del saldo cero ni gastar automáticamente el dinero de los mostradores. La jornada conserva su duración existente de tres horas reales; no se ha recalibrado aquí.

Archivos responsables: engine.ts (reglas y cierre), persistence/SaveAuthority.ts (rechazo de bonos), GameShell.tsx (equipo/licencia/finanzas/configuración/objetivos), economy/CampaignEconomy.test.ts y register-cash.test.ts. El esquema de persistencia no cambia ni se migran partidas. Verificación de dominio: 532 pruebas en 66 archivos, typecheck, lint y build normal PASS; incluye siete países, ocho cierres con recarga, conservación de caja y progreso, rechazo de bonos falsificados y economía legada intacta. La duración de la campaña completa, locales posteriores y balance de precios productivos siguen pendientes; esto no certifica un año de juego ni autoriza activar la campaña incompleta.

## Trabajo personal y requisitos de compra — integración posterior

QA de interfaz: la captura móvil inicialmente estrecha se tomó durante la transición de ancho. La prueba espera ahora la apertura. Sí existía una regla móvil legada que ocultaba los textos `small`; `.mission.level-requirement small` vuelve a mostrar cantidades y progreso con tamaño de 11 px. El test exige que «1 / 8» sea visible y que `aria-valuenow` coincida con el guardado. No cambiar el ancho del panel para corregir una captura prematura.

Verificación: 522 pruebas en 65 archivos, typecheck y lint PASS. Navegador PASS a 1440×1000 y 390×844: una reposición suma 1/8 personal, persiste al guardar/recargar y se muestra en el panel como texto y valor accesible. Captura móvil final revisada sin recortes; evidencia `/tmp/market-personal-tasks-qa-4/report.json` y vídeos/capturas del directorio. HTTP aislado con validador real, no dispositivo físico ni base de datos. Build normal de producción (sin controles QA) y git diff --check: PASS.

Hallazgo pendiente de balance: siguen vigentes los bonos legados (120 € por reponer siete productos, superior a los 68 € del primer cajero), junto con nóminas, gastos y licencias diarios. Revisar ese sistema conjuntamente; no declarar calibrada la nueva campaña ni retirar solo las recompensas dejando intactos gastos potencialmente incompatibles con su inicio sin capital.

`progression/CampaignTasks.ts` define 16 tareas personales que cubren los doce productos actuales, incluida alimentación de gallinas/vacas, recogida de harina y pedido de café. Solo se muestran las tareas cuyo producto ya está desbloqueado. Primera expansión: cosechar personalmente 8 tomates, reponer 8, alimentar gallinas con 4 y reponer 4 huevos. Molino: cosechar 6 trigos; horno: recoger 3 harinas; departamento lácteo: reponer 4 panes; quesería: alimentar vaca con 2 trigos y reponer 4 leches; naranjo: cosechar 4 manzanas; exprimidora: cosechar 4 naranjas. Son cantidades de balance propio autorizado.

El motor y el panel leen los mismos requisitos. No se cobra ningún aporte antes de cumplirlos. Dinero, nivel legado y producción/reposición de empleados no completan tareas personales. El progreso pertenece a la franquicia en `purchases.personalProgress`, persiste al recargar y no se reinicia al cambiar de día. Los contadores se limitan al objetivo y dejan de producir eventos al completarlo. El resto de tareas (quesos, maíz, café y zumos) queda registrado para maestría; todavía no bloquea locales posteriores porque esos locales aún faltan.

Cada avance personal real del motor emite un evento `player_progress` de importe cero; `SaveAuthority` reconstruye esos deltas y las compras en orden. Rechaza cambios de contador sin eventos y aportes anteriores al trabajo requerido. Esto no convierte el guardado en una simulación completa de todas las acciones en el servidor; no afirmar protección antitrampas total.

Pruebas de esta etapa: empleados trabajando sin completar tareas; expansión rechazada con dinero de sobra; recorrido real de cosecha→reposición→alimentación→huevos→expansión con recarga y validación de todo el lote; interacción fallida sin avance; dependencias sin objetivos inaccesibles. La campaña completa y su balance a largo plazo siguen pendientes. Sin push ni reinicio de producción.

## Desbloqueos espaciales por compra — integración local

## Inicio con un expositor — integración posterior

Typecheck, lint, build normal de producción y `git diff --check`: PASS. Sin push ni reinicio de partidas de producción.

Verificación de esta etapa: 517 pruebas en 64 archivos. Navegador PASS a 1440×1000 y 390×844: recogida, compra del cajero, reposición limitada a 15 tomates, cesta con dos sobrantes y recarga. Evidencia en `/tmp/market-opening-produce-qa-1/report.json`, capturas y vídeos; captura móvil revisada. HTTP aislado, sin PostgreSQL ni teléfono físico. No constituye una prueba de rendimiento sostenido. La expansión conserva unidades en pruebas de dominio; falta su recorrido visual completo.

La nueva campaña comienza con un solo expositor de frutas y un bancal activo. El segundo expositor aparece con la primera expansión (`expansion-side`), sin sustituir ni mover los modelos. La capacidad inicial de tomates pasa a 15 unidades (33 al máximo de mejora); con la expansión pasa a 30 (66 al máximo). Estas capacidades derivan de los huecos de los modelos propios, no se presentan como cifras verificadas de My Mini Mart.

`retail-layout.ts` comparte el número de muebles activos entre capacidad del motor, planificación de reposición, reparto visual y destino de las animaciones. `fixture-availability.ts` elimina también el obstáculo del expositor ausente; solo existe su imán al desbloquearlo. Las pruebas comprueban que una cesta con tres tomates ante un estante con catorce entrega uno y conserva dos, y que expansión y recarga conservan todas las unidades. Siguen existiendo instalaciones auxiliares decorativas: no afirmar que todo el escenario mínimo esté terminado.

### Departamentos y maquinaria

`stations/fixture-availability.ts` comparte disponibilidad entre muebles, colisiones Rapier, sensores de reposición y malla de navegación. En campaña desaparecen hasta su compra los departamentos de huevos, lácteos, café, cereales/panadería y zumos; las cuatro máquinas interiores, el recinto de producción, la segunda caja y los tres corrales. Se mantienen modelos, dimensiones y posiciones. Bancales bloqueados no se dibujan; ya eran transitables y sus sensores se filtran por cultivos activos.

La navegación distingue áreas desbloqueadas además del contador estructural: cambiar de tienda con el mismo contador no reutiliza una malla incompatible. La vista de depuración usa las mismas áreas y no regenera geometría en cada tick. No confundir esta integración con un inicio totalmente mínimo: siguen los expositores de frutas existentes y las instalaciones auxiliares; faltan el balance espacial final y la comprobación de aparición en todas las compras.

Pruebas de dominio actuales: 514 pruebas en 63 archivos; typecheck, lint y build normal de producción correctos (sin controles QA habilitados). La campaña sigue sin publicar. Se mantiene la instrucción vigente de reiniciar desde nivel 1, sin migrar progreso.

Navegador: PASS a 1440×1000 y 390×844, recogida de ambas cajas, compra física del cajero por 68 €, guardado y recarga sin errores de página. Evidencia: `/tmp/market-fixture-unlocks-qa-1/report.json`, capturas y vídeos en el mismo directorio. API HTTP aislada con validador real; no acredita PostgreSQL, service worker ni teléfono físico. Captura móvil revisada: desaparecieron los departamentos no comprados; aún se ven varios expositores de frutas.

### Política de reinicio

Verificación del cambio de alcance: 499 pruebas en 62 archivos, typecheck, lint y build correctos.

Orden posterior del propietario: «no migres partidas, deja todo desde el nivel 1». Esta instrucción sustituye los apartados históricos que pedían heredar progreso. La nueva campaña empezará desde nivel 1, sin dinero, compras, empleados ni niveles heredados. Se conservan el catálogo y los recursos gráficos del proyecto.

El motor ya no permite entrar en la campaña nueva mediante una compra desde una partida antigua; el servidor tampoco acepta introducir compras heredadas por esa vía. El reinicio de producción queda pendiente de la publicación completa: respaldo recuperable previo, nueva generación de guardado y aislamiento de la recuperación local para que una copia vieja no restaure progreso anterior. No se han borrado ni reiniciado partidas de producción. Las funciones de inferencia legada que aún queden en pruebas no se usarán para trasladar progreso.

Fecha de trabajo: 15-09-2026. Estado: integración parcial local de caja y alimentación; **campaña completa todavía pendiente, sin push ni despliegue**.

## Alcance autorizado

Trasladar mecánicas y progresión de My Mini Mart (Supersonic / Kiseki, App Store `1592004814`, Android `com.KisekiGames.smart`) al juego existente. Mantener personajes, GLB, muebles, animales, cámara y carritos aprobados. No copiar código ni recursos de la referencia. Sin publicidad, compras con dinero real ni desbloqueos que requieran anuncios. El propietario autorizó push a main **cuando esté todo terminado y probado**, no un despliegue parcial.

Ampliación autorizada el 15-09-2026: ante la pregunta de añadir los productos y máquinas ausentes con recursos propios sin sustituir los actuales, el propietario respondió «sí». Se adopta la opción recomendada de añadir lo que falte; no adaptar silenciosamente carne, pescado o conservas a productos diferentes. No hace falta volver a pedir esa misma autorización.

Fuente normativa del inicio: `Descargas/NIVELES SUPERMERCADO.zip`, miembro `NIVELES SUPERMERCADO.md` (3.869 bytes). Sus cantidades y diferencias expresas prevalecen sobre vídeos de otras versiones.

Autorización posterior del propietario: completar datos ausentes con diseño y balance propios, incluir vacas y nuevas especies, y tomar decisiones de implementación sin nuevas consultas rutinarias. El horizonte deseado es una campaña que pueda acompañar al jugador durante un año. Es una meta de contenido y retención, no una duración verificada ni una promesa de ingresos. No se añaden esperas obligatorias de meses para alcanzar esa cifra.

## Investigación: qué se conoce y qué no

La [ficha oficial de Google Play](https://play.google.com/store/apps/details?id=com.KisekiGames.smart&hl=en) identifica el ciclo cultivo → animales → transformación → contratación → ampliación. La [ficha oficial iOS](https://apps.apple.com/us/app/my-mini-mart/id1592004814) corresponde al ID entregado. No confundir con “My Mart” de otros desarrolladores ni con otra aplicación llamada “My Mini Mart: Supermarket Game”.

Una [guía de Gamezebo](https://www.gamezebo.com/walkthroughs/my-mini-mart-strategy-guide-stock-the-shelves-with-these-hints-tips-and-cheats-2/) describe trabajo por desplazamiento, contratación y capacidad de carga, además de alimentar ganado. No ofrece una tabla exhaustiva de desbloqueos.

Un [análisis de balance publicado en Habr en 2023](https://habr.com/ru/articles/712560/) midió ingresos y costes de paso entre locales. Documenta un aumento importante de costes frente al ingreso jugando y a las recompensas de anuncios. Es evidencia histórica, no una tabla de precios vigente. **No copiar esos importes sin anuncios y afirmar que el ritmo será equivalente**: hace falta medir ingresos y tiempo de compra en nuestra implementación.

### Catálogo de partidas públicas localizado

Se consultó el [canal de Sunny Mobile](https://www.youtube.com/channel/UCk_QUVyYL4AMTYZozRld3xg) mediante sus metadatos públicos. Los siguientes enlaces son un índice de evidencia pendiente de transcripción visual completa. Los títulos “Part N” no significan “Mart N”; las etiquetas de los directorios de guías tampoco prueban un número de locales.

| Local / tramo | Partida localizada | Qué acredita ahora |
| --- | --- | --- |
| Inicio | [Partida inicial](https://www.youtube.com/watch?v=20RQvSxV4L8), [parte 2](https://www.youtube.com/watch?v=ZS79cscqGGA), [nuevas zonas](https://www.youtube.com/watch?v=nipaaavS5jE) | Localizadores del proceso inicial; cifras del ZIP son la regla de nuestro juego |
| Locales 1 y 2 | [Ambos desarrollados](https://www.youtube.com/watch?v=keRXo2qtCFE), [mejoras del local 2](https://www.youtube.com/watch?v=Tk6ImUT9HSo) | Existencia de progresión dentro de cada local |
| Local 3 | [Desarrollado](https://www.youtube.com/watch?v=urLpHU1FxWw) | Existencia de ese local; no acredita por sí solo recetas o costes |
| Local 4 | [Apertura](https://www.youtube.com/watch?v=gjwV_Y-CxLQ), [desarrollado](https://www.youtube.com/watch?v=ozIQaedFqII) | Dos momentos de una misma progresión |
| Local 5 | [Apertura](https://www.youtube.com/watch?v=PgMKtcxN5zo), [desarrollado](https://www.youtube.com/watch?v=CatZAYX6N5E) | Título y descripción localizados |
| Local 6 | [Apertura](https://www.youtube.com/watch?v=PbMT9v19UBI), [desarrollado](https://www.youtube.com/watch?v=FIMzULtteVk) | Metadatos públicos obtenidos; apertura dura 486 segundos |
| Local 7 | [Apertura](https://www.youtube.com/watch?v=1zbpXrjoXEQ), [desarrollado](https://www.youtube.com/watch?v=qo_h1y0cg5Y) | Título y descripción localizados |
| Local 8 | [Apertura](https://www.youtube.com/watch?v=3CatuHc5nls), [desarrollado](https://www.youtube.com/watch?v=jb2JogJioJA) | Título y descripción localizados |
| Local 9 | [Apertura](https://www.youtube.com/watch?v=n7ClqVvNbKY), [desarrollado](https://www.youtube.com/watch?v=20roR1h5L7U) | Título y descripción localizados |
| Local 10 | [Apertura](https://www.youtube.com/watch?v=O3leGsBQw78), [desarrollado](https://www.youtube.com/watch?v=YaSEdzXuWbA) | Título y descripción localizados |
| Local 11 | [Desarrollado](https://www.youtube.com/watch?v=PlshUGXa_hw) | Localizador de partida |
| Local 12 | [Apertura](https://www.youtube.com/watch?v=0vumWfxDvbo), [desarrollado](https://www.youtube.com/watch?v=j4rXKgcNyBs) | Localizadores de partida |
| Local 13 | [Apertura](https://www.youtube.com/watch?v=50topipsb9c), [desarrollado](https://www.youtube.com/watch?v=wzv4_hjnqtc) | Localizadores de partida |
| Local 14 | [Apertura](https://www.youtube.com/watch?v=vgOlAMcSTLM), [desarrollado](https://www.youtube.com/watch?v=vyDHLe05iOM) | Publicaciones de abril de 2023: existe al menos ese local, no prueban que sea el máximo actual |

Los vídeos de eventos (Pascua, San Valentín, Navidad, aniversario) están separados de la campaña. No contarlos automáticamente como locales permanentes. No se han instalado APK modificados, usado cuentas del usuario ni comprado nada. La descarga del vídeo inicial devolvió HTTP 403; disponer de su título o storyboard de baja resolución no equivale a haber visto toda su partida.

### Fotogramas contrastados en navegador

Después del fallo de descarga, se reprodujeron los vídeos públicamente en Chrome sin iniciar sesión, rechazando las cookies opcionales. Se verificaron fotogramas en los instantes siguientes; **esto no equivale a transcribir todos los desbloqueos del vídeo**. Las cantidades que aparecen encima de una entrada de máquina son existencias/capacidad, no precios de compra.

| Fuente e instante | Observación visual | Implicación para nuestro juego |
| --- | --- | --- |
| [Inicio, 0:30](https://www.youtube.com/watch?v=20RQvSxV4L8&t=30s) | Caja atendida personalmente, expositor de tomates, bancal y marcador de compra en el suelo | Confirma el tipo de interacción; prevalecen los importes del ZIP, no el precio histórico del vídeo |
| [Inicio, 4:00](https://www.youtube.com/watch?v=20RQvSxV4L8&t=240s) | Un bancal con dos plantas de tomate y otro bancal vacío | No confundir número de plantas visibles con número de niveles |
| [Inicio, 7:50](https://www.youtube.com/watch?v=20RQvSxV4L8&t=470s) | Cajero contratado, billetes acumulados junto a caja, expositor de huevos, comedero con tomate 1/4 y jugador con tres tomates; mejora SPEED en el suelo | Confirma visualmente caja pendiente y alimentación. El marcador SPEED muestra 15 en esa versión; no sustituye la mejora conjunta de 102 € del ZIP |
| [Parte 2, 1:00](https://www.youtube.com/watch?v=ZS79cscqGGA&t=60s) | Otro bancal con marcador 300 y mejora CARRY con marcador 30 | Son importes históricos observados; no se deduce de este fotograma si 300 es precio original o aportación restante |
| [Parte 2, 7:00](https://www.youtube.com/watch?v=ZS79cscqGGA&t=420s) | Estante de tomates y otro de conservas de tomate junto a una máquina con entrada de tomates | El contenido nuevo aparece pronto: actualmente `ProductId` no tiene conserva de tomate |
| [Locales 1 y 2 desarrollados, 4:00](https://www.youtube.com/watch?v=keRXo2qtCFE&t=240s) | Tienda de suelo azul, árbol y expositor de manzanas, cajero y empleado transportando manzanas | La referencia cambia la cadena inicial entre locales; no exige empezar todos por tomate |
| [Local 5 desarrollado, 4:00](https://www.youtube.com/watch?v=CatZAYX6N5E&t=240s) | Dos vacas, bandejas de alimento con contadores 6/6 y 5/6 y salida visible de carne roja | La vaca actual de nuestro juego solo tiene cadena de leche; reutilizar su modelo no resuelve la receta, inventario o producto de carne |
| [Local 6 desarrollado, 4:00](https://www.youtube.com/watch?v=FIMzULtteVk&t=240s) | Dos aparatos distintos con entrada vegetal 3/4 y 2/4 y expositor de piezas de pescado | Faltan productos y estaciones específicos; este fotograma solo no determina toda la receta |
| [Local 14 desarrollado, 4:00](https://www.youtube.com/watch?v=vyDHLe05iOM&t=240s) | Vaca con salida de carne y expositores de carne y platos preparados | Cambiar únicamente la tabla de niveles no reproduce las cadenas del local |

**Decisión de alcance resuelta:** se añadirán productos/estaciones propios sin sustituir los actuales. No se sustituyen recetas por productos diferentes para evitar crear recursos. La autorización permite implementar lo que falte; no convierte las recetas o precios todavía sin transcribir en datos confirmados.

Catálogo actual verificado en `src/game/types.ts`: trigo, harina, pan, maíz, leche, huevos, queso, manzanas, tomates, naranjas, café y zumo. No contiene conserva de tomate, carne ni pescado. No se ha añadido contenido visual de los vídeos al juego ni al repositorio.

## Inicio especificado por el propietario

Precio base actual de contratación del cajero en ES: 34 € de salario base × 2 = 68 €. Los cálculos usan unidades menores enteras y la escala de país existente.

| Compra / regla | Dependencia | Valor normativo |
| --- | --- | --- |
| Empezar | Ninguna | Una planta de tomate, un expositor y una caja; sin demás muebles activos |
| Tomates | Cultivo | 8 por planta; venta a 1 € por unidad |
| Clientes | Tienda operativa | Dos simultáneos; cesta de una unidad con ocasiones de dos |
| Cajero | Ganar y recoger dinero | 68 € |
| Estante de huevos | Cajero | 68 € |
| Gallina | Estante | 102 € |
| Primera mejora del propietario | Primera etapa | 102 €; carga 3→4 y velocidad ×1,03 |
| Velocidad inicial del propietario | Inicio | 70 % de su máximo |
| Alimentación | Tomates llevados personalmente | Cuatro de capacidad; cada tomate produce un huevo en dos segundos |
| Huevos | Gallina comprada | Venta a 2 € |
| Granjero-reponedor | Gallina | 204 €; cosecha, repone y recoge huevos; no alimenta |
| Capacidad y velocidad del granjero inicial | Contratación | 3 unidades; 70 % de la velocidad inicial del propietario |
| Segunda planta de tomate | Etapa de gallina | 102 € |
| Otra planta antes de ampliar | Segunda planta | 178,50 €; interpretación: tercer bancal |
| Gallina nivel 2 | Gallina comprada | 204 €; un huevo por segundo |
| Gallina nivel 3 | Nivel 2 | Comedero de seis tomates; precio no especificado |
| Primera expansión | Granjero contratado | Abre posibilidad de otro granjero-reponedor, trigo y segunda gallina; precio no especificado |

Compras y dinero forman estados separados:

```text
Venta confirmada → dinero pendiente en caja
                      ↓ visita del propietario
                 dinero recogido
                      ↓ visita a zona de compra
                 aporte parcial persistido
                      ↓ coste totalmente pagado
                 compra aplicada una sola vez
                      ↓ dependencias satisfechas
                 siguiente compra disponible
```

La mejora del propietario está provisionalmente disponible desde la compra del estante, para poder adquirir carga cuatro antes de alimentar la gallina. Se puede alimentar con tres sin esperar esa mejora: el comedero admite hasta cuatro, no exige un lote completo. El límite de salida de ocho huevos del módulo experimental es una decisión técnica provisional, no un dato atribuido a la referencia. La probabilidad exacta de comprar dos unidades no viene en el ZIP y no se ha inventado.

## Primeros módulos y comprobaciones históricas

- `src/game/progression/MartCampaign.ts`: grafo del inicio, costes relativos, caja pendiente, recogida, financiación parcial, conservación de dinero y prestaciones iniciales. No concede compras con dinero todavía en la caja. Un coste desconocido permanece sin cotización, no se vuelve gratuito.
- `src/game/stations/FedChicken.ts`: comedero, consumo por ciclo, huevos acumulados, recogida durante producción, mejoras de tasa/capacidad y reloj de simulación. Recargar no adelanta el ciclo; recoger no cancela el siguiente huevo.
- Pruebas de ambos módulos: 33 casos, incluidos 2.000 pasos de operaciones monetarias mezcladas y recargas JSON.
- Verificación local completa: `pnpm typecheck`, `pnpm lint`, `pnpm test` (411 pruebas en 56 archivos) y `pnpm build`, correctos. Esto acredita ausencia de regresión en la base actual, **no** una aceptación de la campaña nueva todavía sin conectar.

En aquella comprobación ambos módulos estaban aislados. La integración posterior de alimentación y recogida se detalla a continuación; el grafo de compras de `MartCampaign.ts` sigue sin activar.

### Preparación integrada del catálogo y guardado

`economy/ProductRegistry.ts` unifica los identificadores persistidos de productos, cultivos y salidas de máquinas. Ya lo consumen `types.ts`, `engine.ts`, `StationSystem.ts`, `economy/products.ts`, `lib/game-validation.ts` y `persistence/SaveAuthority.ts`. Se elimina la divergencia entre listas manuales del cliente y servidor. Las recetas rechazan ingredientes que no existan en el registro.

Este paso conserva los doce productos actuales y el esquema 4. **Todavía no añade conservas, carne o pescado a la partida**: un identificador nuevo requiere también catálogo económico, migración, representación, puntos de interacción, producción y desbloqueo. No asignar un precio o receta sin evidencia para simular que ya está terminado.

Las pruebas del contrato comprueban correspondencia de catálogo e inventario, inventarios independientes, configuración de todas las máquinas y cultivos, conservación de cantidades/dinero/avatar al restaurar y rechazo de productos desconocidos, campos ausentes y cantidades inválidas. Los imports ejecutables de la validación usan rutas relativas porque la configuración actual de Vitest no resuelve el alias `@/` en tiempo de ejecución.

Verificación posterior a esta integración: **429 pruebas en 57 archivos**, typecheck, lint y build correctos. Sin commit, push ni cambios en producción: todavía no se cumplen los criterios de publicación de la campaña completa.

## Compras conectadas al motor — 15-09-2026

La integración local ya no es solo un grafo aislado. `createCampaignGame` crea una partida sin dinero ni stock y `CONTRIBUTE_PURCHASE` aplica aportes parciales, descuenta el bolsillo y desbloquea estaciones/empleados una sola vez. `PurchaseState` conserva aportes y compras al recargar; el servidor reconstruye los aportes y rechaza compras heredadas o importes inventados.

El inicio prueba ocho tomates por cosecha, dos clientes con cesta pequeña, tomate a 1 € y huevo a 2 € finales (escala por país). Velocidad inicial del jugador: 70 % del máximo; primera mejora: +3 % relativo y carga de cuatro. El granjero recoge cosecha y huevos, toma excedentes del almacén y repone, sin alimentar animales. Se han añadido anclajes de tercera tomatera y segunda gallina usando recursos existentes; las pruebas de rutas y separación de sensores pasan.

El panel permite seleccionar una compra y señalar un círculo compartido en el mundo. Permanecer en él aporta dinero a esa compra; completar una no selecciona ni cobra automáticamente otra. No están terminados los marcadores individuales por instalación. El recorrido HTTP aislado de escritorio y viewport móvil comprobó compra de cajero, cobro exacto de 68 €, guardado y recarga: `/tmp/market-purchase-flow-qa-1/report.json`. Esa evidencia corresponde al build anterior a los últimos ajustes de contratación; no acredita producción ni dispositivos físicos.

Las contrataciones auxiliares dependen ahora de compras, no de XP: operario tras molino; reponedor/constructor y cajeros adicionales tras ampliación (cajero inicial comprado); más granjeros después de comprar el segundo. Gerente tras quesería, zumos y café. Estos requisitos son balance propio autorizado. La compra inicial del jugador abre las mejoras siguientes aunque el nivel legado siga en 1. Mejoras genéricas no saltan la primera expansión ni los tiers dedicados de gallina/vaca; no mejoran máquinas bloqueadas.

Verificación más reciente: **498 pruebas en 62 archivos**, typecheck, lint y build de producción correctos. Mantener resultados históricos de abajo como evidencia de etapas, no como estado actual.

Pendientes de publicación: inicio visual vacío con obstáculos/sensores coherentes, migración integral (especialmente avance legado pendiente de sincronizar antes de primera compra), locales y productos nuevos, misiones personales y balance completo, UI de mapa/avance, recorrido de aceptación completo. La API de creación todavía usa el constructor legado; no activar hasta cerrar estos puntos. Sin push ni despliegue. No se ha certificado una campaña comercial completa ni un año de duración.

## Integración local posterior: cajas y alimentación

Última verificación: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, correcta; **454 pruebas en 59 archivos**. La UI del comedero todavía requiere aceptación visual en navegador; estos resultados no certifican la campaña completa.

- Las ventas dejan el importe en `registerCashMinor` por caja y franquicia. La recogida física lo pasa al bolsillo una sola vez; el HUD diferencia disponible y pendiente. No vuelve a registrar ingresos al recoger.
- El validador compara bolsillo más todas las cajas con los eventos y reconstruye transferencias por caja. Rechaza traslados sin evento, cantidades inválidas y duplicados. Las partidas anteriores conservan el bolsillo; solo un snapshot antiguo confirmado por el servidor permite aceptar ventas pendientes del formato anterior. Se mantiene la repetición idempotente de operaciones antiguas.
- Pruebas de navegador de caja: escritorio 1440×1000 y viewport móvil 390×844, desplazamiento real, dos recogidas, guardado y recarga correctos. Evidencia: `/tmp/market-register-cash-qa-3/report.json`. API aislada con el validador real; no acredita dispositivos físicos, PostgreSQL ni actualización del service worker.
- Las gallinas del motor consumen tomates: capacidad 4, o 6 en tier 3; ciclos de 2 s, o 1 s desde tier 2. Recoger huevos conserva el ciclo activo. La adaptación mantiene los campos persistidos de máquina y la capacidad de salida existente, no introduce el límite experimental de ocho. Una producción antigua ya iniciada conserva su vencimiento; las siguientes requieren alimento.
- La escena mantiene los modelos aprobados y añade contador de alimento/salida y etiqueta de interacción. La reconciliación visual incluye los cambios del comedero.
- Se corrige el recuento doble de producción cuando una interacción de cesta llena falla antes de actualizar el mundo. Las pruebas cubren el motor, recarga JSON, capacidad, tiempos fraccionarios y compatibilidad del ciclo antiguo.

Pendientes que impiden publicar: activar el inicio vacío y grafo de compras, granjero combinado, demanda y precios iniciales, expansiones y locales posteriores, productos ausentes, migración integral, balance sin anuncios y aceptación visual/funcional completa. La autorización para balance propio ya está concedida: no pedirla de nuevo. No presentar la tabla parcial como transcripción exhaustiva de todos los niveles.

## Ampliación original: animales y campaña larga

### Cobertura de todo el contenido actual — actualización posterior

No se limita la campaña a animales/panadería/lácteos. Se incorporan al grafo preparado manzano, maíz, suministro de café, naranjo y exprimidora, conservando los doce productos. `CAMPAIGN_PRODUCT_REQUIREMENTS` asigna dependencias a todos los IDs: añadir un producto sin darle un recorrido provoca error de tipos. Las pruebas verifican que las dependencias de cada receta sean accesibles antes que su producto final.

Cambio activo local: `ProductSupply.ts` unifica procedencia y demanda. Trigo y harina, hasta ahora ausentes de las listas de compra de clientes pese a disponer de estantes, se venden desde sus desbloqueos actuales 4 y 5. Las reservas de materias primas siguen protegiendo producción; solo el excedente va al estante. Café conserva su proveedor Andes. Maíz, manzanas, naranjas y zumo conservan sus estaciones.

Verificación: **487 pruebas en 61 archivos**, typecheck, lint, build y `git diff --check` correctos. Recorridos de dominio para todos los productos: suministro/cosecha/producción, transporte y reposición. El café prueba entrega única después de recargar; las máquinas prueban recarga a mitad de producción. Estas pruebas no sustituyen navegación y aceptación visual completas.

Pendiente: conectar el grafo preparado a compras físicas, aplicar desbloqueos y migración integral, ampliar con productos nuevos y completar la campaña. Sin commit, push ni despliegue de la reestructuración.

Implementado localmente:

- `FedAnimal.ts` centraliza consumo, producción continua y recogida para gallinas y vacas. `FedChicken.ts` queda como adaptador compatible, sin duplicar el algoritmo.
- Vacas: un trigo por leche, comedero 6/6/8 y ciclos 6/4/3 segundos según mejora. Balance original, no transcripción de My Mini Mart. Se conserva la vaca GLB entregada y sus animaciones. El mostrador de alimento y leche refleja el estado real; falta aceptación visual de este cambio.
- El grafo preparado incorpora primera expansión (408 €), segundo granjero, trigo, segunda gallina, molino, horno, lácteos, vaca, mejoras y quesería. Gallina tier 3 cuesta 306 €. Son costes originales iniciales, escalados por país y pendientes de calibración de ritmo; el grafo aún no gobierna la partida activa.
- Verificación local: **461 pruebas en 60 archivos**, typecheck, lint y build correctos. Incluye vaca sin alimento, insumo incorrecto, mejoras, recogida sin reinicio, recarga y producción legada. Sin push ni despliegue.

Dirección de contenido aprobada, todavía no implementada:

1. Mercado de barrio: tomates, huevos, trabajo manual y primer equipo.
2. Cereales y panadería: asignar trigo entre harina, pan y alimentación.
3. Granja lechera: vacas, leche, queso y reparto entre venta directa y transformación.
4. Huerta y frutales: variedad de pedidos y zumos.
5. Conservas y despensa: cadenas de varios pasos y compromisos de stock.
6. Apicultura: abejas, miel y productos elaborados; añadir recursos propios.
7. Lácteos especializados: cabras y recetas diferenciadas; no sustituir las vacas.
8. Acuicultura: peces y cadena de frío, con nuevos recursos y estaciones.
9. Comida preparada: combinar productos de las cadenas anteriores.
10. Mercados regionales: demandas, surtidos y restricciones operativas distintos.
11. Red de supermercados: especialización y logística entre locales.
12. Maestría: desafíos y encargos de alta dificultad, cierre de campaña y juego posterior opcional.

Contrato de diseño: cada capítulo debe introducir decisiones nuevas, misiones personales y mejoras útiles. Los empleados ayudan a producir pero no completan objetivos personales. No bloquear avance por anuncios, fechas reales, rachas perdidas o pagos. La campaña tiene final; el juego posterior no lo sustituye. No poblar todos los locales ni animales simultáneamente en la escena móvil. Duración a estimar con simulación económica y sesiones reales antes de publicitarla.

## Análisis de impacto y orden de integración pendiente

1. **Referencia y datos**: transcribir compras, dependencias y expansión de los locales localizados. Registrar versión, minuto del vídeo, dato observado y confianza. No deducir recetas de emojis del título. No inventar una campaña de 30 niveles para rellenar ausencias.
2. **Estado y autoridad**: `types.ts`, `engine.ts`, `lib/game-validation.ts`, `persistence/SaveAuthority.ts`, `Snapshot.ts`, `store.ts` y pruebas. La venta registra ingreso económico; recoger solo mueve ese ingreso de caja a bolsillo, sin contarlo como segunda venta. Eventos idempotentes y aportes exactos.
3. **Migración**: conservar dinero, inventario, empleados, avatar y compras de partidas existentes. No resetear cuentas para mostrar el inicio vacío. Identificar compras legadas de forma determinista y validar tanto snapshot actual como siguiente con la misma versión.
4. **Producción y personal**: `StationSystem.ts`, `products.ts`, IA de `engine.ts`, `CustomerBrain.ts`. Separar alimentar de recoger; granjero combinado con reparto por necesidad y reservas, cajero fijo, demanda solo con cadena desbloqueada, cupo inicial de dos. Mantener carritos y secuencia de caja.
5. **Mundo**: `MarketScene.tsx`, `MarketKit.tsx`, contratos de presentación, `stations/`, colliders y navegación. Ocultar muebles no comprados también de obstáculos y sensores; conservar dimensiones/modelos y sus posiciones aprobadas. Marcadores de compra accesibles y sin solapamientos. El contador restante refleja el estado, no una cuenta independiente de la animación.
6. **Interfaz**: `GameShell.tsx` y paneles. Progreso por compras/local, dinero recogido frente a pendiente, dependencias visibles, mejoras por objeto. Eliminar atajos de la campaña antigua que permiten saltarse los nuevos requisitos. Mantener estilo gráfico y controles existentes.
7. **Balance sin anuncios**: simular tiempo de primera contratación, huevos, granjero, expansión y posteriores cadenas con distancias reales. Retirar del nuevo balance recompensas o capital inicial que permitan saltarse el inicio. No copiar costes diseñados alrededor de bonificaciones publicitarias sin comprobar jugabilidad.
8. **Aceptación**: recorrido completo desde cero, avance mediante interacción física, guardar durante aporte/alimentación, carga legada, ACK perdido, conflicto entre dispositivos, bloqueo de doble cobro, navegador móvil y presupuesto de render.
9. **Publicación**: solo después de completar la integración; typecheck, lint, suite, build, backup pertinente, push autorizado, CI y verificación pública.

## Criterios que bloquean publicación

- Un nombre/título de vídeo no demuestra la secuencia interna del local.
- Ningún desbloqueo depende de anuncios ni de una receta sin estación o producto disponible.
- No se destruyen las partidas anteriores ni se reemplazan GLB aprobados.
- No hay muebles invisibles que sigan bloqueando el paso.
- Toda venta y recogida respeta conservación de dinero; no se paga dos veces al reconectar.
- No se describe esta primera base como reestructuración completa o ya desplegada.

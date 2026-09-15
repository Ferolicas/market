# Mini Market — mapa vivo

## Velocidad −20 % y cámara solidaria — 15-09-2026

La calibración vigente reduce un 20 % todos los tiers de velocidad de campaña: T1 8,316 y máximo 11,088 unidades/s. Se conserva el inicio al 75 % del máximo y la progresión de mejoras, con aceleración/frenado proporcionales. Sin reinicios ni cambios de economía o guardado.

OverviewCamera copia la posición/objetivo calculados desde la cápsula interpolada, sin el segundo amortiguado exponencial (2,8/s) que generaba retraso creciente al correr en cualquier dirección. Orden de frame explícito: Rapier updatePriority −2 → presentación Player −1 → cámara 0. La transición de composición y zoom al atender caja sigue suavizada. QA privada publica cámara/posición presentada; MARKET_QA_CAMERA=1 node scripts/qa-speed-patience.mjs comprueba seguimiento sin un frame de retraso al acelerar, girar y frenar en escritorio y viewport móvil. El modo normal del script conserva la prueba de paciencia.

Caja: el propietario ya no se oculta al operar; cámara cercana desde detrás del propietario hacia el comprador, marco ortográfico 10×10 en vez de 39×27, posición [8.8,3.2,6.8] y objetivo [7.35,1.25,3.55] en coordenadas de layout. Los gestos compartidos GESTODECAJA (CheckoutItem/Pay/CheckoutScan/CheckoutBag/ScanItem) conservan brazos y torso, con pelvis/piernas de la pose Idle de cada rig para evitar flexión de asiento; composición cacheada sin modificar GLB ni clips originales. checkoutParkedCart define ancla lateral por carril, también al aproximarse: un punto a la derecha y detrás de customerFront. La presentación deja de pegar el carrito a las manos durante el cobro; retoma el seguimiento al salir, sin deformar metal ni estirar brazos con IK.

QA: 573 pruebas de dominio, typecheck/lint/build; seguimiento en las cuatro direcciones, aceleración y frenado PASS escritorio/móvil (/tmp/market-camera-follow-qa/report.json). MARKET_QA_CHECKOUT=1 ejecuta recorrido físico a caja, verifica jugador visible, transición cercana y carrito lateral en hombre/mujer; capturas y vídeos /tmp/market-checkout-close-final. El fixture HTTP no modifica cuentas ni guardados reales. Sin certificación de teléfono físico ni cambio de escala de muebles/productos.

## Ajuste de velocidad y paciencia — 15-09-2026

La campaña inicia a 10,395 unidades de layout/s: exactamente 2,5 veces sus anteriores 4,158. Es el 75 % del nuevo máximo (13,86); T2 conserva el +3 % relativo anunciado y T3–T10 crecen hasta el máximo. PlayerController escala también aceleración/frenado y conserva la calibración legada. No reinicia ni modifica el progreso guardado.

CustomerPatience centraliza 120.000 ms de simulación activa para espera de producto y caja. La espera de un producto no se reinicia por reintentos de acceso ni por ver stock: se limpia al completar su recogida. Al agotarse, se libera la reserva, se marca angry, se muestra el clip existente Impatient durante 1,5 s con locomoción detenida y se recorre devolución de mercancía no pagada → carro → salida. La cola también abandona a los dos minutos. Carga de partidas normaliza ambos límites sin borrar clientes ni inventario; no hay cambios de esquema, reset ni nueva versión de campaña. La pausa de aplicación mantiene detenida la simulación.

Impacto: PlayerController y pruebas, CustomerBrain, CustomerPatience, engine, presentación Customer, prueba de cosecha al pasar por los diez tiers. Verificación: límites de 119,9/120 s, reacción y salida con/sin mercancía, devolución sin cobrar, reposición sin reiniciar plazo, recogida exitosa y restauración.

QA local PASS: 571 pruebas/73 archivos, typecheck, lint y build. Navegador con HTTP aislado y render/física reales, escritorio 1440×1000 y móvil 390×844: scripts/qa-speed-patience.mjs confirma speedCap 10,395, selección del clip Impatient y salida completa (/tmp/market-speed-patience/report.json, vídeos); la captura móvil no encuadra al cliente y no se usa como aprobación visual de su pose. qa-register-cash con compras/reposición PASS en ambos tamaños (/tmp/market-fast-register-qa/report.json): cobro de las dos cajas, compra física del cajero, reposición, guardado y recarga. No prueba un teléfono físico.

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

Actualizado: 2026-09-15.

## Compras conectadas al motor — 15-09-2026

La integración local ya no es solo un grafo aislado. `createCampaignGame` crea una partida sin dinero ni stock y `CONTRIBUTE_PURCHASE` aplica aportes parciales, descuenta el bolsillo y desbloquea estaciones/empleados una sola vez. `PurchaseState` conserva aportes y compras al recargar; el servidor reconstruye los aportes y rechaza compras heredadas o importes inventados.

El inicio prueba ocho tomates por cosecha, dos clientes con cesta pequeña, tomate a 1 € y huevo a 2 € finales (escala por país). Velocidad inicial del jugador: 70 % del máximo; primera mejora: +3 % relativo y carga de cuatro. El granjero recoge cosecha y huevos, toma excedentes del almacén y repone, sin alimentar animales. Se han añadido anclajes de tercera tomatera y segunda gallina usando recursos existentes; las pruebas de rutas y separación de sensores pasan.

El panel permite seleccionar una compra y señalar un círculo compartido en el mundo. Permanecer en él aporta dinero a esa compra; completar una no selecciona ni cobra automáticamente otra. No están terminados los marcadores individuales por instalación. El recorrido HTTP aislado de escritorio y viewport móvil comprobó compra de cajero, cobro exacto de 68 €, guardado y recarga: `/tmp/market-purchase-flow-qa-1/report.json`. Esa evidencia corresponde al build anterior a los últimos ajustes de contratación; no acredita producción ni dispositivos físicos.

Las contrataciones auxiliares dependen ahora de compras, no de XP: operario tras molino; reponedor/constructor y cajeros adicionales tras ampliación (cajero inicial comprado); más granjeros después de comprar el segundo. Gerente tras quesería, zumos y café. Estos requisitos son balance propio autorizado. La compra inicial del jugador abre las mejoras siguientes aunque el nivel legado siga en 1. Mejoras genéricas no saltan la primera expansión ni los tiers dedicados de gallina/vaca; no mejoran máquinas bloqueadas.

Verificación más reciente: **498 pruebas en 62 archivos**, typecheck, lint y build de producción correctos. Mantener resultados históricos de abajo como evidencia de etapas, no como estado actual.

Pendientes de publicación: inicio visual vacío con obstáculos/sensores coherentes, migración integral (especialmente avance legado pendiente de sincronizar antes de primera compra), locales y productos nuevos, misiones personales y balance completo, UI de mapa/avance, recorrido de aceptación completo. La API de creación todavía usa el constructor legado; no activar hasta cerrar estos puntos. Sin push ni despliegue. No se ha certificado una campaña comercial completa ni un año de duración.

## Reestructuración de campaña en preparación (sin activar)

Cobertura completa del catálogo (integración local): `economy/ProductSupply.ts` registra fuente y nivel legado de los doce productos y alimenta `objectives.ts`. Trigo y harina antes tenían estantes pero faltaban en demanda: ahora se venden desde nivel 4 y 5 respectivamente, al abrir sus fuentes. Se conserva la reserva de recetas de los reponedores. Café mantiene Origen Andes; maíz y frutas mantienen sus cultivos y zumo su exprimidora. El grafo preparado de `MartCampaign.ts` contiene compras para los doce productos y `CAMPAIGN_PRODUCT_REQUIREMENTS` exige cobertura exhaustiva por tipo. `ProductSupply.test.ts` prueba dependencias, fuente antes de demanda, pedido de café con recarga, y cosecha/producción→cesta→estante para el resto. Última comprobación: 487 pruebas en 61 archivos, typecheck, lint y build PASS. No equivale a campaña nueva activada; sin push.

El propietario autorizó añadir productos y máquinas propios que falten, conservando todos los modelos aprobados. `economy/ProductRegistry.ts` es ya la fuente compartida de IDs para tipos, inventarios del motor, recetas, estaciones y validación del guardado cliente/servidor. Mantiene los doce IDs existentes y el esquema 4; no activa productos nuevos sin sus demás consumidores. Pruebas de contrato en `economy/ProductRegistry.test.ts`. Usar imports relativos en código ejecutable de `lib/game-validation.ts`: Vitest no resuelve el alias `@/` actualmente.

`docs/MY-MINI-MART-RESTRUCTURE.md` registra la referencia My Mini Mart y el inicio normativo del ZIP. `progression/MartCampaign.ts` sigue preparado pero sin activar: la campaña antigua aún gobierna niveles y compras. La rama local sí integra dinero retenido en cada caja (`registerCashMinor`, acción `COLLECT_REGISTER`, marcadores y HUD), validación de conservación por caja y migración de snapshots anteriores (`persistence/RegisterCompatibility.ts`). `stations/FedChicken.ts` ya lo consume `StationSystem.ts`: tomates → huevos, comedero 4/6, ciclos 2/1 s y recogida sin cancelar producción; `MarketKit` muestra alimento y salida. `scripts/qa-register-cash.mjs` prueba desplazamiento y recogida en navegador con HTTP aislado y validador real, sin base de datos. No publicar como campaña terminada hasta completar compras, expansión, migración integral, navegación y UI. Mantener intactos GLB y partidas existentes.

## Recursos entregados, animales y personalización (15-09-2026)

Actualización local de campaña: autorizado balance propio y nuevas especies sin nuevas consultas rutinarias. `stations/FedAnimal.ts` es ahora el motor compartido de alimentación; `FedChicken.ts` es un adaptador compatible. Gallinas consumen tomates; vacas consumen trigo, comedero 6/6/8, ciclos 6/4/3 s. `engine.ts` no inicia leche sin insumos; las recogidas mantienen ciclos activos. `MartCampaign.ts` amplía el grafo preparado hasta quesería y asigna los precios antes desconocidos, pero no activa aún la campaña. Verificación: 461 pruebas, typecheck, lint y build; aceptación visual de vacas pendiente. No desplegado.

- `public/models/market/delivered/`: horno, molino, exprimidora, lácteos, estante de huevos, leche, queso, huevo, gallina y vaca suministrados por el propietario. Los originales de Descargas no se modifican. Importadores reproducibles: `scripts/import-delivered-assets.mjs` y `scripts/build-delivered-animals.mjs`; hashes, tamaños y clips en `docs/delivered-*-manifest.json`.
- `DeliveredModel.tsx` carga los modelos normalizados y dibuja stock mediante instancias compartidas. `retail-layout.ts` calibra las alturas de balda y conserva las capacidades de partidas guardadas. Los productos suministrados se usan también en cesta, vuelos y pantallas.
- `DeliveredDairy.tsx` conserva la apertura de la vitrina durante el acceso de clientes. El importador separa tres hojas, añade bisagras y remates interiores; el grupo dinámico no entra al lote estático.
- `FarmAnimal.tsx` clona esqueletos independientes, mezcla Idle/Walk/Peck/Graze y comparte geometría/texturas. `AnimalMotion.ts` limita el paseo al corral; desplazamiento y mixer usan el mismo delta. La producción sigue siendo responsabilidad exclusiva del motor. El suelo del corral usa bisel 0,025 para un grosor de 0,075: no aumentar el radio por encima del semigrosor.
- `Avatar.tsx` presenta el pelo seleccionado cuando no hay gorro. `AvatarHairMask.ts` oculta únicamente caras del pelo original fusionado mediante índices precalculados para los 12 cuerpos/LOD; preserva el original al llevar gorro, rig, UV y morphs. Regenerar las máscaras con `scripts/build-avatar-hair-masks.mjs` si cambian los cuerpos. El encuadre de `AvatarCustomizer.tsx` se adapta al tamaño real de su panel.
- Los recursos raster de `INTERFACE MARKET/mercado_del_barrio_piezas` son referencias con valores/textos incrustados: se trasladan a estilos DOM vivos en `globals.css`, no se usan como controles de imagen con datos congelados.
- Umbral verde de panadería separado del suelo para evitar superficies coplanares. QA de integración con vídeo, red, consola y contactos: `scripts/qa-delivered-runtime.mjs` (solo desarrollo local). `validate:assets` incluye el directorio `delivered` y exige los clips de ambos animales.

## Producto y stack

Mini Market es un simulador privado de supermercado 3D, browser-first e instalable como PWA. Usa Next.js 16.3.3, React 19, TypeScript, React Three Fiber 9, Three.js 0.185, Rapier 2, Recast 0.43, PostgreSQL 17, Prisma 7 y Better Auth.

Producción:

- dominio: `market.olcas.app`;
- proceso PM2: `market`;
- aplicación: `/var/www/market`;
- puerto interno: `4010`;
- base de datos: `market_db`;
- Caddy entrega todo el dominio mediante proxy al proceso Next.js en `127.0.0.1:4010`; no sirve el build Unity retirado;
- despliegue: push a `main`, controles de calidad y ejecución nativa con Node/PM2.

El bloque de referencia está en `deploy/Caddyfile.example`. La configuración
activa forma parte del Caddy central del VPS y debe validarse antes de recargar.

## Fronteras principales

- `src/app/page.tsx`: sesión, recuperación offline y carga diferida del cliente 3D.
- `src/components/game/GameShell.tsx`: HUD, paneles, notificaciones y enlace entre interfaz y estado.
- `src/components/game/MarketScene.tsx`: escena, cámara, física, navegación visual, estaciones y actores.
- `src/components/game/Avatar.tsx`: propietario y empleados animados.
- `src/components/game/Customer.tsx`: cliente, carro, productos y presentación de caja.
- `src/game/engine.ts`: reglas puras de economía y simulación. La escena únicamente despacha acciones.
- `src/game/store.ts`: estado React, carga, guardado y sincronización.
- `src/game/persistence/`: snapshots, recuperación local asíncrona en IndexedDB, revisión optimista y autoridad del servidor.
- `src/game/stations/`: única fuente para posiciones, huellas, imanes y sockets funcionales.
- `src/game/animation/`: locomoción, transiciones, contactos, carro y presentación del rig.
- `src/game/render/`: calidad adaptativa y agrupación de mallas estáticas.
- `src/components/game/MarketText.tsx`: fuente local común para texto 3D; no depende de CDN bajo la CSP de producción.
- `src/game/ai/`: comportamiento y colas de clientes.
- `public/models/market/`: GLB servidos por la PWA.

## Rutas

- `/`: autenticación y juego.
- `/reset-password`: restablecimiento de contraseña.
- `/api/health`: pública, salud del servicio.
- `/api/auth/[...all]`: Better Auth.
- `/api/game/config`: configuración pública no sensible.
- `/api/game/save`: autenticada, partida autoritativa con revisión y checksum.
- `/api/game/ledger`: autenticada, libro contable idempotente.
- `/api/game/telemetry`: autenticada, diagnóstico de cliente acotado a 32 KB y 12 eventos/minuto por usuario.

## Persistencia y economía

- El servidor es autoritativo para cuentas, revisiones de guardado y libro contable.
- La PWA conserva una copia local de recuperación y puede abrirla sin conexión.
- Las escrituras usan concurrencia optimista e idempotencia durable. Cada PUT lleva `operationId`, `deviceId` y `sessionId`; `SaveOperation` conserva el recibo aplicado para que perder la respuesta HTTP y reintentar no cree un conflicto contra el propio dispositivo ni duplique la revisión.
- El recovery de IndexedDB está separado por una huella no reversible de cuenta. Además del snapshot guarda un outbox con el cuerpo exacto del PUT pendiente. Una colisión real entre dispositivos conserva la versión local y muestra conflicto; nunca sustituye silenciosamente la partida por una revisión antigua.
- Todo importe se almacena como entero en unidades menores y aplica `countryMoneyScale` a precios base.
- Los ticks agrupan el snapshot local más reciente y lo persisten con IndexedDB durante tiempo ocioso, sin serializar la partida completa en el hilo de render. `GameRuntime` sincroniza el servidor cada 30 segundos durante tiempo ocioso y fuerza persistencia/sincronización al ocultar o cerrar la pestaña; la simulación periódica se pausa en segundo plano.
- `game-validation.ts` valida profundamente el snapshot completo antes de normalizarlo. `SaveAuthority.ts` actúa como firewall de integridad: niveles y progreso monotónicos, franquicias y desbloqueos inmutables/level-gated, límites de inventario/empleados, y todo incremento de caja debe poder explicarse por una venta, recompensa o configuración legítima. El destino arquitectónico sigue siendo replay de comandos en servidor; no se debe describir este firewall como equivalencia total a un servidor de comandos.

## Resiliencia y observabilidad de campo

- `error.tsx` y `global-error.tsx` contienen fallos de React/Next y permiten reintentar sin borrar IndexedDB.
- `WebGLContextRecovery` captura `webglcontextlost`, solicita restauración con una extensión obtenida mientras el contexto aún está sano y, solo si no vuelve en cinco segundos, persiste la recuperación y recarga. La restauración en caliente reinicia el estado del renderer e invalida la escena.
- `FieldPerformanceSampler` envía ventanas autenticadas de un minuto con media/p95 de frame, frames de más de 25 ms, tareas largas, nivel y población. Guardado offline/conflicto/error, excepciones y pérdida/restauración WebGL usan el mismo canal.
- `ClientTelemetry` retiene estos diagnósticos por 30 días mediante limpieza incremental. Nunca se envía el snapshot, inventario, email, token ni otro dato de juego sensible.

## Escena y gameplay

- El vendedor se mueve con teclado, mando o arrastre táctil y usa una cámara ortográfica isométrica. El encuadre general conserva orientación y ángulo, con un `zoom` 1,3× más próximo; en una cámara ortográfica moverla sobre su eje no cambia el tamaño aparente.
- `BusinessDay.ts` define la jornada autoritativa 07:30–21:00: 810 minutos de juego equivalen exactamente a 3 horas reales con la tienda abierta. El tick visible avanza el reloj solo mientras la tienda está abierta; al ocultar/cerrar la aplicación los timers se detienen y no existe avance offline. Desde las 18:00 `daylightPresentation` interpola día, atardecer y noche. A las 21:00 (o al cerrar manualmente) se bloquean nuevos clientes, se cobra automáticamente a quienes ya estaban dentro, se mantienen encendidas las luces interiores y, cuando salen, se ejecuta una sola vez el cierre contable y se prepara el día siguiente a las 07:30.
- Cultivos, máquinas, estantes, almacén y cajas se activan por proximidad mediante imanes; la transferencia visible no bloquea al actor. Cada mueble físico repetido tiene su propio sensor/magnet (`fixtureIndex`), aunque todos despachen la misma acción lógica del departamento. `InteractionDirector` elige primero por distancia plana al fixture y usa la prioridad solo para desempatar, de modo que un imán lejano no roba la interacción local.
- Capacidad de estantes = huecos físicos. `RETAIL_SHELF_GRIDS` y `PRODUCE_LAYERS` (`retail-layout.ts`) describen la cuadrícula real de cada mueble; `retailShelfCapacityForTier` es la única regla de capacidad (motor, planificación de cesta, objetivos y presentación): en nivel de expositor 1 la capacidad de cada producto es exactamente la fila delantera de todos sus muebles (pan 24, harina/trigo 12, café 200 en cinco góndolas, huevos 24, leche/queso 25, zumo 45, frutas y verduras 30 = 15 por mesa) y las mejoras de `shelves-1` abren filas hacia el fondo o capas apiladas, siempre con hueco visible. Las unidades se reparten por todos los niveles antes de usar la siguiente fila de fondo. Las máquinas conservan su búfer propio (`outputCapacity` en `products.ts`).
- Todo estante lleva su indicador en vivo: la mesa de frutas y verduras tiene cuatro cubetas inclinadas hacia la cámara, una por producto (`PRODUCE_BIN_COLUMNS`), con un cartel grande por cubeta (`retail-slot-sign:*`); panadería, despensa, huevos, lácteos y bebidas llevan una pantalla por producto (`retail-stock-screen:*`, `StockScreen`) sobre un riel encima del rótulo del departamento (`ScreenRail`), girada hacia la cámara fija (`CAMERA_AZIMUTH`). La pantalla muestra la foto del producto (réplica renderizada una vez a textura con `RenderTexture frames={1}`), el nombre, `unidades/capacidad` de ese mueble y `faltan n` o `LLENO`; solo los dos textos de contador cambian en juego (`dynamic:stock-screen`). La cantidad dibujada es la autoritativa: unidades y capacidad se reparten entre los muebles de un departamento por turnos (`distributedFixtureQuantity`), un hueco sin stock se ve vacío y no existe decoración fija; los vuelos de reposición aterrizan en el mueble y hueco donde aparecerá la unidad (`retailStockFixtureSlot`).
- Orientación: la cámara mira desde +x/+z, así que lácteos y bebidas giran a `yaw: 90` (frente hacia el interior y la cámara; el punto de servicio de bebidas queda al este del mueble, `[5.45, -3.1]`) y la fila delantera de cada balda va junto al borde para que la balda superior no la tape.
- Cultivos: el manzano (`crop-apple-1`, `FARM_PLOTS`, junto al espantapájaros) se abre en el nivel 2, el mismo que trae la demanda de manzanas; partidas anteriores lo reciben ya creciendo si están en nivel ≥ 2. Maíz y naranja siguen ligados a los niveles 11 y 20, que son los mismos en que los clientes empiezan a pedirlos (`CUSTOMER_PRODUCT_UNLOCKS`).
- Pared trasera: donde estaban las estanterías decorativas de "Operaciones y reserva" (sin función, eliminadas) van ahora el bloque de pedidos (`STORE_SERVICE_FIXTURES.orders`, `fixture:orders`, x = 0,9 · z = −7,3: terminal PEDIDOS hacia la tienda, muelle y palé contra la pared; el imán `supplier` y el `STOCKROOM_POINT` de los reponedores están delante, en (0,9, −5,2)), la caja de devolución (`WAREHOUSE_RETURN_STATION`, `fixture:warehouse-return`, x = 3,1 · z = −7,85, el doble de ancha y el triple de alta) y dos góndolas de despensa mirando a la puerta (`PANTRY_DISPLAY_POSITIONS[3..4]`). Las otras tres góndolas van en fila frente a la entrada (x = −2,5, −0,5 y 1,5 · z = 0,25, un 50 % más adentro que su primera posición en z = 2,5) mirando a la puerta, para que cada una muestre su frente; el imán del departamento sigue en la primera y su punto de servicio es (−0,5, 1,65). La fila cierra el paso oeste contra la primera mesa de verduras, así que el único pasillo norte–sur es el este (x ≈ 3,1); para que Recast lo conserve, el expositor de bebidas bajó a (4,35, −3,1) (servicio en (5,45, −3,1)): su esquina noroeste debe quedar a unas dos unidades en diagonal de la esquina sureste de la fila, porque con menos hueco la malla une la tienda y la trastienda solo rodeando las cajas por el este. El terminal MAPA era decorativo (el panel de franquicias se abre desde el HUD) y se eliminó, igual que el "endcap promocional", que nunca se dibujaba pero dejaba un obstáculo invisible entre la segunda caja y pedidos. La caja de devolución sirve a todos los trabajadores y nunca a clientes. Al pasar cerca, el jugador/propietario devuelve de una vez toda su cesta mediante un imán sin bloquearse. Si otro actor llena el estante mientras un reponedor lleva mercancía, el empleado entra en `NAVIGATE_RETURN`, camina al punto accesible delante de la caja y devuelve junta toda la carga restante antes de aceptar otra tarea. La caja es obstáculo de NavMesh y de física. Con QA privada, `__MARKET_QA__.warehouseReturnTarget` publica su centro y punto de trabajo.
- El personalizador de avatar (`AvatarCustomizer.tsx`) ilumina la vista previa con `Lightformer`s locales: el antiguo `Environment preset="studio"` descargaba un HDR de un CDN que la CSP de producción bloquea, y el fallo dentro de `Suspense` desmontaba el juego entero al abrir el panel. Un `PreviewErrorBoundary` limita cualquier fallo futuro de la vista previa a un aviso.
- Zancada y clips: `CLIP_NATURAL_SPEED` (`LocomotionController.ts`) guarda la velocidad de avance de cada clip en el sitio a escala 1 (Walk 0,35 u/s, Run 1,07, CarryWalk 0,24, CarryRun 0,46, BasketWalk 0,52), medida sobre el pie apoyado de los GLB entregados con `scripts/measure-character-rig.mjs` (sin Blender). `gaitTimeScale` = velocidad del cuerpo / (zancada × escala del actor) y `RUN_GAIT_RATIO` decide correr cuando la marcha tendría que ir a más de 2,4×. El clip `CarryBasket` de los clientes es una pose casi estática (0,004 u/s): los estados de desplazamiento usan `BasketWalk`, la entrada y la salida sin carro usan `Run`, y la velocidad autoritativa del cliente (`1.2 + identidad × 0.045`) queda dentro de lo que ese clip cubre sin patinar.
- Cesta de cosecha (jugador y empleados): los brazos congelados al cargar incluyen las clavículas y se muestrean de `CheckoutBag` a 13,8 s (`CARRY_POSE_SOURCES`), una sujeción simétrica a dos manos; `CarryBox` queda como reserva. `CHARACTER_PALM_OFFSETS` apunta al centro de la palma real (+Y del hueso de la mano, 0,04–0,06). `placeCarrySocket` deja la cesta nivelada, mirando al +Z del rig y centrada en el eje del cuerpo, con la barra a la altura y alcance de las palmas; el balanceo lateral de las manos solo las desliza por la barra (`HARVEST_BASKET_BAR_MIN_HALF_LENGTH`).
- Gorros: los GLB de capucha están autorizados alrededor de una cabeza 2–2,8× mayor que la de los rigs entregados (forro de 0,46–0,52 u frente a cráneos de 0,165–0,25 u). `HAT_FIT_SCALE` (`Avatar.tsx`) los escala sobre el hueso `Head` (adultos 0,49; niño 0,64; niña 0,68).
- `CharacterScale.ts` unifica la escala visible del reparto: el tamaño aprobado del niño (`1,65`) es el mínimo, todos los adultos (propietario, empleados y clientes) comparten una altura objetivo un 10 % mayor, y las calibraciones particulares de los GLB de clientes se conservan.
- Clientes: entrada, carro, selección de productos, fila, descarga, pago, bolsa, devolución del carro y salida.
- La segunda caja (`checkout-2`) se abre al contratar un segundo cajero (`ensureSecondCheckoutForCashiers`, también al cargar partidas antiguas) además del desbloqueo por nivel 17; hasta entonces se muestra cerrada. Los cajeros se ordenan de forma estable por id y cada uno posee una caja disponible; no persiguen al mismo cliente ni cambian de carril por cada tick. El estado `WAIT_CHECKOUT_STATION` mantiene la asignación visual sin fingir que está escaneando.
- Empleados: granja, producción, reposición y caja según demanda y rol. El granjero puntúa todos los cultivos habilitados por escasez directa y por demanda de recetas (trigo/harina/pan, naranja/zumo, además de tomate y maíz), evita reservar el mismo bancal que otro granjero y lleva siempre la materia prima más necesaria. Reponedores y operarios descuentan las reservas de cargas/tareas ajenas; el reponedor solo lleva productos vendibles al público y mantiene en almacén el mínimo de receta, mientras el operario toma insumos existentes sin esperar innecesariamente al granjero.
- Progresión comercial: los niveles 1–29 combinan un objetivo operativo y trabajo explícito del propietario (`player:*`). Los contadores se fotografían al entrar al nivel (`levelStartedCounters`), así que actividad histórica o empleados AFK no precompletan el siguiente. Financiar la obra es un requisito adicional, nunca un sustituto. La campaña introduce productos, máquinas, personal, capacidad, velocidad y ampliaciones en el mismo nivel o antes de pedirlos. La velocidad del jugador se habilita desde nivel 3.
- Rapier resuelve al jugador y colliders; Recast calcula caminos de clientes y empleados. Antes de que Recast esté listo, el motor usa un carril de reserva único en x ≈ 3,1 (`STORE_REAR_DOOR.interiorCorridor`, `laneFor`), el único pasillo norte–sur completo entre la fila de góndolas y el expositor de bebidas; los tramos horizontales hacia un punto a la altura de la fila (`pantryEntranceRowBand`) bordean su lado sur, y si el segmento recto entre origen y destino está libre (`storeSegmentIsClear`) se camina directo.
- Las posiciones físicas y visuales comparten los módulos de `src/game/stations/` y `src/game/world-scale.ts`.

## Reparto aprobado

Los cuerpos proceden exclusivamente de:

`/home/ferney_oliveros/Descargas/KIT MARKET/PERSONAJES/NUEVOSPERSONAJES/PERSONAJES/`

Asignación:

- propietario: `HOMBRE.fbx`, `MUJER.fbx`, `NIÑO.fbx`, `NIÑA.fbx`;
- clientes: `CLIENTEHOMBRE1.fbx` y `CLIENTEMUJER1.fbx`–`CLIENTEMUJER4.fbx`;
- la sexta identidad de cliente reutiliza `CLIENTEHOMBRE1.fbx`, porque la entrega contiene cinco clientes distintos.

`tools/blender/build_mixamo_cast.py` copia el skin original y monta las acciones entregadas en `NUEVOSPERSONAJES/` y `GRANJA.zip`. Normaliza nombres de huesos, elimina desplazamiento horizontal de raíz y exporta acciones con los nombres consumidos por el runtime. `scripts/build-market-lods.mjs` genera dos niveles reducidos que conservan el rig y las animaciones.

La PWA cambia de cuerpo completo según capacidad del dispositivo:

- escritorio potente: modelo completo;
- móvil/tablet o equipo limitado: LOD1/LOD2;
- nunca carga a la vez las tres variantes de un mismo actor.

El service worker usa `mini-market-v9`; el cambio de versión invalida los antiguos GLB cacheados bajo la misma URL.

El suelo se monta fuera de los límites `Suspense` de edificio, mobiliario y granja. Cada bloque pesado tiene su propio límite, de modo que una fuente o GLB pendiente no puede dejar toda la escena mostrando únicamente el color de fondo. Los textos Troika usan `/fonts/OpenSans-SemiBold.ttf`, servido desde el mismo origen. La CSP pública permite `blob:` en `script-src`, `connect-src`, `worker-src` e `img-src`: Troika crea workers desde blobs y GLTFLoader convierte texturas GLB embebidas en URLs blob; bloquearlas deja los límites Suspense pendientes y oculta el mundo.

## Perfil de batería móvil

`src/game/render/AdaptiveQuality.ts` decide el perfil antes de crear el renderer:

- 30 FPS de presentación en móvil cuando el jugador está quieto y 60 FPS durante locomoción; escritorio permanece a 60 FPS;
- la presentación móvil se decide contando ticks de `requestAnimationFrame` contra el refresco medido del panel (`DisplayCadenceEstimator`, `presentationDivisor`): 60 Hz presenta cada tick en movimiento, 120 Hz cada dos, 90 Hz cada dos (45 FPS regulares en lugar de 60 con cadencia 22/11 ms);
- DPR máximo 2 en móvil y 2 en escritorio (dos píxeles físicos por píxel CSS; dibujar menos píxeles que la pantalla y estirarlos es lo que se veía como personaje pixelado);
- MSAA activo para recuperar bordes nítidos, preferencia de GPU de bajo consumo y atlas de sombra 512 en móvil;
- en móvil el cristal físico conserva tinte, opacidad, clearcoat y reflejo de entorno, pero `glassTransmission` es `false`: el pase de transmisión de Three redibuja todos los objetos opacos y re-resuelve el programa de cada material dos veces por frame (`getParameters` + `getProgramCacheKey` eran el 19 % de la CPU); en escritorio se mantiene a resolución completa. `useGlassTransmission` en `MarketRenderProfile.tsx` aplica la política en cada cristal;
- luminarias emisivas sin cuatro PointLights redundantes en móvil;
- sombra principal estática después del calentamiento;
- render bajo demanda: no hay frames 3D cuando la pestaña está oculta;
- timers de mundo, simulación y autosave periódico detenidos en segundo plano;
- la calidad adaptativa sólo mide juego real: empieza cuando `SceneReadinessProbe` declara la escena lista más 2,5 s de gracia (antes, la carga de GLB y la compilación de shaders contaban como presión sostenida y bajaban el DPR de forma permanente en todos los dispositivos). Cada paso baja ×0,86 hasta `minDpr` (1,5 móvil, 0,85 escritorio) tras presión sostenida (40 ms en reposo o 24 ms en locomoción) y se devuelve tras 8 s de frames dentro de presupuesto;
- el paso de locomoción del jugador corre dentro del paso fijo de Rapier (`useBeforePhysicsStep`, 1/60): un único acumulador para objetivo cinemático y física, de modo que la interpolación de Rapier presenta al jugador de forma regular a cualquier refresco; el giro del cuerpo se suaviza por frame y la cámara sigue la cápsula interpolada;
- tick autoritativo de IA/economía a 5 Hz con `deltaTime`, desacoplado de la física y presentación del jugador a 60 Hz, para evitar clonar/reconciliar todo el mundo 10 veces por segundo;
- suelo, perímetro urbano, edificio, mobiliario y granja estáticos fusionados por `StaticMeshBatch`: el color del material se hornea por vértice (`diffuse × vertexColor` es exactamente lo que ya calcula `material.color`), de modo que piezas que sólo difieren en color comparten un draw, y las `InstancedMesh` estáticas ya colocadas (montantes, baldas, tubos de carro, decoración) se expanden dentro del mismo lote. Todo lo que cambia en ejecución debe colgar de un nombre `dynamic:*`, `retail-stock:*`, `retail-cold-door:*`, `fixture:returns` o `fixture:cart-bay` (o marcar `userData.disableStaticBatch`); los optimizadores de lote son el último hijo de cada raíz para que las instancias ya tengan sus matrices. Las mallas fuente ocultas dejan de recomponer su matriz cada frame. Con `?perf`, `window.__MARKET_PERF_DRAWS__()` devuelve los draws del último frame por grupo, tipo y prefijo de nombre, con su tiempo de envío.

Estas medidas no cambian reglas, dinero, inventario, IA ni tiempos autoritativos; reducen píxeles, pases GPU y trabajo de presentación.

## Fluidez: qué no puede pasar por React a 5 Hz

El tick autoritativo clona el mundo con `structuredClone`, así que cada 200 ms cambia la identidad de todos los objetos. La escena está organizada para que ese tick no reconcilie árboles grandes ni relance trabajos de GPU:

- `src/game/render/LiveActors.ts` publica en cada render de `MarketScene` los snapshots de clientes, transacciones y empleados en mapas por id. `Customer` y `Npc` son `memo` por una clave de presentación (estado, carro, cesta, transacción, rol) y leen la posición y la ruta más recientes dentro de `useFrame`; el snapshot de movimiento se refresca sólo cuando cambia el reloj de simulación o el estado, nunca por identidad del objeto.
- La puerta del escaparate es estado autoritativo que avanza por tick; `StorefrontDoorMotion` desliza una copia de presentación a la velocidad del motor (450 ms) cada frame y `MarketBuilding` y `StoreColliders` mueven hojas y colisionadores por referencia, sin re-render. La puerta trasera de la granja hace lo mismo con refs en vez de estado por frame.
- `StoreColliders`, `InteractionSensors`, `RearDoorAssembly` y las piezas de `KitFurniture` son `memo`; los sensores y el jugador reciben firmas de texto (`unlockedSignature`, `cropSignature`) en lugar de arrays. Los componentes de departamento y máquina usan `sameFixtureProps` (igualdad estructural), de modo que un cambio de stock o un escaneo en caja sólo re-renderiza su departamento.
- `MarketText` es `memo` con comparación por valor: `Text` de drei relanza `troikaMesh.sync()` (worker + subida de geometría) en cada render, aunque el texto no cambie.
- Los vuelos de producto reportan cada aterrizaje desde el bucle de frames; `GameShell` los agrupa en una única actualización por `requestAnimationFrame`.
- `CustomerWarmup` precarga las seis identidades de cliente durante slices ociosos mientras la pantalla de carga cubre el lienzo: el GLB se decodifica, el atlas sube a la GPU y el programa físico con skinning se compila antes de `sceneReady`. Los clips compuestos (`composeCarryAnimations`, alias de runtime) se cachean por GLB.
- La cara se actualiza a 24 Hz para el propietario y a 16/12/8 Hz para multitudes LOD0/1/2; locomoción, clips, manos y contactos continúan a la cadencia de presentación. La evitación entre clientes usa una cuadrícula espacial de celdas 0,6 en lugar de comparar todos contra todos.
- `LocomotionController` detecta la acción anómala que Three conserva programada pero deshabilitada a peso cero después de un cross-fade rápido, y reactiva solo ese caso. Esto elimina la pose en T inicial sin reiniciar clips sanos cada frame.
- Nada que se monte en mitad del juego usa `RoundedBox` de drei: ese componente extruye una forma nueva y recalcula normales suavizadas en un `useLayoutEffect` en cada montaje. La cesta (`HarvestBasket`) y los productos de cesta, vuelo y carro (`BasketProduct`) comparten geometrías y materiales de módulo. `useCharacterModelTier` cachea su snapshot hasta un cambio real de viewport o de puntero.
- El propietario se presenta a escala 1,65 (×1,5 respecto a 1,1); la cápsula de colisión conserva su huella para no bloquear pasillos.

## QA y publicación

Control obligatorio antes de publicar:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Pruebas de navegador relevantes:

- `pnpm qa:mobile-render`;
- `pnpm qa:character-performance`;
- `pnpm qa:avatar-panel`;
- `pnpm qa:customers`;
- `pnpm qa:workers`;
- `pnpm qa:production-surface`.
- `pnpm qa:save-lost-ack`;
- `pnpm qa:webgl-recovery`.

`scripts/measure-character-rig.mjs` mide un GLB de personaje sin Blender: límites de cabeza y palmas en la pose de reposo, geometría de las manos en cualquier clip/tiempo y velocidad natural de cada ciclo de marcha (`node scripts/measure-character-rig.mjs public/models/market/characters/owner_man.glb`).

`scripts/qa-mobile-render-budget.mjs` valida el perfil móvil de 30 FPS en reposo/60 FPS en movimiento, DPR, MSAA, draw calls, triángulos, texturas, input táctil y errores de consola/red. Una prueba física prolongada en el teléfono sigue siendo la autoridad final para batería y temperatura.

Baseline comercial medido el 15-09-2026 en la build instrumentada local:

- 30 clientes + 4 empleados: escritorio 60 FPS, p95 16,8 ms, 253 draws; móvil 30 FPS, p95 33,4 ms, 243 draws y 374.983 triángulos;
- viewport móvil, CPU ×4 y propietario caminando: mediana 60 FPS, p95 16,8 ms, máximo 181 draws, máximo 253.334 triángulos y cero long tasks;
- cliente en movimiento: mediana de distancia visual/esperada 1,00 y 1,18 % de pausas; empleados: mediana 1,00 y 1,62 % de pausas en la pasada aceptada;
- pérdida WebGL forzada: una pérdida, una restauración, sin reload y ambos eventos recibidos por telemetría con HTTP 201;
- ACK de guardado perdido: revisión 2→3 una sola vez, mismo `operationId`, recuperación local exacta y estado final `saved`.

La auditoría, baseline A/B, inventario de escena, riesgos pendientes y protocolo Android están en `docs/audits/MOBILE-PERFORMANCE-AUDIT-2026-09-12.md`.

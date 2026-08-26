# Mini Market — sistema visual

Actualizado: 2026-08-26

## Dirección

Mini Market usa un 3D estilizado premium, cálido, legible y familiar: fondos crema y menta, verde bosque para información, coral para acciones y selección, siluetas curvas, rostros expresivos, materiales suaves y sombras amplias. La referencia de calidad es el acabado pulido de los juegos móviles de primer nivel, sin copiar personajes ni recursos de terceros. La interfaz debe sentirse como un sistema operativo de una tienda pequeña, no como una plantilla de administración.

## Personajes

- Cuatro bases GLB intercambiables: hombre, mujer, niño y niña. `owner_kit_v1.glb`, `woman_kit_v1.glb`, `boy_kit_v1.glb` y `girl_kit_v1.glb` reproducen la forma, ropa, rostro, cabello y texturas de las vistas PNG entregadas en el kit; el ZIP queda expresamente fuera de la producción.
- Silueta humana visible en todo momento; los animales son gorros sobre la cabeza.
- Dieciséis peinados procedurales y catorce gorros, incluido “Sin gorro”. Los accesorios se montan en el hueso `Head` para seguir todas las animaciones.
- La marcha solo se activa cuando existe desplazamiento real. Los cuatro cuerpos usan esqueletos deformables y clips basados en `POSES DUEÑO.png`/`ANIMACIONES.png`: apoyo de pies, zancada, contrabalanceo de brazos e inclinación del torso. Los clips laborales cubren entrada, saludo, pedidos, cajas, surtido, caja registradora, cultivo, cosecha y celebración.
- Los seis clientes de `cliente1.png` a `cliente6.png` son seis GLB separados, con edad, rostro, peinado y vestuario propios. Cada uno tiene 24 clips para entrar, caminar, mirar, alcanzar productos, llevar cesta, esperar, hacer cola, poner artículos en caja, pagar, recibir bolsa, reaccionar y salir.
- Los cabellos largos tienen pesos sobre huesos secundarios, los ojos del avatar parpadean y los pies permanecen apoyados en el suelo; no se añade elevación artificial al modelo.
- La personalización puede cambiarse durante la partida y se guarda en el estado v2.

## Tienda y huerta

- El mobiliario reconstruye las hojas `MOBILIARIO.png`, `MOBILIARIO2.png` y `HUERTA.png`: estanterías murales, góndolas surtidas, frutería, expositor refrigerado, congelador, frigorífico de vidrio, almacén, carros y cestas.
- La zona operativa incluye caja con cinta, registradora, datáfono y recibo; horno y mesa de panadería; molino con tolva; terminal de proveedores, paquetes, palé y terminal de mapa.
- La huerta incluye parcelas con cultivos diferenciados, invernadero, compost, espantapájaros, vallas, herramientas, regadera, semillas y cajas de cosecha.
- El edificio añade fachada acristalada, puertas automáticas, señalización suspendida, luminarias, reloj y cámaras. Los muebles principales bloquean físicamente al jugador para evitar que los atraviese.
- El terreno de juego mide 23 unidades de ancho y continúa desde el fondo del comercio hasta una zona exterior con huerta, acera y calle. Los pasillos separan claramente producción, exposición, refrigeración, caja y servicios.
- La cámara principal es ortográfica, isométrica y fija: encuadra simultáneamente el local completo, la entrada y el recorrido exterior de los clientes. Al bloquearse en la caja hace una transición suave al mostrador y vuelve al plano general al salir.
- La caja registradora es una estación operable. Presenta producto escaneado, subtotal, impuesto y total; el cliente solicita efectivo o tarjeta. Efectivo calcula entrega y cambio, mientras tarjeta usa el datáfono. El jugador queda inmóvil en el puesto hasta pulsar “Salir de caja” o `Esc`.
- Los clientes cruzan la entrada, compran, pagan, reciben su bolsa en el hueso de la mano y caminan aproximadamente ocho pasos por el exterior antes de desaparecer.

## Interacción y responsive

- Ordenador: WASD, flechas, ratón y mando; `Esc` abandona el puesto de caja.
- Móvil: joystick táctil, botones de acción grandes y áreas seguras del dispositivo.
- Los botones seleccionables conservan borde coral, fondo claro y `aria-pressed`; el color nunca es la única señal.
- El vestuario usa una vista 3D con arrastre 360°, sin zoom accidental, y reorganiza sus columnas en una sola a 820 px.

## Rendimiento

Los materiales, el esqueleto y la jerarquía se clonan por instancia para evitar que una animación o personalización altere las demás instancias. Los cuatro avatares incluyen 15 clips y los seis clientes, 24. Las mallas finales rondan las 30.000 caras soldadas y cada archivo optimizado pesa aproximadamente entre 3 y 6 MB. Los clientes se cargan bajo demanda y la escena limita su población según la mejora de caja; el `devicePixelRatio` del lienzo también queda acotado para proteger móviles.

# Mini Market — sistema visual

Actualizado: 2026-08-26

## Dirección

Mini Market usa un low-poly cálido, legible y familiar: fondos crema y menta, verde bosque para información, coral para acciones y selección, volúmenes redondeados y sombras suaves. La interfaz debe sentirse como un sistema operativo de una tienda pequeña, no como una plantilla de administración.

## Personajes

- Cuatro bases GLB intercambiables: hombre, mujer, niño y niña.
- Silueta humana visible en todo momento; los animales son gorros sobre la cabeza.
- Dieciséis peinados procedurales y catorce gorros, incluido “Sin gorro”. Los accesorios se montan en el hueso `Head` para seguir todas las animaciones.
- La marcha usa el clip `Walk` solo cuando existe desplazamiento real; `Idle` se usa al detenerse. Las acciones próximas pueden lanzar clips de trabajo sin bloquear el control.
- La personalización puede cambiarse durante la partida y se guarda en el estado v2.

## Interacción y responsive

- Ordenador: WASD, flechas, ratón y mando.
- Móvil: joystick táctil, botones de acción grandes y áreas seguras del dispositivo.
- Los botones seleccionables conservan borde coral, fondo claro y `aria-pressed`; el color nunca es la única señal.
- El vestuario usa una vista 3D con arrastre 360°, sin zoom accidental, y reorganiza sus columnas en una sola a 820 px.

## Rendimiento

Los cuatro modelos pesan menos de 100 KB cada uno y se precargan. El rig y los materiales se clonan por instancia para evitar que la personalización de jugador, empleados o clientes altere las demás instancias.

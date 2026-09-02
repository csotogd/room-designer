# Procedimiento de QA manual — Room Designer (experiencia 3D-first)

Sobre la app servida con `npm run dev` (http://localhost:5173).

## QA-1 · Crear la habitación desde el menú

1. Abrir la app. **Esperado:** modal "Crea tu habitación" con formas
   (Rectangular / En L), medidas, y enlace "cargar el proyecto guardado".
2. Elegir "En L". **Esperado:** aparecen los campos de recorte.
3. Crear una rectangular 4,5×3,5. **Esperado:** habitación 3D con las paredes
   que dan a cámara translúcidas (se ve el interior); catálogo a la izquierda.
4. Arrastrar en la escena. **Esperado:** la cámara orbita; rueda = zoom.

## QA-2 · Puertas y ventanas en 3D

5. Pestaña "Puertas y ventanas" → tarjeta **Ventana**. Pasar el ratón por una
   pared visible. **Esperado:** fantasma verde pegado a la pared siguiendo el
   cursor (rojo si la posición no vale).
6. Clic. **Esperado:** la ventana aparece con marco y cristal, queda
   seleccionada, y el inspector inferior muestra "Ventana · Arrástrala por la
   pared · Eliminar".
7. Arrastrar la ventana. **Esperado:** se desliza por su pared, sin salirse
   ni atravesar otras aperturas; al soltar queda fija.
8. Repetir con una **Puerta**. **Esperado:** hoja de madera con manilla.
9. Clic en el suelo o fuera. **Esperado:** se deselecciona (queda fijada).

## QA-3 · Muebles en 3D

10. Pestaña "Muebles" → **Sofá** → mover por la escena. **Esperado:** fantasma
    verde dentro de la habitación, rojo fuera.
11. Clic para colocar; arrastrarlo después. **Esperado:** pinchar y arrastrar
    lo mueve por el suelo; al soltar queda fijo. R lo rota.
12. Colocar una **Mesa** y un **Jarrón** encima. **Esperado:** el jarrón se
    apoya sobre el tablero; arrastrar la mesa lo lleva consigo.

## QA-4 · Luces

13. Pestaña "Luces" → **Plafón** → clic en el techo (dentro de la habitación).
    **Esperado:** luminaria en el techo emitiendo luz; fuera de la habitación,
    fantasma rojo y aviso.
14. Seleccionar el plafón. **Esperado:** inspector con Encendida / Intensidad /
    Color (K) / Eliminar; los cambios se ven en vivo.
15. Mover el slider "Hora" a la noche. **Esperado:** cielo oscuro, luz cálida
    de las lámparas saliendo por puerta y ventana.

## QA-5 · Persistencia, plano y undo

16. Guardar → recargar la página → "cargar el proyecto guardado" desde el
    modal. **Esperado:** vuelve todo (muebles rotados, aperturas, luces, hora).
17. Botón "Plano". **Esperado:** overlay con el plano 2D; permite dibujar
    paredes a mano y seleccionar/mover muebles; "Cerrar plano" vuelve al 3D.
18. Eliminar un mueble y Ctrl+Z. **Esperado:** vuelve (con lo que tuviera
    encima). Mover una ventana y Ctrl+Z: vuelve a su offset.

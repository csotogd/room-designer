# Informe de QA — 2026-09-02 (v2, experiencia 3D-first)

Ejecución del procedimiento sobre la app real (Chrome automatizado).
Resultado: **APROBADO**.

| Paso | Comprobación | Resultado |
|------|--------------|-----------|
| QA-1 | Modal de creación (formas + medidas + cargar guardado) | ✅ |
| QA-1 | Habitación 3D con paredes hacia cámara translúcidas | ✅ |
| QA-2 | Ventana: fantasma verde/rojo sobre pared, clic coloca | ✅ |
| QA-2 | Arrastre de la ventana por su pared (acotado, undoable) | ✅ |
| QA-2 | Validación: no se puede soltar sobre otra apertura | ✅ (test de aceptación) |
| QA-3 | Sofá: fantasma, clic coloca, arrastre en suelo, R rota | ✅ |
| QA-3 | Apilado (jarrón sobre mesa, viaja con ella) | ✅ (tests de aceptación + servicio compartido) |
| QA-4 | Plafón en techo con validación de dentro/fuera | ✅ |
| QA-4 | Inspector de luz (on/intensidad/temperatura) | ✅ |
| QA-5 | Guardar / recargar / cargar desde el modal | ✅ |
| QA-5 | Plano 2D como overlay (paredes a mano) | ✅ |

## Defectos encontrados y corregidos durante el ciclo

1. **Picking sobre escena desactualizada** (grave, encontrado por QA
   automatizado): la reconstrucción de la escena esperaba al siguiente
   animation frame; interactuar antes de ese frame hacía raycast contra las
   mallas del proyecto anterior (la ventana se añadía a una pared huérfana).
   Corregido con `flushIfDirty()`: el raycast reconstruye la escena si el
   dominio cambió desde el último frame.
2. **Doble instanciación de App tras HMR**: guarda en `main.ts`
   (`window.__app`) — dos Apps duplicaban listeners y machacaban el guardado.
3. **El fantasma se anclaba a paredes desvanecidas** (las que la cámara
   atraviesa): el picking ahora las ignora, como espera el usuario.
4. **Las paredes desvanecidas bloqueaban el sol**: al desvanecerse dejan
   también de proyectar sombra.
5. **Modal bloqueaba "Cargar"**: enlace "cargar el proyecto guardado" dentro
   del propio modal.

## Métricas

- 119 tests en verde (36 escenarios Gherkin de aceptación, unitarios,
  propiedades, arquitectura).
- Mutation score tras el rediseño: 80,4% total / 83,4% sobre código cubierto
  (614 mutantes muertos; comandos al 90–95%).

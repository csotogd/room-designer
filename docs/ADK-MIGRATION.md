# Migración a Python y Google ADK

Implementación del backend en `backend/room_designer`, manteniendo el editor
TypeScript y los contratos HTTP/WebSocket. Se han retirado los servidores,
adaptadores y CLIs TypeScript del backend, y sus pruebas se han trasladado
a Python. Los tests del cliente ahora conectan con servidores Python reales.

## Verificación local

| Comprobación | Resultado |
|---|---|
| Referencia antes de migrar | 225 tests TypeScript correctos |
| Backend migrado | 94 tests pytest correctos |
| Editor e integración TypeScript → Python | 154 tests Vitest correctos |
| Cobertura TypeScript del gate | 96,18% líneas; 80,79% ramas |
| Typecheck y build Vite | correctos |
| Ruff (lint y formato) | correcto |
| Stryker desde su sandbox | dry-run correcto; no se ejecutaron mutantes |
| Lockfile y `pip check` | correctos |
| Golden set del catálogo activo, hashing | MRR 1,0; Recall@5 0,8826; NDCG@5 0,9517 |

Las pruebas incluyen el Runner real de ADK, tool calling para Gemini nativo
y LiteLLM con OpenAI/Anthropic, validación de salidas del picker/juez,
entrada multimodal, apertura de conexiones HTTP/WS, evidencia PNG, replay,
atomicidad y rollback, concurrencia, índices de 100.000 vectores, snapshots,
fuentes de catálogo, checkpoints y exclusión de productos rechazados.

CLIP se ha probado con el modelo PyTorch y una configuración pequeña de
pesos aleatorios para verificar inferencia de texto/imagen sin descargar
pesos. La evaluación del catálogo indicada arriba corresponde a hashing.
Los tests de proveedores sustituyen las respuestas remotas; no se han
realizado llamadas facturables ni comprobado cuotas/permisos de cuentas reales.

Los Dockerfiles se han migrado, pero no se han construido imágenes: el daemon
Docker no estaba disponible en la máquina. No se ha desplegado infraestructura.
La advertencia de Vite por tamaño del bundle sigue presente.

## Continuación: juez y agente

El refinamiento y su memoria están implementados con control de cancelación,
versiones de captura, notas actuales e historial en el chat. La parada por
estancamiento se ha eliminado: el objetivo es la media de las cuatro métricas.
Ver el [contrato y comportamiento](../services/designer/README.md#protocolo).

Verificación de esta continuación: 116 tests Python y 163 TypeScript;
la integración por sockets ejecuta el Runner real de ADK y completa una
secuencia de notas 5 → 5 → 5 → 7,5. Se prueban además cancelación/rollback,
capturas antiguas, repetidas o de otra pestaña, rondas sin acciones,
restauración del chat y fallos de carga 3D. Los modelos remotos se simulan.

## Arranque

Ver [README](../README.md), [configuración de ejemplo](../.env.example) y
[arquitectura](../ARCHITECTURE.md). La instalación actual tiene `.venv`
preparado. Para activar un LLM real, configura proveedor y clave en `.env`,
y arranca búsqueda, diseñador y frontend en terminales distintas:

```bash
npm run search:serve
npm run designer:serve
npm run dev
```

Los archivos de habitación conservan su versión y los catálogos su esquema.
CLIP Python utiliza un espacio vectorial distinto a ONNX y reconstruye el
índice al primer arranque; hashing puede restaurar los snapshots anteriores.

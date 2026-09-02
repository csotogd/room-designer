# Research: de foto de catálogo a modelo 3D (septiembre 2026)

Objetivo: conectar catálogos de terceros (Leroy Merlin, etc.) — que dan
**foto + medidas + precio** — y fabricar automáticamente el GLB de cada
producto para colocarlo en la habitación. El cuello de botella es la
reconstrucción imagen → 3D.

## 1. El problema, bien acotado

- Entrada real: **una** foto de producto (fondo blanco casi siempre) + medidas
  exactas (ancho×fondo×alto) + nombre/categoría.
- Salida deseada: GLB con texturas/PBR, limpio (<50k triángulos), a escala.
- Clave que nos favorece: **la escala métrica no tiene que salir de la IA.**
  Ningún modelo actual produce escala métrica fiable desde una foto, pero
  nuestras medidas del catálogo son la verdad absoluta y el visor ya
  normaliza el bounding box del GLB a esas medidas por eje
  (`ui/view3d/models.ts`). La IA solo tiene que acertar la **forma**; las
  proporciones exactas las imponemos nosotros.

## 2. Paisaje 2025–2026

### Generación open-source (self-host)

| Modelo | Fecha | Licencia | Notas |
|---|---|---|---|
| **TRELLIS.2** (Microsoft/Tsinghua) | dic 2025 | **MIT** | 4B params, salida GLB con PBR completo (base color, metallic, roughness, opacity), topologías arbitrarias (O-Voxel). ~3 s (512³) a ~60 s (1536³) en H100. Requiere GPU ≥24 GB, Linux. El mejor open a día de hoy. |
| TRELLIS (v1) | CVPR'25 | MIT | Predecesor; sin PBR completo. Superado por la v2. |
| Hunyuan3D 2.0 / 2.5 (Tencent) | 2025 | 2.0 no comercial; 2.5 se cita Apache 2.0, **pero con restricción territorial UE/UK/Corea en varias releases** | Calidad top, pero la incertidumbre de licencia en la UE lo descarta para nosotros sin verificación jurídica. |
| Hunyuan3D-Buffalo 1.0 | ago 2026 | por verificar | Unifica generación, edición por instrucciones y **generación por partes**. A vigilar. |
| PartCrafter / PartPacker / PartDiffuser | 2025–2026 | académico | Generación **por partes semánticas** desde una imagen (patas, tablero, cojines como mallas separadas). Ideal a futuro para muebles editables/animables. |
| **Home3D 1.0** | jun 2026 | sin código publicado | Sistema *específico de interiorismo/e-commerce*: módulos de geometría (SDF+difusión), textura multivista, **materiales PBR por recuperación de biblioteca curada** y partes editables. Valida exactamente nuestra dirección; sin código, sirve como blueprint. |

### APIs comerciales (pagar por modelo generado)

| Servicio | Precio aprox. | Fuerte |
|---|---|---|
| **Tripo** | API ~0,01 $/crédito (pocos céntimos por modelo); planes desde ~14 $/mes | Rápido, topología quad limpia, API madura. |
| Meshy | 20 $/mes (1.000 créditos) | Iteración rápida, buen workflow. |
| Rodin (Hyper3D) Gen-2 | 30–120 $/mes | 10B params, la mayor fidelidad visual del mercado. |

### Alternativa no generativa: recuperación (retrieval)

Embeber la foto del producto (CLIP/OpenCLIP) y buscar el 3D más parecido en
una biblioteca (Objaverse ~800k objetos, o la nuestra propia a medida que
crece). Determinista, barato, sin GPU de inferencia pesada — pero limitado a
lo que exista en la biblioteca. **Híbrido recomendado**: retrieval primero,
generación solo si no hay match, y cada generación alimenta la biblioteca.

### Fotogrametría (COLMAP, etc.)

Necesita decenas de fotos por objeto → no aplica a una foto de catálogo.

## 3. Criterios para nuestro caso y veredicto

1. **Licencia comercial y UE**: TRELLIS.2 es MIT sin restricciones → gana
   para self-host. Hunyuan arrastra exclusión territorial UE en sus licencias
   → riesgo legal directo operando desde España.
2. **Fidelidad de forma en muebles** (paneles planos, aristas): TRELLIS.2 y
   Rodin Gen-2 lideran; los muebles de catálogo (fondo blanco, objeto
   aislado) son el caso *fácil* de estos modelos.
3. **Escala**: resuelta por nuestras medidas de catálogo + normalización.
4. **Coste**: API ≈ céntimos/modelo (un catálogo de 10.000 refs ≈ decenas de
   euros en Tripo). Self-host: una GPU 24 GB+ (A10G/4090/A100) por lotes.
5. **Legal del scraping**: ojo con los ToS de cada web y con reproducir
   diseños de marca en 3D con fines comerciales. Mejor vía: feeds/APIs de
   afiliados o acuerdos de catálogo. El pipeline técnico es idéntico.

## 4. Arquitectura recomendada (por fases)

```
scraper/feed ──▶ IngestService ──▶ cola de generación ──▶ GLB ──▶ S3/CDN
 (foto, medidas,      │                    │
  precio, nombre)     │          Fase 0: API Tripo/Meshy
                      │          Fase 1: worker TRELLIS.2 (GPU, batch)
                      │          Fase 2: retrieval-first + generación por partes
                      ▼
              CatalogService (gRPC) ──▶ front (ya preparado: modelUrl/imageUrl)
```

- **Fase 0 (MVP, días)**: puerto `MeshGenerator` con adaptador a la API de
  Tripo. Preproceso: recorte de fondo (rembg/SAM). Postproceso: decimación +
  Draco (gltfpack). Validación automática: comparar silueta renderizada del
  GLB contra la foto original (IoU) para descartar reconstrucciones malas.
- **Fase 1 (escala)**: mismo puerto, adaptador TRELLIS.2 self-host en worker
  GPU con cola; batch nocturno por catálogo; coste marginal ~0.
- **Fase 2 (calidad/edición)**: retrieval-first sobre biblioteca propia
  (dedup de productos casi idénticos entre catálogos) y generación por
  partes (PartCrafter/Buffalo) para muebles configurables.

El front **no cambia en ninguna fase**: `Product.assets.modelUrl` ya carga
GLB con caché, placeholder procedural y reescalado a medidas.

## 5. Fuentes

- TRELLIS.2: https://github.com/microsoft/TRELLIS.2 · modelo: microsoft/TRELLIS.2-4B (HF)
- TRELLIS v1: https://github.com/microsoft/TRELLIS
- Hunyuan3D-2 (licencia y debate comercial): https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/LICENSE · issues #6 y #254
- Hunyuan3D-Buffalo 1.0: https://arxiv.org/abs/2608.02711
- Home3D 1.0 (interiorismo/e-commerce): https://arxiv.org/pdf/2606.27923
- PartCrafter: https://arxiv.org/abs/2506.05573 · PartDiffuser: https://arxiv.org/html/2511.18801v4
- Comparativas de APIs 2026: https://www.3daistudio.com/blog/best-3d-model-generation-apis-2026 · https://www.neural4d.com/features/neural4d-vs-tripo-vs-meshy-vs-rodin · https://visiomake.com/en/blog/best-ai-image-to-3d-tools-2026-comparison-archviz
- Objaverse (retrieval): https://openaccess.thecvf.com/content/CVPR2023/papers/Deitke_Objaverse_A_Universe_of_Annotated_3D_Objects_CVPR_2023_paper.pdf

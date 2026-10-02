# Reconstrucción de habitaciones desde vídeo para un editor de interiores

Es técnicamente viable obtener una habitación editable a partir de una captura breve, incluso amueblada. El resultado más alcanzable es un plano vectorial con paredes, puertas, ventanas y volúmenes aproximados de los muebles. Reproducir cada mueble con su apariencia y geometría completas requiere una segunda etapa, con mayor incertidumbre en las partes ocultas.

La recomendación es separar estructura, objetos existentes y apariencia. La estructura debe conservar medidas y restricciones geométricas; cada objeto debe poder moverse o eliminarse; la apariencia puede enriquecerse progresivamente. Esta separación permite empezar a diseñar antes de disponer de una reconstrucción fotográfica perfecta.

El informe considera literatura publicada hasta el 12 de septiembre de 2026, documentación primaria de productos y el estado local de Room Designer. Las recomendaciones de implementación y las metas del experimento son propuestas de ingeniería; no son resultados medidos en este proyecto. No se ha ejecutado un benchmark de reconstrucción propio.

## 1. Qué significa «sacar el plano»

Hay cuatro resultados diferentes que pueden parecer equivalentes en una demostración:

| Resultado | Qué permite | Qué sigue faltando |
|---|---|---|
| Imagen de la habitación vaciada | Imaginar una decoración desde esa vista | Medidas verificadas y navegación por toda la habitación |
| Nube de puntos, malla o representación fotográfica 3D | Inspeccionar superficies capturadas | Paredes y muebles como entidades independientes |
| Modelo paramétrico | Editar longitudes, aperturas y posiciones; generar una planta | Apariencia detallada de los muebles |
| Modelo paramétrico con objetos reconstruidos | Redistribuir también el mobiliario existente | Verificación de partes ocultas y dimensiones críticas |

Para este editor interesa especialmente el tercer resultado, ampliado después con el cuarto. RoomFormer aborda la conversión de escaneos 3D en polígonos de habitaciones; SceneScript y SpatialLM representan explícitamente estructura y objetos. Son antecedentes más cercanos al producto buscado que un sistema dedicado únicamente a generar vistas bonitas.[^1][^2][^3]

**«Sin muebles» puede describir la salida aunque la captura tenga muebles.** No es necesario vaciar físicamente la habitación para empezar. Sí hace falta decidir qué superficies se han observado y cuáles se han completado por hipótesis.

**«Con muebles» tampoco exige reconocer referencias comerciales.** Identificar un sofá, estimar su tamaño, orientación y posición, y darle identidad propia es suficiente para conservarlo en el proyecto. Vincularlo a un catálogo sería una operación adicional y opcional.

## 2. Qué aporta un vídeo y dónde entra la triangulación

La reconstrucción clásica combina Structure from Motion, o SfM, con Multi-View Stereo, o MVS. Primero encuentra correspondencias visuales entre imágenes, estima la trayectoria de la cámara y triangula puntos. Después densifica las superficies y puede producir una malla. COLMAP es una referencia práctica y documentada para este proceso.[^4]

Una esquina observada desde dos posiciones genera dos rayos de visión. Con las cámaras conocidas, su intersección permite estimar dónde está en 3D. En un par estéreo rectificado, la relación ideal es `profundidad = focal × separación entre cámaras / disparidad`. Una disparidad pequeña hace que errores pequeños de imagen tengan un efecto grande sobre la profundidad. El ajuste conjunto de cámaras y puntos, denominado *bundle adjustment*, reduce inconsistencias de múltiples observaciones.

La consecuencia para la captura es clara: **hay que desplazarse, además de girar**. Una panorámica tomada desde un centro óptico fijo no aporta la separación necesaria para triangular distancias. Los métodos aprendidos pueden aun así inferir una habitación plausible a partir de ella, apoyándose en regularidades aprendidas; esa inferencia no equivale a una medición multivista.

COLMAP recomienda solapamiento, distintos puntos de vista y evitar superficies sin textura o con reflejos. También aconseja reducir los fotogramas de entrada cuando se utiliza vídeo.[^4] Los muebles tienen aquí un efecto doble: ocultan paredes, pero sus bordes y texturas pueden ayudar a localizar la cámara. Por tanto, una habitación blanca completamente vacía no siempre es la captura más fácil.

La escala es otra ambigüedad. En reconstrucción monocular puramente geométrica, una escena y una trayectoria ampliadas por el mismo factor producen las mismas proyecciones. Saber la focal no basta para determinar metros. Una longitud real, profundidad de un sensor o una trayectoria visual-inercial bien estimada permiten introducir un anclaje métrico. ORB-SLAM3 es un antecedente consolidado de combinación de visión, sensores inerciales y optimización de mapas.[^5]

Los modelos de profundidad métrica actuales sí pueden predecir valores en metros usando conocimiento aprendido. Es incorrecto afirmar que ningún modelo RGB puede producir escala métrica. Lo que no proporcionan automáticamente es una garantía de exactitud en una habitación concreta: Pi3X describe su escala como aproximada y Depth Anything 3 distingue modelos relativos, métricos y combinados.[^6][^7]

**Propuesta:** aceptar una medida indicada por la persona, por ejemplo la distancia entre dos esquinas visibles, y contrastar una segunda medida independiente. La primera fija la escala global; la segunda ayuda a descubrir deformaciones. Reescalar no corrige por sí solo paredes mal orientadas ni errores locales de reconstrucción.

## 3. Captura RGB, captura con sensores y LiDAR

| Entrada | Información disponible | Ventaja principal | Límite principal |
|---|---|---|---|
| MP4 de la cámara habitual | Imágenes; metadatos variables | Fácil de aportar desde muchos móviles | No se deben asumir poses, IMU sincronizada o profundidad |
| Captura guiada con ARKit/ARCore | Imágenes, calibración y poses; profundidad según dispositivo | Control de cobertura y referencia espacial | Requiere integrar una experiencia de captura compatible |
| iPhone/iPad compatible con LiDAR y RoomPlan | Captura RGB-D y reconstrucción paramétrica | Reduce el trabajo necesario para obtener estructura editable | Alcance limitado a dispositivos compatibles y a lo que el escaneo permite estimar |

Apple RoomPlan usa cámara y LiDAR para producir una representación paramétrica. Su descripción técnica separa estimación de paredes y aperturas de detección 3D de objetos. Combina información semántica y geométrica, detecta líneas en vista superior y proyecta detecciones de puertas y ventanas sobre paredes. Esa publicación explica explícitamente que la oclusión por muebles es parte del problema que aborda.[^8]

La API entrega componentes de la habitación que una aplicación puede modificar.[^9] **Como decisión de ingeniería, es la vía más corta para validar la importación de una habitación medida**, siempre que se acepte disponer de una captura nativa en hardware compatible. Usar RoomPlan no equivale a enviarle un MP4 previamente grabado.

En Android, ARCore Depth obtiene profundidad a partir del movimiento y combina sensores de profundidad cuando existen. Google advierte que las paredes sin textura pueden producir profundidad imprecisa; además, la compatibilidad debe comprobarse por dispositivo.[^10] Ofrece una base de captura, pero todavía hace falta convertir sus observaciones en paredes y objetos editables.

Ni una cámara RGB ni un LiDAR de consumo ven a través de un armario. LiDAR reduce ciertas ambigüedades de profundidad; no elimina la oclusión física.

## 4. Cómo reconstruir la estructura con muebles delante

El plano debe describir el límite arquitectónico de la habitación. La envolvente de los puntos visibles no basta: puede seguir el frente de un sofá, cerrar un entrante o convertir la cara de un armario en una pared.

Una estrategia interpretable consiste en estimar suelo y dirección vertical, separar estructura de objetos, ajustar planos de pared y construir un contorno cerrado. RANSAC permite ajustar planos pese a puntos atípicos; Open3D lo implementa directamente.[^11] La selección de qué planos corresponden a paredes necesita además evidencia semántica y coherencia espacial.

**Ejemplo:** se ven franjas de pared a ambos lados de un sofá y la unión con el techo. Es razonable ajustar una única pared y prolongarla detrás del sofá, registrando ese tramo como inferido. Si un armario tapa por completo una esquina que podría contener un retranqueo, no hay información suficiente para resolverlo con certeza. Si esconde una puerta entera, tampoco debe darse por medida una puerta inventada.

Propongo mantener tres estados de evidencia por elemento: **observado**, **inferido** y **confirmado por la persona**. Se pueden añadir indicadores de calidad geométrica y cobertura. Un valor de confianza de una red no debe mostrarse como una probabilidad de acierto calibrada sin haber comprobado esa calibración.

Las regularidades arquitectónicas ayudan: verticalidad, continuidad y paredes aproximadamente perpendiculares. La hipótesis *Manhattan* supone direcciones ortogonales dominantes; debe poder relajarse para paredes diagonales. Forzar un rectángulo en una habitación en L puede dar una reconstrucción visualmente limpia y funcionalmente equivocada.

HorizonNet ilustra cómo estimar la estructura desde panoramas mediante predicción de límites y esquinas.[^12] RoomFormer reconstruye polígonos desde mapas de densidad derivados de nubes de puntos.[^1] SceneScript y SpatialLM aprenden a emitir entidades estructuradas.[^2][^3] Ninguno convierte la ausencia de observación en certeza; son formas distintas de combinar evidencias y supuestos.

También hay una precisión semántica útil para el editor: desde dentro se observan normalmente **caras interiores** de paredes. El grosor completo de los muros no queda determinado por esa captura. Debe conservarse como dato conocido o valor de diseño explícito, evitando que un grosor por defecto reduzca accidentalmente las dimensiones útiles importadas.

## 5. Cómo conservar y mover muebles ajenos al catálogo

La complejidad crece en tres niveles:

| Nivel | Representación | Utilidad para diseñar | Condición |
|---|---|---|---|
| Volumen aproximado | Caja orientada y categoría | Reservar espacio, mover, girar y comprobar interferencias | Confirmar dimensiones de objetos importantes |
| Modelo genérico | Sofá, mesa o armario procedural ajustado | Reconocer mejor la distribución | Indicar que la forma es una aproximación |
| Objeto reconstruido | Malla con textura propia | Reconocer visualmente el mobiliario existente | Más vistas, separación de instancias y tratamiento de partes ocultas |

Para separar objetos entre fotogramas pueden utilizarse detectores y segmentadores con seguimiento. SAM 3, publicado en 2025, detecta, segmenta y sigue instancias mediante indicaciones conceptuales en imágenes y vídeos.[^13] Estas máscaras son evidencia 2D: todavía hay que asociarlas con puntos 3D y mantener una identidad coherente entre vistas.

A partir de cada instancia se puede calcular una caja orientada y, cuando haya suficiente cobertura, reconstruir su superficie visible. La máscara del sofá en el fotograma siguiente debe vincularse con el mismo sofá, no crear otra copia. Los objetos apoyados requieren también una relación de soporte, por ejemplo jarrón sobre mesa.

Para las superficies no vistas existen dos familias adicionales. **Scan2CAD** alinea modelos limpios de una biblioteca con escaneos incompletos: es útil como antecedente de sustitución por un modelo similar, aunque no garantiza que sea el mueble real.[^14] **SAM 3D Objects** genera geometría, textura y colocación a partir de una imagen y está diseñado para escenas naturales con oclusión y desorden.[^15]

Recomiendo usar la geometría observada como restricción al completar un objeto. Un respaldo generado puede ser convincente y distinto del real. La malla visual no debería alterar silenciosamente la caja de dimensiones confirmada por la persona. En objetos próximos a un paso estrecho, esa separación es especialmente útil.

El trabajo reciente MessyKitchens trata explícitamente contactos y penetraciones en reconstrucción de múltiples objetos.[^16] Su relevancia es conceptual: reconstruir objetos por separado no garantiza que el conjunto sea físicamente coherente. Sus resultados en escenas de cocina tampoco prueban por sí solos una redistribución correcta de sofás y armarios a escala de habitación.

**Propuesta de producto:** cada objeto existente lleva dimensiones, posición, orientación, categoría y un recurso visual opcional. No necesita precio ni referencia de tienda. «Sustituir por un producto» crea una relación posterior con el catálogo; «conservar mi sofá» debe funcionar sin ella.

## 6. Qué sabemos de IKEA Kreativ

La documentación oficial de IKEA Australia incluye una modalidad de **subir una foto existente**, tanto en la app como en la web. En la web indica elegir «Use a Photo» y subir o arrastrar una imagen. Por tanto, Kreativ sí ofrece una entrada basada en una foto; no debe describirse exclusivamente como un escáner multivista o LiDAR. Esa página no explica cómo determina las dimensiones ni establece la precisión del modo foto.[^36]

La nota oficial de lanzamiento de Ingka, de junio de 2022, atribuye la tecnología central a Geomagical Labs. Describe redes para reconocer objetos y geometría interior, visión estéreo, fotografía computacional y gráficos de realidad mixta. Explica que una serie de fotografías se procesa como una réplica interactiva y permite borrar mobiliario existente y colocar productos IKEA.[^17]

Otra guía oficial describe la captura de una imagen panorámica seguida de movimientos amplios en forma de ocho y, para ciertos dispositivos sin LiDAR, un paso lateral y un segundo escaneo.[^37] Esa modalidad sí recoge observaciones adicionales a la fotografía presentada como resultado. Las instrucciones de escaneo guiado y las de subir una foto son modalidades diferentes; no deben confundirse.

La ayuda oficial consultada distingue **Detailed Viewpoint Scan** y **Full Room Scan**, y reserva este último a dispositivos iOS con LiDAR.[^18] La página fue actualizada en mayo de 2025; su lista de modelos debe tratarse como documentación de compatibilidad de esa página, no como inventario exhaustivo de todo el hardware disponible en 2026.

| Afirmación | Qué permite sostener la evidencia pública |
|---|---|
| Permite subir una foto existente desde la web o la app | Está documentado por IKEA Australia; la página no establece su precisión métrica |
| Usa comprensión de interiores y visión estéreo | Está explicado por Ingka |
| Puede borrar mobiliario capturado y colocar productos IKEA | Está descrito en lanzamiento y ayuda |
| Tiene distintos modos de captura según dispositivo | Está documentado en soporte |
| Utiliza exactamente RoomPlan, COLMAP, VGGT o una arquitectura concreta | No queda establecido por las fuentes consultadas |
| Convierte cualquier mueble del usuario en un GLB completo que se puede mover libremente | No queda establecido por las fuentes consultadas |
| Exporta desde cualquier vídeo un plano vectorial de precisión conocida | No queda establecido por las fuentes consultadas |

La ayuda enumera mover y girar muebles, y borrar el mobiliario actual, pero esa enumeración no demuestra que los muebles fotografiados se conviertan en objetos completos reutilizables.[^19] Borrar un sofá de una vista, colocar encima un modelo de catálogo y reconstruir el sofá por todas sus caras son capacidades diferentes.

**Inferencia técnica, no descripción verificada de su implementación:** una experiencia como la anunciada puede combinar captura guiada, geometría, segmentación, completado de las zonas tapadas y composición de modelos 3D con perspectiva e iluminación coherentes. Una representación optimizada para las vistas disponibles puede dar mucho valor de decoración sin resolver todos los requisitos de un editor paramétrico general.

Por tanto, Kreativ confirma el interés y viabilidad de la experiencia comercial, pero las fuentes públicas no permiten copiar su receta interna ni derivar de ella una garantía de medición.

La reconstrucción de una escena editable desde una sola foto también tiene antecedentes académicos. PSDR-Room inicializa una escena con comprensión de imagen y búsqueda de modelos, y optimiza poses, iluminación y materiales para reproducir la apariencia de la fotografía con intervención mínima.[^38] Esto permite un modelo útil basado en hipótesis; no resuelve la ambigüedad matemática de escala ni determina superficies completamente ocultas.

## 7. Vaciado visual, NeRF y Gaussian Splatting

Para obtener una habitación vacía paramétrica basta con conservar estructura y ocultar objetos, usando materiales de pared y suelo. Para obtener una habitación vacía fotográfica hay que rellenar también textura, sombras y superficies que estaban tapadas.

El *inpainting* completa regiones de imagen. LaMa es un antecedente importante de completado de máscaras grandes.[^20] Su utilidad para esta aplicación es visual; un patrón de suelo completado no constituye una observación nueva. Propongo efectuar la estimación geométrica sobre imágenes originales y reservar el completado visual para después. Completar independientemente cada fotograma antes de triangular puede introducir detalles que no corresponden entre vistas.

NeRF y 3D Gaussian Splatting pertenecen a la familia de representaciones destinadas a sintetizar vistas. El trabajo original de Gaussian Splatting optimiza una representación de apariencia basada en gaussianas 3D y permite renderizado rápido.[^21] Para este producto puede servir de referencia visual, pero hay que añadir segmentación y estructura para transformar «esa región de la escena» en «este sofá editable».

Mi propuesta es conservar opcionalmente el escaneo como una capa de consulta y usar paredes y objetos paramétricos como fuente de verdad. Mover mobiliario en una reconstrucción fotográfica también exige tratar huecos y sombras que quedan en el fondo; eliminar solo sus puntos puede dejar un agujero.

RoomRecon, un preprint de abril de 2026, se centra precisamente en captura RGB-D, elementos permanentes y texturizado con asistencia generativa.[^22] Resulta relevante para una segunda fase de apariencia de la habitación. No prueba una solución equivalente basada únicamente en un MP4 RGB arbitrario.

## 8. Literatura seleccionada y función de cada método

La comparación siguiente organiza trabajos por el problema que resuelven. No constituye una clasificación global: sus entradas, datasets y métricas son diferentes.

| Trabajo | Publicación | Entrada y salida relevantes | Lectura para Room Designer |
|---|---|---|---|
| ORB-SLAM3 | Preprint 2020 | Imágenes, opcionalmente IMU → trayectoria y mapa | Referencia de seguimiento, escala visual-inercial y cierre de bucles; no produce muebles semánticos por sí solo.[^5] |
| DUSt3R | Preprint 2023; CVPR 2024 | Pares de imágenes → mapas de puntos; alineamiento de pares | Cambio importante hacia reconstrucción aprendida sin calibración previa conocida.[^23] |
| MASt3R | ECCV 2024 | Imágenes → geometría y correspondencias densas | Refuerza las correspondencias; útil para entender la combinación de redes y optimización geométrica.[^24] |
| MASt3R-SLAM | Preprint 2024; CVPR 2025 | Vídeo monocular → trayectoria y reconstrucción densa | Antecedente directo para recorrer una habitación y mantener un mapa coherente.[^25] |
| VGGT | 2025 | Una o múltiples vistas → cámaras, profundidad, puntos y trayectorias de puntos | Referencia moderna para inicializar la geometría de un vídeo.[^26] |
| Depth Anything 3 | Preprint 2025; ICLR 2026 | Imágenes y poses opcionales → profundidad y geometría consistente | Candidato práctico para comparar vídeo puro con captura que conserva poses.[^27] |
| Pi3 / Pi3X | 2025; Pi3 en ICLR 2026 | Múltiples vistas; Pi3X admite condicionamiento con cámaras o profundidad | Candidato de investigación; Pi3X es una ampliación de ingeniería y su escala es aproximada.[^6] |
| VGGT-Ω | CVPR 2026 | Múltiples vistas → reconstrucción de escenas estáticas y dinámicas | Avance reciente a evaluar; sus mejoras de benchmark no equivalen a precisión de paredes en centímetros.[^28] |
| HorizonNet | CVPR 2019 | Panorama → estructura de la habitación | Alternativa cuando la captura se parece a una panorámica; depende de hipótesis de estructura.[^12] |
| RoomFormer | CVPR 2023 | Nube proyectada en vista superior → polígonos | Directamente relevante para el plano vectorial; presupone reconstrucción 3D de entrada.[^1] |
| SceneScript | 2024 | Observaciones codificadas → comandos estructurados | Antecedente de un formato editable de paredes y objetos.[^2] |
| PSDR-Room | 2023 | Una foto e intervención mínima → escena con componentes editables | Antecedente para una entrada de foto que produzca un borrador de diseño; no implica dimensiones verificadas.[^38] |
| SpatialLM | NeurIPS 2025 | Nube de puntos → paredes, aperturas y cajas orientadas | El encaje conceptual más directo con una importación semántica completa.[^3] |
| SAM 3 y SAM 3D Objects | 2025 | Segmentación y seguimiento; reconstrucción generativa de objetos | Componentes complementarios para individualizar muebles y recuperar apariencia.[^13][^15] |

**La demostración más cercana al objetivo es SpatialLM combinado con reconstrucción desde vídeo.** Su repositorio muestra MASt3R-SLAM y aporta un ejemplo alternativo con SLAM3R. Aclara que la superposición de una demo usa cámaras de referencia y que las nubes de entrada deben estar alineadas a ejes.[^29] Esto demuestra una cadena técnica viable; no elimina el trabajo de calibración, validación y adaptación a capturas domésticas.

Los propios resultados de SpatialLM1.1-Qwen en su test de vídeo dan F1 de 68,2 para paredes, 47,4 para puertas y 51,4 para ventanas, con umbral IoU 0,25 en 2D.[^29] Son puntuaciones de detección en ese protocolo, **no porcentajes de habitaciones perfectas ni exactitud métrica**. Son un argumento para incluir corrección humana desde el primer prototipo.

No recomendaría entrenar desde cero un gran modelo geométrico. Primero conviene comprobar si el cuello de botella de nuestras capturas está en poses, escala, paredes, aperturas o muebles. Si la nube ya está deformada, cambiar el modelo de extracción de plano no soluciona el origen del error.

## 9. Disponibilidad y restricciones que afectan a la elección

Se debe distinguir licencia del código, pesos y componentes incorporados. Los siguientes datos proceden de los repositorios y licencias enlazados; la tabla sirve para seleccionar candidatos, no sustituye la revisión de una versión concreta antes de distribuir un producto.

| Componente | Declaración pública relevante | Consecuencia práctica |
|---|---|---|
| MASt3R | Código CC BY-NC-SA 4.0 | No asumir que el repositorio permite incorporarlo directamente al servicio comercial.[^30] |
| Pi3 / Pi3X | Código BSD; pesos CC BY-NC 4.0 | Que el código sea permisivo no vuelve comerciales los pesos.[^6] |
| SpatialLM | Dependencias de encoder/pesos con CC BY-NC 4.0 | La variante basada en Qwen tampoco elimina por sí sola esa restricción.[^29] |
| DA3 Base / Small | Pesos indicados como Apache 2.0 | Candidatos iniciales para evaluar una ruta comercial.[^7] |
| DA3 Metric-Large / Mono-Large | Indicados como Apache 2.0 | La rama métrica puede servir de estimación inicial de escala.[^7] |
| DA3 Large / Giant / Nested | Indicados como CC BY-NC 4.0 | No extrapolar a ellos la licencia de Base o Small.[^7] |
| VGGT-Ω | FAIR Noncommercial Research License | Su licencia restringe también el uso comercial de resultados y salidas.[^31] |
| SAM 3D Objects | Licencia propia SAM | Revisar sus condiciones como componente independiente; no etiquetarlo sin más como MIT o Apache.[^32] |

La elección inicial que propongo para vídeo RGB es **DA3 Base o Small como candidatos geométricos, ajuste estructural explícito y revisión asistida**. Su calidad puede ser inferior a la de variantes mayores: habrá que medir si basta. SpatialLM es una referencia de arquitectura, pero su disponibilidad pública no equivale a autorización para desplegar sus pesos en este producto. Cualquier experimento debe respetar las condiciones aplicables, también durante desarrollo con finalidad comercial.

Para hardware LiDAR, la alternativa es integrar RoomPlan como proveedor de estructura. En ambos casos conviene mantener un contrato de importación propio, de modo que el editor no dependa del formato interno de una red concreta.

## 10. Integración propuesta en Room Designer

La inspección local confirma que el editor ya representa un plano mediante paredes y genera el suelo a partir de un bucle. `FloorPlan.fromCorners` acepta esquinas, y existe un puerto `FloorPlanImporter`. Sin embargo, su entrada actual solo distingue foto o plano vacío; no hay ahí un importador de vídeo implementado.

También hay dos límites relevantes. La sincronización con el asistente y el dominio Python exigen habitaciones rectangulares. Y los muebles guardados se recuperan mediante un identificador de catálogo: si este no existe al cargar, el serializador omite el mueble. Son problemas de integración que deben resolverse para conservar habitaciones irregulares y objetos personales.

| Evidencia local | Implicación |
|---|---|
| [FloorPlanImporter.ts](/Users/carlossoto/desginer/src/app/importers/FloorPlanImporter.ts:1) | Extender el concepto de fuente y el resultado de importación |
| [FloorPlan.ts](/Users/carlossoto/desginer/src/core/model/FloorPlan.ts:1) | Reutilizar paredes y polígonos para la estructura aceptada |
| [scene.ts](/Users/carlossoto/desginer/src/app/designer/scene.ts:39) | Ampliar el contrato del asistente para formas no rectangulares |
| [room.py](/Users/carlossoto/desginer/backend/room_designer/domain/room.py:22) | Generalizar las validaciones geométricas del backend |
| [ProjectSerializer.ts](/Users/carlossoto/desginer/src/app/serialization/ProjectSerializer.ts:153) | Persistir recursos propios del proyecto, sin exigir catálogo externo |
| [Furniture.ts](/Users/carlossoto/desginer/src/core/model/Furniture.ts:1) | Reutilizar posición, giro y relaciones de soporte |
| [Cart.ts](/Users/carlossoto/desginer/src/app/cart/Cart.ts:39) | Distinguir objetos existentes de productos que se van a comprar |

La arquitectura propuesta tiene esta secuencia:

```text
Captura guiada o vídeo aportado
              ↓
Control de cobertura, nitidez y movimiento
              ↓
Geometría 3D + cámaras + escala + evidencia
              ↓
Paredes y aperturas       Instancias de muebles
              ↓                    ↓
Plano paramétrico         Volúmenes / recursos propios
              └─────────┬──────────┘
                        ↓
Revisión de medidas y zonas inferidas
                        ↓
Proyecto editable con historial y guardado
```

Propongo que un resultado intermedio describa unidades, convención de ejes, origen, anclajes de escala, caras interiores de paredes, aperturas e instancias. Cada entidad debe poder conservar su procedencia y la evidencia utilizada. El recurso visual de un objeto se referencia aparte de sus dimensiones y su identidad.

La inferencia con modelos, los ficheros y el almacenamiento pertenecen a adaptadores Python. El dominio recibe datos ordinarios y valida geometría; no debe importar PyTorch ni bibliotecas de visión. El caso de uso de importación convierte un resultado revisado en una operación deshacible. La UI muestra qué corregir y representa la escena.

La adaptación de ejes merece una prueba explícita: el editor usa `y` como altura y `x,z` en planta; SpatialLM documenta `z` vertical. También hay que normalizar metros, centro de los objetos, ángulo de giro y sentido de las paredes para situar correctamente aperturas.

Para permitir ambos modos de trabajo, el proyecto puede conservar los muebles escaneados aunque se oculten en la vista de diseño. Así, «trabajar con habitación vacía» y «volver a ver mis muebles» son decisiones reversibles. Ocultar visualmente y dejar de considerar un objeto en las colisiones deben ser acciones con semántica explícita.

## 11. Prototipo y evaluación que resolverían las dudas

La hipótesis a comprobar es: **una captura guiada produce un plano que se corrige más rápido que dibujarlo desde cero, y conserva suficientes muebles para planificar una redistribución**. Este criterio es más útil que valorar únicamente si la reconstrucción resulta vistosa.

Propongo empezar con una habitación y una sola planta, paredes predominantemente verticales y muebles grandes. Un intervalo inicial de captura de 30–90 segundos y una selección de 40–100 fotogramas pueden servir como parámetros de ensayo; no son requisitos universales ni una promesa de que todas las habitaciones quepan en ese intervalo. La cobertura y el movimiento útil mandan sobre la duración.

El recorrido debe incluir desplazamiento entre posiciones, vistas solapadas, las uniones con el techo cuando ayuden a localizar paredes y perspectivas adicionales de los objetos que se quieran conservar. Conviene mantener iluminación y lente estables. Una rotación rápida de 360 grados desde el centro debe figurar como caso difícil, no como captura ideal.

El primer resultado mostraría un contorno corregible, aperturas propuestas y muebles como volúmenes. La persona confirmaría una medida y revisaría las zonas inciertas antes de entrar al editor. Los modelos fotográficos de muebles llegarían después, por objeto y sin bloquear la edición del plano.

**Diseño del ensayo:** 12–20 habitaciones, capturadas por más de una persona, con varias condiciones: vacías y amuebladas, rectangulares y en L, paredes blancas, armarios que tapen esquinas, espejos, ventanas luminosas y objetos apoyados. En las capturas con LiDAR, conservar también la entrada RGB permite comparar métodos sobre las mismas habitaciones, anotando que sus sensores disponibles son distintos.

Las medidas de referencia deben obtenerse de forma independiente. Una medida empleada para calibrar no puede reutilizarse como única prueba de exactitud. Tampoco debe permitirse una alineación con la escala real durante la evaluación del modo «vídeo sin medidas», porque ocultaría precisamente el error que interesa conocer.

| Aspecto | Qué medir | Por qué cambia la decisión |
|---|---|---|
| Estructura | Error de esquinas y longitudes; contorno y retranqueos omitidos | Determina si el plano sirve para colocar muebles |
| Escala | Error antes y después del anclaje | Separa predicción métrica de calibración asistida |
| Aperturas | Omisiones, falsas detecciones, ancho y posición | Una puerta ausente puede invalidar una distribución |
| Objetos | Dimensiones, orientación, objetos fusionados o duplicados | Determina si conservar muebles aporta utilidad |
| Coherencia física | Salidas de la sala, penetraciones, soportes incorrectos | Verifica que la escena pueda editarse |
| Esfuerzo humano | Tiempo de corrección y tiempo total frente a dibujo manual | Mide el valor real de la función |
| Operación | Fallos completos, latencia, memoria y coste por habitación | Evita optimizar solo ejemplos exitosos |

Como metas iniciales de producto, propondría discutir un error de longitud de pared de hasta 5 cm en la mediana tras calibración, publicar también el percentil 90 y reducir claramente el tiempo total frente al dibujo manual. **Son objetivos por validar**, no precisión atribuida a RoomPlan ni a un paper. Para encajes ajustados debe poder introducirse la medida exacta del hueco y del mueble.

Los datasets públicos permiten complementar el ensayo. Structured3D ofrece interiores sintéticos con anotaciones estructurales; ARKitScenes aporta capturas RGB-D móviles y cajas orientadas; ScanNet++ combina capturas de móvil con datos de referencia de alta calidad.[^33][^34][^35] Ninguno sustituye a vídeos breves de personas que utilizan nuestra interfaz. El entrenamiento sintético y las capturas de laboratorio pueden ocultar errores que aparecen en pisos reales.

La futura implementación debe seguir el TDD del repositorio. Los primeros comportamientos a especificar serían importar un perímetro calibrado, señalar una zona inferida, guardar y restaurar un mueble personal, y deshacer la importación. Los tests de dominio usarían resultados de reconstrucción deterministas; la calidad de visión se evaluaría en un banco separado con referencias geométricas.

## 12. Recomendación

**Sí a construir esta capacidad, empezando por geometría editable y mobiliario aproximado.** La evidencia apoya esa dirección; no apoya prometer una réplica exacta y automática de cualquier habitación a partir de cualquier vídeo.

Si se prioriza demostrar utilidad con la menor incertidumbre geométrica, empezaría con una captura LiDAR mediante RoomPlan, revisión y conversión al modelo del editor. Si se prioriza acceso desde muchos móviles, empezaría con vídeo guiado, un candidato geométrico de licencia adecuada, ajuste de paredes y una medida conocida. En ambos casos mediría el tiempo de corrección antes de invertir en texturas y generación de muebles.

El paso siguiente para mobiliario existente sería asignar identidad a objetos grandes, conservar dimensiones y permitir moverlos como formas aproximadas. Después se puede añadir reconstrucción visual opcional con segmentación y modelos de objetos. La persona conservaría siempre la posibilidad de corregir forma, tamaño y ubicación.

Una entrada de **una sola foto** merece evaluarse como alternativa de menor esfuerzo: generar un borrador de estructura y mobiliario, solicitar una medida cuando sea necesaria y permitir correcciones. Puede cubrir parte del objetivo de diseño sin exigir un recorrido de vídeo. La cobertura incompleta y la geometría inferida deben permanecer explícitas.

La aportación diferencial para Room Designer sería **convertir una captura imperfecta en un proyecto corregible, persistente y utilizable para diseñar**, conservando la distinción entre espacio medido, geometría inferida y apariencia generada.

## Fuentes y notas

[^1]: Yue, Y.; Kontogianni, T.; Schindler, K.; Engelmann, F. *Connecting the Dots: Floorplan Reconstruction Using Two-Level Queries*. CVPR, 2023. [Paper oficial y resumen](https://openaccess.thecvf.com/content/CVPR2023/html/Yue_Connecting_the_Dots_Floorplan_Reconstruction_Using_Two-Level_Queries_CVPR_2023_paper.html). Reconstrucción de polígonos desde escaneos.

[^2]: Avetisyan, A., et al. *SceneScript: Reconstructing Scenes With An Autoregressive Structured Language Model*. 19 de marzo de 2024. [Paper](https://arxiv.org/abs/2403.13064). Representación mediante comandos estructurados.

[^3]: Mao, Y., et al. *SpatialLM: Training Large Language Models for Structured Indoor Modeling*. 9 de junio de 2025; NeurIPS 2025. [Paper](https://arxiv.org/abs/2506.07491). Estructura arquitectónica y cajas orientadas desde nubes de puntos.

[^4]: Proyecto COLMAP. *Tutorial*, documentación oficial, sin fecha editorial única. [Documentación](https://colmap.github.io/tutorial.html). SfM/MVS y recomendaciones de captura.

[^5]: Campos, C., et al. *ORB-SLAM3: An Accurate Open-Source Library for Visual, Visual-Inertial and Multi-Map SLAM*. Julio de 2020, preprint. [Paper](https://arxiv.org/abs/2007.11898). Seguimiento visual e inercial y mapas.

[^6]: Wang, Y., et al. *Pi3 / Pi3X*, repositorio oficial. Pi3, 2025; ampliación Pi3X anunciada el 28 de diciembre de 2025. [Repositorio, capacidades y licencias](https://github.com/yyfz/Pi3). Escala aproximada, condicionamiento y distinción código/pesos.

[^7]: ByteDance-Seed. *Depth Anything 3*, repositorio oficial, publicado inicialmente en noviembre de 2025. [Modelos y licencias](https://github.com/ByteDance-Seed/Depth-Anything-3). Familias métricas y relativas; licencia por variante.

[^8]: Apple Machine Learning Research. *3D Parametric Room Representation with RoomPlan*. 4 de octubre de 2022. [Descripción técnica](https://machinelearning.apple.com/research/roomplan). Estimación de estructura y objetos en captura RGB-D.

[^9]: Apple Developer. *RoomPlan*, documentación oficial, sin fecha editorial única. [API](https://developer.apple.com/documentation/roomplan). Representación paramétrica modificable.

[^10]: Google for Developers. *Depth adds realism — ARCore*. Actualización indicada: 4 de septiembre de 2026. [Documentación](https://developers.google.com/ar/develop/depth). Profundidad por movimiento, sensores y límites de captura.

[^11]: Open3D. *Point cloud: Plane segmentation*. Documentación oficial. [RANSAC y planos](https://www.open3d.org/html/tutorial/geometry/pointcloud.html). Operación geométrica de ajuste robusto.

[^12]: Sun, C.; Hsiao, C.-W.; Sun, M.; Chen, H.-T. *HorizonNet: Learning Room Layout with 1D Representation and Pano Stretch Data Augmentation*. CVPR 2019. [Paper](https://arxiv.org/abs/1901.03861). Estimación de estructura desde panoramas.

[^13]: Carion, N., et al. *SAM 3: Segment Anything with Concepts*. 20 de noviembre de 2025. [Paper](https://arxiv.org/abs/2511.16719). Segmentación y seguimiento por conceptos en imagen y vídeo.

[^14]: Avetisyan, A., et al. *Scan2CAD: Learning CAD Model Alignment in RGB-D Scans*. Preprint de 2018; CVPR 2019. [Paper](https://arxiv.org/abs/1811.11187). Alineamiento de objetos CAD con geometría incompleta.

[^15]: SAM 3D Team, et al. *SAM 3D: 3Dfy Anything in Images*. 20 de noviembre de 2025. [Paper](https://arxiv.org/abs/2511.16624). Reconstrucción generativa de geometría, textura y colocación.

[^16]: Ansari, J. A.; Ding, R.; Pizzati, F.; Laptev, I. *MessyKitchens: Contact-rich object-level 3D scene reconstruction*. 17 de marzo de 2026, preprint. [Paper](https://arxiv.org/abs/2603.16868). Reconstrucción de múltiples objetos y coherencia de contactos.

[^17]: Ingka Group. *IKEA launches new AI-powered experience; IKEA Kreativ*. 22 de junio de 2022. [Comunicado oficial](https://www.ingka.com/newsroom/ikea-launches-new-ai-powered-experience-empowering-customers-to-create-lifelike-room-designs/). Tecnología declarada y funciones del lanzamiento.

[^18]: IKEA Kreativ Help. *Will the app work on my smartphone?* Actualización indicada: 15 de mayo de 2025. [Compatibilidad y modos de escaneo](https://support.home-design.ikea.com/hc/en-us/articles/360039289854-Will-the-app-work-on-my-smartphone). Full Room Scan y LiDAR.

[^19]: IKEA Kreativ Help. *What can I design in my space?* Versión de Nueva Zelanda; actualización indicada: 1 de diciembre de 2025. [Funciones documentadas](https://support.home-design.ikea.com/hc/en-nz/articles/360038999793-What-can-I-design-in-my-space). Edición de mobiliario y borrado del existente; disponibilidad regional.

[^20]: Suvorov, R., et al. *Resolution-robust Large Mask Inpainting with Fourier Convolutions*. Septiembre de 2021, preprint; LaMa. [Paper](https://arxiv.org/abs/2109.07161). Completado visual de regiones grandes.

[^21]: Kerbl, B.; Kopanas, G.; Leimkühler, T.; Drettakis, G. *3D Gaussian Splatting for Real-Time Radiance Field Rendering*. SIGGRAPH / ACM TOG, 2023. [Proyecto y paper](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/). Representación de apariencia y síntesis de vistas.

[^22]: Kim, S. J.; Cao, D. D.; Spinola, F.; Lee, S. J.; Cho, K. S. *RoomRecon: High-Quality Textured Room Layout Reconstruction on Mobile Devices*. 21 de abril de 2026, preprint. [Paper](https://arxiv.org/abs/2604.19025). Captura RGB-D y texturizado de elementos permanentes.

[^23]: Wang, S., et al. *DUSt3R: Geometric 3D Vision Made Easy*. Preprint de diciembre de 2023; CVPR 2024. [Paper](https://arxiv.org/abs/2312.14132). Reconstrucción aprendida mediante mapas de puntos.

[^24]: Leroy, V.; Cabon, Y.; Revaud, J. *Grounding Image Matching in 3D with MASt3R*. ECCV 2024. [Paper](https://arxiv.org/abs/2406.09756). Correspondencias densas apoyadas en geometría 3D.

[^25]: Murai, R.; Dexheimer, E.; Davison, A. J. *MASt3R-SLAM: Real-Time Dense SLAM with 3D Reconstruction Priors*. Preprint del 16 de diciembre de 2024; CVPR 2025. [Paper](https://arxiv.org/abs/2412.12392). Reconstrucción densa y seguimiento monocular.

[^26]: Wang, J., et al. *VGGT: Visual Geometry Grounded Transformer*. 14 de marzo de 2025. [Paper](https://arxiv.org/abs/2503.11651). Inferencia conjunta de atributos geométricos multivista.

[^27]: Lin, H., et al. *Depth Anything 3: Recovering the Visual Space from Any Views*. Noviembre de 2025; ICLR 2026. [Paper](https://arxiv.org/abs/2511.10647) y [publicación de la conferencia](https://proceedings.iclr.cc/paper_files/paper/2026/hash/e4cd50120b6d7e8daff1749d6bbaa889-Abstract-Conference.html). Geometría consistente con poses opcionales.

[^28]: Wang, J., et al. *VGGT-Ω*. 14 de mayo de 2026; CVPR 2026. [Paper](https://arxiv.org/abs/2605.15195). Ampliación del modelo geométrico; no se usan anuncios posteriores al corte temporal del informe.

[^29]: Manycore Research. *SpatialLM*, repositorio oficial, versiones 1.0/1.1 de 2025. [Ejemplos, benchmark y componentes licenciados](https://github.com/manycore-research/SpatialLM). Condiciones de entrada, resultados de vídeo y restricciones de dependencias.

[^30]: NAVER. *MASt3R*, repositorio oficial. [Sección de licencia](https://github.com/naver/mast3r#license). Código CC BY-NC-SA 4.0.

[^31]: Meta. *VGGT-Ω LICENSE — FAIR Noncommercial Research License*. Texto base fechado el 16 de octubre de 2024. [Licencia distribuida con el proyecto](https://github.com/facebookresearch/vggt-omega/blob/main/LICENSE). Restricciones de investigación no comercial.

[^32]: Meta. *SAM License*. 19 de noviembre de 2025. [Licencia de SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects/blob/main/LICENSE). Condiciones propias del código y pesos.

[^33]: Zheng, J., et al. *Structured3D Dataset*. 2020. [Proyecto oficial](https://structured3d-dataset.org/). Datos sintéticos con anotaciones estructurales y condiciones de acceso.

[^34]: Baruch, G., et al. *ARKitScenes: A Diverse Real-World Dataset for 3D Indoor Scene Understanding Using Mobile RGB-D Data*. NeurIPS Datasets and Benchmarks, 2021. [Repositorio oficial](https://github.com/apple-aiml-research/ARKitScenes). Capturas móviles, poses y cajas de objetos.

[^35]: Yeshwanth, C.; Liu, Y.-C.; Nießner, M.; Dai, A. *ScanNet++: A High-Fidelity Dataset of 3D Indoor Scenes*. ICCV 2023; ampliaciones de datos posteriores. [Proyecto oficial](https://scannetpp.mlsg.cit.tum.de/scannetpp/). Referencia geométrica, imágenes y RGB-D de móvil.

[^36]: IKEA Australia. *How do I upload a photo of my room in IKEA Kreativ?* Sin fecha editorial indicada. [Instrucciones oficiales de carga de una foto](https://www.ikea.com/au/en/customer-service/knowledge/articles/72d1c246-7e5e-4363-be6f-26995391bffe.html). Modalidad de foto existente en app y web.

[^37]: IKEA United States. *How can I improve my IKEA Kreativ scan?* Sin fecha editorial indicada. [Instrucciones oficiales de escaneo](https://www.ikea.com/us/en/customer-service/knowledge/articles/fgcb98bc-357d-4676-b9b1-d2g8cg90736b.html). Panorámica, movimientos en ocho y segunda captura con desplazamiento.

[^38]: Yan, K.; Luan, F.; Hašan, M.; Groueix, T.; Deschaintre, V.; Zhao, S. *PSDR-Room: Single Photo to Scene using Differentiable Rendering*. 6 de julio de 2023. [Paper](https://arxiv.org/abs/2307.03244). Reconstrucción de escena editable y optimización de apariencia desde una fotografía.

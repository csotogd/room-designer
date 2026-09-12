# Pipeline Python

Instala `.[mesh,clip]` según el README raíz y activa `.venv`. Todos los pasos
se ejecutan con `catalog`; los alias `npm run pipeline:*` siguen disponibles.

```bash
catalog ingest --site polyhaven
catalog ingest --site sketchfab --limit 20
catalog ingest --site sklum --limit 20
catalog generate --site sklum --count 5
catalog judge --site sklum
catalog judge --site sklum --set chair-id=rejected --reason 'geometría rota'
catalog link --site polyhaven
catalog sync --verify
catalog eval
```

`--out` cambia `data/catalog`. `CATALOG_SITE` selecciona sitio activo; link
de otro sitio publica su índice pero no reemplaza el índice de búsqueda activo.
`--country` se acepta por compatibilidad con los jobs actuales; cada fuente
tiene su país fijo (`sklum=es`, bibliotecas=`int`).

Fuentes: JSON-LD Sklum, API Poly Haven con glTF nativo y API Sketchfab con GLB.
Sketchfab necesita `SKETCHFAB_API_TOKEN` para descargar el modelo; sin token
se conservan metadatos y fotografías. Licencia y autor viajan hasta el frontend.

`GENERATOR=trellis|trellis1|tripo` selecciona generador. TRELLIS necesita el
extra `[mesh]` y admite `HF_TOKEN`; Tripo necesita `TRIPO_API_KEY`.
`JUDGE_PROVIDER=gemini|anthropic|openai`, `JUDGE_MODEL`, `JUDGE_API_KEY` y
`JUDGE_BASE_URL` configuran la revisión visual mediante ADK. También se
aceptan las claves estándar de cada proveedor. Sin juez configurado se
mantiene la aprobación no-op anterior. El juez visual exige packshot y render;
si falta alguno deja `pending` en vez de inferir la calidad de una malla no vista.

Los checkpoints son atómicos. Si falla el juez después de generar una malla,
ésta queda guardada para no volver a pagar por generarla. `catalog judge`
retoma modelos sin veredicto; `--all` fuerza reevaluar los existentes.
Los productos rechazados se excluyen del catálogo publicado.

La imagen Docker tiene `ENTRYPOINT ["catalog"]`. El worker HTTP Pub/Sub
`serve-generator` del plan Terraform continúa pendiente; no forma parte del
pipeline local implementado ni se presenta como desplegado.

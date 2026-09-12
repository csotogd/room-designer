# Infraestructura GCP por entorno

La guía de activación, permisos, pruebas y límites está en
[CI/CD con Cloud Build](../../docs/CI-CD.md).

`dev`, `stage` y `prod` utilizan proyectos, estados, identidades y datos
separados. `infra/bootstrap` prepara APIs, WIF, Cloud Build y repositorios.
Este módulo administra el editor y los recursos de la aplicación; consume
el digest probado por Cloud Build.

El editor tiene una imagen desplegable. El catálogo cloud **todavía no**:
faltan el generador HTTP y los adaptadores de datos y cola. La validación
bloquea `enable_catalog_runtime=true`; no se lanzan ingestas de pago ni se
inventan valores de secretos.

## Validación sin crear recursos

```bash
tofu -chdir=infra/gcp init -backend=false -input=false
tofu fmt -check -recursive infra
tofu -chdir=infra/gcp validate
tofu -chdir=infra/gcp test
```

Estos tests usan un proveedor simulado. La verificación real posterior a la
entrega es `ops/cloud_smoke.py`, descrita con sus límites en la guía.

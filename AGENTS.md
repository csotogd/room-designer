# Cómo se trabaja en este repo

Disciplina: **TDD estricto** (Beck / Martin) con las especificaciones Gherkin
como fuente de verdad del comportamiento. Estas reglas mandan sobre cualquier
atajo que parezca más rápido, y aplican igual a Claude Code, a Codex y a una
persona.

## El ciclo

Ningún cambio de comportamiento empieza por el código de producción.

1. **Escenario.** Si el cambio es comportamiento observable, se escribe primero
   en `specs/features/*.feature` como un `Scenario:`. Si es un detalle interno
   (refactor, rendimiento), se salta al paso 3.
2. **Aceptación en rojo.** Un test en `tests/acceptance/*.test.ts` con
   `scenario('…')`, o en `backend/tests/test_*.py` con `@scenario("…")`, usando
   el **nombre exacto** del escenario. Se ejecuta y **se comprueba que falla**
   antes de seguir. Un test que nunca se vio en rojo no prueba nada.
3. **Unit en rojo.** El test unitario más pequeño que falla. No compilar cuenta
   como fallar.
4. **Verde.** El mínimo código de producción que lo pasa. Si sobra lógica "para
   luego", sobra de verdad: bórrala.
5. **Refactor.** Obligatorio, no opcional. Con la suite en verde se elimina
   duplicación y se mejora la expresión. Es el único momento seguro para
   limpiar, así que se usa siempre.
6. Volver al 3 hasta que el escenario de aceptación está verde.

Las tres leyes, por si hay duda en un paso concreto:

- No hay código de producción sin un test que ya falla.
- No hay más test del mínimo necesario para fallar.
- No hay más producción que la mínima para pasar ese fallo.

Si te atascas eligiendo el siguiente paso, haz el test **más específico** y el
código **más genérico**: constante → variable, incondicional → `if`,
valor → colección, iteración → recursión.

## Puertas · el build nunca se queda roto

Antes de dar por terminado cualquier cambio, y antes de commit:

```bash
npm run test:all && npm run typecheck && npm run lint:backend
```

Si tocaste `src/core` o `src/app`, además:

```bash
npx stryker run
```

Un build en rojo se arregla **antes** que cualquier otra cosa. No se avanza con
la suite en rojo ni se deja para el final.

Qué se ejecuta en CI (`.github/workflows/ci.yml`): ruff + pytest, typecheck,
vitest con cobertura, la puerta de specs por separado, build de producción,
mutación y `tofu fmt`/`validate` sobre `infra/gcp`.

## Reglas que no se negocian

- **No se toca un test para que pase.** Si un test falla, el sospechoso es el
  código. Cambiar la aserción solo vale si el escenario Gherkin cambió primero.
- **No se bajan los umbrales.** Cobertura (`vite.config.ts`: 88% líneas /
  funciones / statements, 75% ramas) y mutación (`stryker.config.json`: rompe
  por debajo de 75%) son puertas, no métricas decorativas. Subirlos, sí.
- **No se añade a `mutate` una exclusión** en `stryker.config.json` para evitar
  escribir el test que falta.
- **No se borra ni se marca como `skip`/`todo`** un test que molesta.
- **Ningún escenario sin test.** La puerta `spec-coverage` lo comprueba; no la
  esquives renombrando el escenario.
- **Las reglas de dependencias son tests**, no sugerencias: si un import las
  rompe, el diseño está mal, no el test.

## Arquitectura

`ui → app → core`, nunca al revés (verificado en
`tests/architecture/dependency-rule.test.ts`):

- `src/core` — dominio puro. **Sin imports externos**: ni Three.js, ni DOM, ni
  librerías. Solo imports relativos dentro de `core`.
- `src/app` — casos de uso. Solo depende de `core` y de sí misma; tampoco
  importa paquetes externos.
- `src/ui` — Three.js, canvas y DOM. Es la capa tonta: aquí no hay reglas de
  negocio.

En el backend, lo mismo (verificado en `backend/tests/test_architecture.py`):
`room_designer/domain` y `room_designer/application` no pueden importar
`google`, `litellm`, `httpx`, `fastapi`, `uvicorn`, ni `adapters`, `bootstrap`,
`config` o `pipeline`. Además, `domain` no importa `application`.

El framework, la red y el almacenamiento son **detalles**: viven en `adapters`
y entran al dominio por un puerto. Si algo no se puede testear sin levantar un
servidor, está en la capa equivocada.

## Cómo son los tests aquí

- **Rápidos, independientes, repetibles, autoverificables** y escritos justo
  antes del código. Ninguno depende del orden ni del resultado de otro.
- **Un concepto por test.** Varias aserciones sobre el mismo concepto, bien.
- Estructura **preparar → ejecutar → comprobar**.
- Los tests de aceptación se leen en el lenguaje del dominio, no en el de la
  API: la ayuda está en `tests/acceptance/gherkin.ts` y en las fixtures de
  `backend/tests/conftest.py`. Si un test de aceptación se lee como código de
  fontanería, falta una función de ayuda.
- **No se prueban reglas de negocio a través de la UI.** Se prueban contra
  `core`/`app` y `domain`/`application`.
- Los proveedores remotos (ADK, CLIP, VLM) se simulan con fakes deterministas.
  Ningún test toca la red.
- El código de test se mantiene tan limpio como el de producción.

Dónde va cada test:

| Carpeta | Para qué |
|---|---|
| `tests/unit`, `backend/tests/test_*.py` | TDD del dominio |
| `tests/acceptance` | uno por escenario Gherkin |
| `tests/property` | invariantes con fast-check (solapes, round-trip, clamps, apilado) |
| `tests/integration` | TS ↔ Python con el backend real y proveedores fake |
| `tests/architecture` | reglas de dependencias |
| `qa/QA-PROCEDURE.md` | exploratorio manual sobre la app real |

## Comandos

```bash
npm run dev            # editor en http://localhost:5173
npm run test:all       # Python + frontend + integración
npm test               # vitest en watch
npx vitest run tests/unit/wall.test.ts   # un solo fichero
npm run test:backend   # pytest
npm run typecheck
npm run lint:backend
npx stryker run
```

Servicios: `npm run search:serve` y `npm run designer:serve` (CLIs Python).

## Convenciones

- Documentación, comentarios y mensajes de commit **en español**; el código y
  los nombres de escenario Gherkin, en inglés.
- Commits en imperativo y en una línea que dice el efecto, no el fichero
  tocado: `Verifica altura 3D al editar y restaurar muebles`.
- Comentarios solo cuando explican un **porqué** que el código no puede decir.
- Al terminar, se deja el sitio más limpio de como estaba.

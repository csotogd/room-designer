# Room Designer

Diseñador de habitaciones al estilo de los configuradores de las grandes marcas de mobiliario, **3D-first**: creas la
habitación desde un menú (forma + medidas), y todo lo demás se hace dentro de
la escena 3D — eliges del catálogo, un fantasma sigue al cursor, haces clic
para colocar, pinchas y arrastras para mover, y al soltar queda fijo. Puertas
y ventanas se deslizan por su pared; los muebles se apilan (el jarrón viaja
con la mesa); las luces se regulan en vivo y el sol sigue la hora del día.

## Uso

```bash
npm install
npm run dev        # abre http://localhost:5173
npm test           # suite completa (unitarios + aceptación + propiedades + arquitectura)
npm run typecheck
npx stryker run    # mutation testing
```

**En la app:** el asistente tiene dos pasos — forma/medidas y **puertas y
ventanas sobre el plano** — y después colocas desde el panel izquierdo
(Muebles / Puertas y ventanas / Luces) haciendo clic en la escena: los
muebles son modelos con textura (cama con edredón y almohadas, armario con
puertas, sofá con cojines…) y **no pueden salir de la habitación**. Pincha
cualquier objeto para seleccionarlo y arrástralo; R rota, Supr borra, Ctrl+Z
deshace, Esc cancela/fija. Todo lo colocado suma en el **carrito** (🛒 en la
barra superior) con precios y total. El botón *Plano* abre el plano 2D.

**Producción:** el plan de migración a front + back con gRPC (Connect-ES),
con los contratos ya definidos, está en [ARCHITECTURE.md](ARCHITECTURE.md) y
[proto/roomdesigner/v1/roomdesigner.proto](proto/roomdesigner/v1/roomdesigner.proto).
Los puertos del front (`FurnitureCatalog`, `ProjectRepository`) ya existen y
hoy los implementan adaptadores locales.

## Arquitectura

Regla de dependencias estricta (verificada por test): `ui → app → core`, nunca
al revés. `core` no importa nada externo.

```
src/
  core/            Dominio puro (sin Three.js, sin DOM)
    geometry/      Point2D, Point3D, Segment, Polygon
    model/         Project, FloorPlan, Wall, Opening(Door/Window),
                   Furniture (apilable via supportedBy), LightPoint, Sun
    events/        EventEmitter tipado (las vistas observan el dominio)
  app/             Casos de uso
    commands/      Command + CommandStack (undo/redo)
    catalog/       FurnitureCatalog (puerto) + DefaultCatalog (primitivas)
    serialization/ JSON versionado
    importers/     FloorPlanImporter — punto de extensión "foto → plano"
  ui/
    view2d/        Canvas + herramientas (patrón Strategy)
    view3d/        Three.js: builders (extrusión de paredes con huecos),
                   rig de luz (base garantizada + sol + luces del usuario)
```

Decisiones clave:

- **El plano 2D es la fuente de verdad**; el 3D se genera por extrusión.
  Las aperturas viven paramétricamente en su pared (offset/ancho/alto).
- **Posición 3D + rotación escalar**: los objetos usan `Point3D` y un ángulo
  sobre el eje vertical; no hay cuaterniones en el dominio.
- **Apilado semántico**: `Furniture.supportedBy` — mover la mesa mueve el
  jarrón; borrarla lo deja caer al suelo.
- **La luz es dominio**: `LightPoint` (intensidad, temperatura de color,
  on/off) se serializa con el proyecto. El renderer garantiza una luz base
  para que la escena nunca sea negra, y el sol entra por las ventanas según
  la hora del día.

## Calidad (Agentic Discipline)

- `specs/features/*.feature` — especificaciones Gherkin (fuente de verdad del
  comportamiento). Un test-puerta (`spec-coverage`) falla si algún escenario
  se queda sin test de aceptación.
- `tests/unit` — TDD del dominio.
- `tests/acceptance` — un test por escenario Gherkin.
- `tests/property` — property-based testing con fast-check (invariantes:
  aperturas nunca solapadas, round-trip de serialización, clamps, apilado).
- `tests/architecture` — la regla de dependencias como test.
- `stryker.config.json` — mutation testing sobre `core` y `app`.
- `qa/QA-PROCEDURE.md` — procedimiento de QA sobre la app real.

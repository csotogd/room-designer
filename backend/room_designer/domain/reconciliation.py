"""Three-way merge of human edits. Unrelated objects merge; conflicts never overwrite."""

from copy import deepcopy

from room_designer.domain.room import Json, finite, validate_room

DEFAULT_ENVIRONMENT = {
    "timeOfDay": 12,
    "lights": [],
    "finishes": {
        "wall": {"material": "paint", "color": "#f2eee4"},
        "floor": {"material": "wood", "color": "#d9c5a3"},
    },
}


def scene_snapshot(state: Json) -> Json:
    """Canonical wire representation; metadata, prompts and scores are server-owned."""
    snapshot = {
        "room": deepcopy(state.get("room")),
        "openings": [
            {
                **{k: o[k] for k in ("wall", "kind", "offset", "width")},
                "height": o.get("height", 2 if o["kind"] == "door" else 1.1),
                "sillHeight": o.get("sillHeight", 0 if o["kind"] == "door" else 0.9),
            }
            for o in state.get("openings", [])
        ],
        "items": sorted(
            [
                {
                    **{k: i[k] for k in ("uid", "productId", "x", "y", "z")},
                    "rotDeg": round(i["rotDeg"] % 360, 9),
                    "supportedBy": i.get("supportedBy"),
                }
                for i in state.get("items", [])
            ],
            key=lambda i: i["uid"],
        ),
        "environment": deepcopy(state.get("environment", DEFAULT_ENVIRONMENT)),
    }

    snapshot["openings"].sort(key=lambda o: (o["wall"], o["offset"]))
    snapshot["environment"]["lights"].sort(key=lambda light: light["id"])

    def canonical(value):
        if isinstance(value, float):
            return round(value, 9)
        if isinstance(value, list):
            return [canonical(v) for v in value]
        if isinstance(value, dict):
            return {k: canonical(v) for k, v in value.items()}
        return value

    return canonical(snapshot)


def _object(value, name):
    if not isinstance(value, dict):
        raise ValueError(f"{name} debe ser un objeto")
    return value


def _list(value, name, limit=1000):
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError(f"{name} debe ser una lista de hasta {limit} elementos")
    return value


def _id(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 128:
        raise ValueError("Identificador inválido")
    return value


def validate_scene(raw: Json, catalog: dict[str, Json]) -> Json:
    raw = _object(raw, "scene")
    room = raw.get("room")
    openings = _list(raw.get("openings"), "openings", 100)
    items = _list(raw.get("items"), "items")
    if room is None:
        if openings or items:
            raise ValueError("Crea la habitación antes de añadir objetos")
    else:
        _object(room, "room")
        for opening in openings:
            _object(opening, "opening")
        validate_room(room, openings)
        room = {k: room[k] for k in ("shape", "w", "d", "h")}
    for opening in openings:
        height = finite(opening.get("height"), "height")
        sill = finite(opening.get("sillHeight"), "sillHeight")
        if height <= 0 or sill < 0 or height + sill > room["h"] + 1e-6:
            raise ValueError("La apertura supera la altura de la habitación")
    seen = set()
    for item in items:
        _object(item, "item")
        uid = _id(item.get("uid"))
        if uid in seen:
            raise ValueError("uid duplicado")
        seen.add(uid)
        if not isinstance(item.get("productId"), str) or item["productId"] not in catalog:
            raise ValueError("Producto desconocido")
        for field in ("x", "y", "z", "rotDeg"):
            finite(item.get(field), field)
        if not (
            -1e-6 <= item["x"] <= room["w"] + 1e-6
            and -1e-6 <= item["z"] <= room["d"] + 1e-6
            and 0 <= item["y"] <= room["h"]
        ):
            raise ValueError("El objeto está fuera de la habitación")
        if item.get("supportedBy") is not None:
            _id(item["supportedBy"])
    parents = {i["uid"]: i.get("supportedBy") for i in items}
    for uid in parents:
        visited = {uid}
        parent = parents[uid]
        while parent is not None:
            if parent not in parents or parent in visited:
                raise ValueError("Soporte inexistente o circular")
            visited.add(parent)
            parent = parents[parent]
    environment = _object(raw.get("environment", deepcopy(DEFAULT_ENVIRONMENT)), "environment")
    hour = finite(environment.get("timeOfDay"), "timeOfDay")
    if not 0 <= hour < 24:
        raise ValueError("Hora inválida")
    lights = _list(environment.get("lights"), "lights", 100)
    light_ids = set()
    for light in lights:
        _object(light, "light")
        uid = _id(light.get("id"))
        if uid in light_ids or light.get("kind") not in ("ceiling", "wall", "floor"):
            raise ValueError("Luz inválida o duplicada")
        light_ids.add(uid)
        position = _object(light.get("position"), "position")
        for key in ("x", "y", "z"):
            if abs(finite(position.get(key), key)) > 100:
                raise ValueError("Posición de luz inválida")
        if not isinstance(light.get("on"), bool) or not 0 <= finite(light.get("intensity"), "intensity") <= 1:
            raise ValueError("Intensidad inválida")
        if not 2000 <= finite(light.get("temperatureK"), "temperatureK") <= 6500:
            raise ValueError("Temperatura de luz inválida")
    finishes = _object(environment.get("finishes"), "finishes")
    for part, materials in (
        ("wall", ("paint", "stripes", "brick")),
        ("floor", ("wood", "tiles", "carpet", "concrete")),
    ):
        finish = _object(finishes.get(part), part)
        color = finish.get("color")
        if finish.get("material") not in materials or not isinstance(color, str) or len(color) != 7:
            raise ValueError("Acabado inválido")
        if color[0] != "#" or any(c not in "0123456789abcdefABCDEF" for c in color[1:]):
            raise ValueError("Color inválido")
    # Whitelist all nested values; UI payloads cannot inject conversation or verdict metadata.
    clean_env = {
        "timeOfDay": hour,
        "finishes": {p: {k: finishes[p][k] for k in ("material", "color")} for p in ("wall", "floor")},
        "lights": [
            {
                **{k: light[k] for k in ("id", "kind", "on", "intensity", "temperatureK")},
                "position": {k: light["position"][k] for k in ("x", "y", "z")},
            }
            for light in lights
        ],
    }
    return scene_snapshot({"room": room, "openings": openings, "items": items, "environment": clean_env})


def merge_scene(base: Json, local: Json, remote: Json) -> tuple[Json, list[str]]:
    """Atomic batch. A layout edit requires an unchanged scene because coordinates depend on it."""
    conflicts = []

    def merge(before, after, current, key):
        if after == before or after == current:
            return deepcopy(current)
        if current == before:
            return deepcopy(after)
        conflicts.append(key)
        return deepcopy(current)

    def entities(before, after, current, id_key, label):
        b, a, c = [{item[id_key]: item for item in rows} for rows in (before, after, current)]
        result = {
            uid: merge(b.get(uid), a.get(uid), c.get(uid), f"{label}:{uid}")
            for uid in sorted(b.keys() | a.keys() | c.keys())
        }
        return [item for item in result.values() if item is not None]

    layout = ("room", "openings")
    local_layout = any(base[k] != local[k] for k in layout)
    remote_layout = any(base[k] != remote[k] for k in layout)
    if (local_layout and remote != base and local != remote) or (
        remote_layout and local != base and local != remote
    ):
        return deepcopy(remote), ["habitación"]
    result = {k: merge(base[k], local[k], remote[k], k) for k in layout}
    result["items"] = entities(base["items"], local["items"], remote["items"], "uid", "mueble")
    b, a, c = [s["environment"] for s in (base, local, remote)]
    result["environment"] = {
        "timeOfDay": merge(b["timeOfDay"], a["timeOfDay"], c["timeOfDay"], "hora"),
        "lights": entities(b["lights"], a["lights"], c["lights"], "id", "luz"),
        "finishes": {
            part: merge(b["finishes"][part], a["finishes"][part], c["finishes"][part], part)
            for part in ("wall", "floor")
        },
    }
    return result, conflicts

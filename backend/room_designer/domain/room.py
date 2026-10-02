"""Room mutations and conservative geometry. No framework or I/O dependencies."""

from copy import deepcopy
from math import cos, isfinite, pi, sin
from typing import Any
from uuid import uuid4

EPS = 1e-6
Json = dict[str, Any]


def empty_state() -> Json:
    return {"version": 1, "room": None, "openings": [], "items": [], "log": []}


def finite(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not isfinite(value):
        raise ValueError(f"{name} debe ser un número finito")
    return value


def validate_room(room: Json, openings: list[Json]) -> None:
    if room.get("shape") != "rect":
        raise ValueError("La habitación debe ser rectangular")
    for key in ("w", "d", "h"):
        if not 0 < finite(room.get(key), key) <= 100:
            raise ValueError("Las medidas deben estar entre 0 y 100 metros")
    for i, opening in enumerate(openings):
        wall = opening.get("wall")
        if wall not in ("N", "S", "E", "W") or opening.get("kind") not in ("door", "window"):
            raise ValueError("Apertura inválida")
        offset = finite(opening.get("offset"), "offset")
        width = finite(opening.get("width"), "width")
        if offset < 0 or width <= 0 or offset + width > room["w" if wall in ("N", "S") else "d"]:
            raise ValueError("La apertura sale de la pared")
        if any(
            o["wall"] == wall
            and offset < o["offset"] + o["width"] - EPS
            and offset + width > o["offset"] + EPS
            for o in openings[:i]
        ):
            raise ValueError("Las aperturas se solapan")


def footprint(item: Json, product: Json) -> tuple[float, float, float, float]:
    rad = item["rotDeg"] * pi / 180
    hx = (abs(cos(rad)) * product["width"] + abs(sin(rad)) * product["depth"]) / 2
    hz = (abs(sin(rad)) * product["width"] + abs(cos(rad)) * product["depth"]) / 2
    return item["x"] - hx, item["x"] + hx, item["z"] - hz, item["z"] + hz


def overlaps(a: tuple, b: tuple) -> bool:
    return a[0] < b[1] - EPS and a[1] > b[0] + EPS and a[2] < b[3] - EPS and a[3] > b[2] + EPS


def zone_contains(zone: Json, box: tuple) -> bool:
    return (box[0] >= zone["x"] - EPS and box[1] <= zone["x"] + zone["w"] + EPS
            and box[2] >= zone["z"] - EPS and box[3] <= zone["z"] + zone["d"] + EPS)


def validate_zones(room: Json, zones: list[Json]) -> None:
    if not room or not isinstance(zones, list) or not 1 <= len(zones) <= 12:
        raise ValueError("Define entre 1 y 12 zonas dentro de una habitación")
    seen, boxes = set(), []
    for zone in zones:
        if not isinstance(zone, dict):
            raise ValueError("Zona inválida")
        for key in ("id", "name"):
            if not isinstance(zone.get(key), str) or not 1 <= len(zone[key].strip()) <= 100:
                raise ValueError("Cada zona necesita identificador y nombre")
        if zone["id"] in seen:
            raise ValueError("Identificador de zona duplicado")
        seen.add(zone["id"])
        x, z, w, d = [finite(zone.get(k), k) for k in ("x", "z", "w", "d")]
        box = (x, x + w, z, z + d)
        if w <= 0 or d <= 0 or not zone_contains({"x": 0, "z": 0, **room}, box):
            raise ValueError("La zona sale de la habitación")
        if any(overlaps(box, other) for other in boxes):
            raise ValueError("Las zonas se solapan")
        boxes.append(box)


def vertical_overlap(bottom: float, top: float, other_bottom: float, other_top: float) -> bool:
    return bottom < other_top - EPS and top > other_bottom + EPS


def opening_zone(o: Json, room: Json) -> tuple:
    clearance = o["width"] if o["kind"] == "door" else 0.75
    start, end = o["offset"], o["offset"] + o["width"]
    return {
        "N": (start, end, 0, clearance),
        "S": (start, end, room["d"] - clearance, room["d"]),
        "W": (0, clearance, start, end),
        "E": (room["w"] - clearance, room["w"], start, end),
    }[o["wall"]]


def violations(state: Json, catalog: dict[str, Json], item: Json, zone: Json | None = None) -> list[str]:
    product = catalog.get(item["productId"])
    if product is None:
        return ["unknown-product"]
    if not state["room"]:
        return ["outside"]
    try:
        for key in ("x", "y", "z", "rotDeg"):
            finite(item.get(key), key)
    except ValueError:
        return ["outside"]
    result = []
    bottom, top = item["y"], item["y"] + product["height"]
    if bottom < 0:
        result.append("below-floor")
    box, room = footprint(item, product), state["room"]
    if box[0] < -EPS or box[2] < -EPS or box[1] > room["w"] + EPS or box[3] > room["d"] + EPS:
        result.append("outside")
    if zone is not None and not zone_contains(zone, box):
        result.append("outside-zone")
    if top > room["h"] + EPS:
        result.append("above-ceiling")
    for o in state["openings"]:
        sill = o.get("sillHeight", 0 if o["kind"] == "door" else 0.9)
        height = o.get("height", 2 if o["kind"] == "door" else 1.1)
        if overlaps(box, opening_zone(o, room)) and vertical_overlap(bottom, top, sill, sill + height):
            result.append("blocks-" + o["kind"])
    for other in state["items"]:
        if other["uid"] != item["uid"] and other["productId"] in catalog:
            other_product = catalog[other["productId"]]
            if overlaps(box, footprint(other, other_product)) and vertical_overlap(
                bottom, top, other["y"], other["y"] + other_product["height"]
            ):
                result.append("collision")
    return result


def repair(state: Json, catalog: dict[str, Json], item: Json, rotate: bool = True, zone: Json | None = None) -> Json | None:
    for key in ("x", "y", "z", "rotDeg"):
        finite(item.get(key), key)
    # Horizontal repair must never silently change an explicitly chosen height.
    if any(
        v in ("unknown-product", "below-floor", "above-ceiling") for v in violations(state, catalog, item)
    ):
        return None
    for r in range(11):
        radius = r * 0.25
        points = max(8, int(2 * pi * radius / 0.25 + 0.5)) if r else 1
        for point in range(points):
            angle = 2 * pi * point / points
            for rotation in [item["rotDeg"], (item["rotDeg"] + 90) % 360] if rotate else [item["rotDeg"]]:
                candidate = dict(
                    item,
                    x=item["x"] + radius * cos(angle),
                    z=item["z"] + radius * sin(angle),
                    rotDeg=rotation,
                )
                if not violations(state, catalog, candidate, zone):
                    return candidate
    return None


def dependents(state: Json, uid: str) -> list[Json]:
    found, ids = [], {uid}
    while True:
        added = [i for i in state["items"] if i["uid"] not in ids and i.get("supportedBy") in ids]
        if not added:
            return found
        found.extend(added)
        ids.update(i["uid"] for i in added)


def layout_changed(before: Json, after: Json) -> bool:
    def openings(state):
        return sorted((
            o["wall"], o["kind"], o["offset"], o["width"],
            o.get("height", 2 if o["kind"] == "door" else 1.1),
            o.get("sillHeight", 0 if o["kind"] == "door" else 0.9),
        ) for o in state.get("openings", []))

    return before.get("room") != after.get("room") or openings(before) != openings(after)


def apply_action(state: Json, action: Json, request_id: str, at: str, source: str = "assistant") -> None:
    kind = action["kind"]
    if kind == "recordChatReceipt":
        receipt = deepcopy(action["receipt"])
        receipts = [r for r in state.get("chatReceipts", []) if r["id"] != receipt["id"]]
        state["chatReceipts"] = (receipts + [receipt])[-100:]
    elif kind in ("setZones", "setZoneResults"):
        key = "zones" if kind == "setZones" else "zoneResults"
        state[key] = deepcopy(action[key])
        if kind == "setZones":
            state.pop("zoneResults", None)
    elif kind == "syncScene":
        if layout_changed(state, action["scene"]):
            state.pop("zones", None)
            state.pop("zoneResults", None)
        state.update(deepcopy(action["scene"]))
    elif kind == "setRoom":
        if layout_changed(state, action):
            state.pop("zones", None)
            state.pop("zoneResults", None)
        state["room"], state["openings"] = deepcopy(action["room"]), deepcopy(action["openings"])
    elif kind == "placeNew":
        if any(i["uid"] == action["uid"] for i in state["items"]):
            raise ValueError("uid duplicado")
        state["items"].append(
            {k: action[k] for k in ("uid", "productId", "x", "z", "rotDeg")} | {"y": action.get("y", 0)}
        )
    else:
        item = next((i for i in state["items"] if i["uid"] == action["uid"]), None)
        if item is None:
            raise ValueError(f"uid desconocido: {action['uid']}")
        if kind == "move":
            for child in dependents(state, item["uid"]):
                for key in ("x", "y", "z"):
                    child[key] += action.get(key, item[key]) - item[key]
        if kind in ("remove", "replace"):
            for child in [i for i in state["items"] if i.get("supportedBy") == item["uid"]]:
                dy = child["y"]
                for lowered in [child, *dependents(state, child["uid"])]:
                    lowered["y"] -= dy
                child.pop("supportedBy", None)
            if kind == "replace":
                item.pop("supportedBy", None)
        fields = {"replace": ("productId", "x", "z", "rotDeg"), "move": ("x", "z"), "rotate": ("rotDeg",)}
        if kind == "remove":
            state["items"].remove(item)
        elif kind in fields:
            item.update({k: action[k] for k in fields[kind]})
            if kind in ("replace", "move") and "y" in action:
                item["y"] = action["y"]
        else:
            raise ValueError(f"Acción desconocida: {kind}")
    state["log"].append({"at": at, "source": source, "requestId": request_id, "action": deepcopy(action)})


class RoomEditor:
    """One staged turn. Only accepted mutations appear in actions and the replay log."""

    def __init__(self, state: Json, catalog: dict[str, Json], request_id: str, at: str):
        self.state, self.catalog, self.request_id, self.at = deepcopy(state), catalog, request_id, at
        self.actions: list[Json] = []
        self.active_zone: Json | None = None

    def apply(self, action: Json) -> Json:
        apply_action(self.state, action, self.request_id, self.at)
        self.actions.append(action)
        return action

    def set_zones(self, zones: list[Json]) -> Json:
        if self.active_zone:
            raise ValueError("El agente de zona no puede redistribuir la habitación")
        validate_zones(self.state["room"], zones)
        clean = [{k: z[k] for k in ("id", "name", "x", "z", "w", "d")} for z in zones]
        for item in self.state["items"]:
            if not any(zone_contains(z, footprint(item, self.catalog[item["productId"]])) for z in clean):
                raise ValueError("La distribución debe respetar los muebles existentes")
        return self.apply({"kind": "setZones", "zones": clean})

    def set_room(self, room: Json, openings: list[Json]) -> Json:
        if self.active_zone:
            raise ValueError("El agente de zona no puede cambiar la habitación ni sus aperturas")
        validate_room(room, openings)
        action = self.apply({"kind": "setRoom", "room": room, "openings": openings})
        for item in list(self.state["items"]):
            if not violations(self.state, self.catalog, item):
                continue
            fixed = repair(self.state, self.catalog, item)
            if fixed is None:
                self.apply({"kind": "remove", "uid": item["uid"]})
            else:
                if fixed["rotDeg"] != item["rotDeg"]:
                    self.apply({"kind": "rotate", "uid": item["uid"], "rotDeg": fixed["rotDeg"]})
                self.apply({"kind": "move", "uid": item["uid"], **{k: fixed[k] for k in ("x", "y", "z")}})
        return action

    def existing(self, uid: str) -> Json:
        item = next((i for i in self.state["items"] if i["uid"] == uid), None)
        if item is None:
            raise ValueError(f"uid desconocido: {uid}")
        if self.active_zone and any(
            not zone_contains(self.active_zone, footprint(i, self.catalog[i["productId"]]))
            for i in [item, *dependents(self.state, uid)]
        ):
            raise ValueError("El mueble pertenece a otra zona")
        return item

    def place(
        self,
        product_id: str,
        x: float,
        z: float,
        rotation: float,
        query: str,
        reason: str,
        uid: str | None = None,
        y: float = 0,
    ) -> Json:
        if uid:
            self.existing(uid)
        item = {
            "uid": uid or "it-" + uuid4().hex,
            "productId": product_id,
            "x": x,
            "y": y,
            "z": z,
            "rotDeg": rotation,
        }
        fixed = repair(self.state, self.catalog, item, zone=self.active_zone)
        if fixed is None:
            raise ValueError("sin hueco válido tras reparación (guardrails)")
        return self.apply(
            {
                "kind": "replace" if uid else "placeNew",
                "query": query,
                "reason": reason,
                **{k: fixed[k] for k in ("uid", "productId", "x", "y", "z", "rotDeg")},
            }
        )

    def move(self, uid: str, x: float, z: float, y: float | None = None) -> Json:
        old = self.existing(uid)
        item = dict(old, x=x, y=old["y"] if y is None else y, z=z)
        fixed = repair(self.state, self.catalog, item, rotate=False, zone=self.active_zone)
        if fixed is None:
            raise ValueError("sin hueco válido tras reparación (guardrails)")
        if self.active_zone:
            for child in dependents(self.state, uid):
                moved = {**child, **{k: child[k] + fixed[k] - old[k] for k in ("x", "y", "z")}}
                if not zone_contains(self.active_zone, footprint(moved, self.catalog[child["productId"]])):
                    raise ValueError("El movimiento sacaría un mueble apoyado de su zona")
        return self.apply({"kind": "move", "uid": uid, **{k: fixed[k] for k in ("x", "y", "z")}})

    def rotate(self, uid: str, rotation: float) -> Json:
        item = dict(self.existing(uid), rotDeg=finite(rotation, "rotDeg"))
        if violations(self.state, self.catalog, item, self.active_zone):
            raise ValueError("El giro viola los guardrails")
        return self.apply({"kind": "rotate", "uid": uid, "rotDeg": rotation})

    def remove(self, uid: str) -> Json:
        self.existing(uid)
        return self.apply({"kind": "remove", "uid": uid})

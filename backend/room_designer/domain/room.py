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


def opening_zone(o: Json, room: Json) -> tuple:
    clearance = o["width"] if o["kind"] == "door" else 0.75
    start, end = o["offset"], o["offset"] + o["width"]
    return {
        "N": (start, end, 0, clearance),
        "S": (start, end, room["d"] - clearance, room["d"]),
        "W": (0, clearance, start, end),
        "E": (room["w"] - clearance, room["w"], start, end),
    }[o["wall"]]


def violations(state: Json, catalog: dict[str, Json], item: Json) -> list[str]:
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
    if abs(item["y"]) > EPS:
        result.append("floating")
    box, room = footprint(item, product), state["room"]
    if box[0] < -EPS or box[2] < -EPS or box[1] > room["w"] + EPS or box[3] > room["d"] + EPS:
        result.append("outside")
    if product["height"] > room["h"] + EPS:
        result.append("above-ceiling")
    for o in state["openings"]:
        if overlaps(box, opening_zone(o, room)) and (o["kind"] == "door" or product["height"] > 0.9):
            result.append("blocks-" + o["kind"])
    for other in state["items"]:
        if other["uid"] != item["uid"] and other["productId"] in catalog:
            if overlaps(box, footprint(other, catalog[other["productId"]])):
                result.append("collision")
    return result


def repair(state: Json, catalog: dict[str, Json], item: Json, rotate: bool = True) -> Json | None:
    for key in ("x", "z", "rotDeg"):
        finite(item.get(key), key)
    for r in range(11):
        radius = r * 0.25
        points = max(8, int(2 * pi * radius / 0.25 + 0.5)) if r else 1
        for point in range(points):
            angle = 2 * pi * point / points
            for rotation in [item["rotDeg"], (item["rotDeg"] + 90) % 360] if rotate else [item["rotDeg"]]:
                candidate = dict(
                    item,
                    y=0,
                    x=item["x"] + radius * cos(angle),
                    z=item["z"] + radius * sin(angle),
                    rotDeg=rotation,
                )
                if not violations(state, catalog, candidate):
                    return candidate
    return None


def apply_action(state: Json, action: Json, request_id: str, at: str, source: str = "assistant") -> None:
    kind = action["kind"]
    if kind == "setRoom":
        state["room"], state["openings"] = deepcopy(action["room"]), deepcopy(action["openings"])
    elif kind == "placeNew":
        if any(i["uid"] == action["uid"] for i in state["items"]):
            raise ValueError("uid duplicado")
        state["items"].append({k: action[k] for k in ("uid", "productId", "x", "z", "rotDeg")} | {"y": 0})
    else:
        item = next((i for i in state["items"] if i["uid"] == action["uid"]), None)
        if item is None:
            raise ValueError(f"uid desconocido: {action['uid']}")
        fields = {"replace": ("productId", "x", "z", "rotDeg"), "move": ("x", "z"), "rotate": ("rotDeg",)}
        if kind == "remove":
            state["items"].remove(item)
        elif kind in fields:
            item.update({k: action[k] for k in fields[kind]})
        else:
            raise ValueError(f"Acción desconocida: {kind}")
    state["log"].append({"at": at, "source": source, "requestId": request_id, "action": deepcopy(action)})


class RoomEditor:
    """One staged turn. Only accepted mutations appear in actions and the replay log."""

    def __init__(self, state: Json, catalog: dict[str, Json], request_id: str, at: str):
        self.state, self.catalog, self.request_id, self.at = deepcopy(state), catalog, request_id, at
        self.actions: list[Json] = []

    def apply(self, action: Json) -> Json:
        apply_action(self.state, action, self.request_id, self.at)
        self.actions.append(action)
        return action

    def set_room(self, room: Json, openings: list[Json]) -> Json:
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
                self.apply({"kind": "move", "uid": item["uid"], "x": fixed["x"], "z": fixed["z"]})
        return action

    def existing(self, uid: str) -> Json:
        item = next((i for i in self.state["items"] if i["uid"] == uid), None)
        if item is None:
            raise ValueError(f"uid desconocido: {uid}")
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
    ) -> Json:
        if uid:
            self.existing(uid)
        item = {
            "uid": uid or "it-" + uuid4().hex,
            "productId": product_id,
            "x": x,
            "y": 0,
            "z": z,
            "rotDeg": rotation,
        }
        fixed = repair(self.state, self.catalog, item)
        if fixed is None:
            raise ValueError("sin hueco válido tras reparación (guardrails)")
        return self.apply(
            {
                "kind": "replace" if uid else "placeNew",
                "query": query,
                "reason": reason,
                **{k: fixed[k] for k in ("uid", "productId", "x", "z", "rotDeg")},
            }
        )

    def move(self, uid: str, x: float, z: float) -> Json:
        item = dict(self.existing(uid), x=x, z=z)
        fixed = repair(self.state, self.catalog, item, rotate=False)
        if fixed is None:
            raise ValueError("sin hueco válido tras reparación (guardrails)")
        return self.apply({"kind": "move", "uid": uid, "x": fixed["x"], "z": fixed["z"]})

    def rotate(self, uid: str, rotation: float) -> Json:
        item = dict(self.existing(uid), rotDeg=finite(rotation, "rotDeg"))
        if violations(self.state, self.catalog, item):
            raise ValueError("El giro viola los guardrails")
        return self.apply({"kind": "rotate", "uid": uid, "rotDeg": rotation})

    def remove(self, uid: str) -> Json:
        self.existing(uid)
        return self.apply({"kind": "remove", "uid": uid})

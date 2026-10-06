"""Normalización de planos detectados: de la salida del parser a un contorno editable.

El parser (VLM o determinista) devuelve esquinas y aperturas aproximadas; aquí
se convierten en una geometría que el editor puede aceptar: tramos casi
horizontales o verticales quedan exactos, el contorno se traslada al origen,
la escala estimada se reajusta a un tamaño razonable y las aperturas se acotan
a su pared o se descartan explicando el motivo. Dominio puro: sin red ni IO.
"""

import math

from room_designer.domain.room import Json, finite

MAX_SIZE = 30.0
MIN_SIZE = 1.0
MIN_AREA = 1.0
SNAP_DEGREES = 10.0
# Sin referencia de escala, el lado largo se lleva a un tamaño doméstico
# razonable; el usuario calibra después confirmando una longitud real.
ESTIMATED_LONG_SIDE = 10.0
OPENING_KINDS = ("door", "window")


def normalize_plan(parsed: Json) -> Json:
    corners = _corners(parsed)
    corners = _snap_axes(_snap_axes(corners))
    corners = _simplify(corners)
    estimated = bool(parsed.get("scaleEstimated"))
    corners, factor = _rescale(corners, estimated)
    _validate_size(corners)
    openings, dropped = _fit_openings(parsed.get("openings") or [], corners, factor)
    height = parsed.get("height")
    height = round(finite(height, "height"), 2) if isinstance(height, (int, float)) and 2 <= height <= 6 else 2.5
    return {
        "corners": [[round(x, 3), round(y, 3)] for x, y in corners],
        "height": height,
        "openings": openings,
        "scaleEstimated": estimated,
        "confidence": min(max(finite(parsed.get("confidence", 0), "confidence"), 0.0), 1.0),
        "notes": str(parsed.get("notes", ""))[:2000],
        "dropped": dropped,
    }


def _corners(parsed: Json) -> list[list[float]]:
    raw = parsed.get("corners")
    if not isinstance(raw, list) or not 3 <= len(raw) <= 40:
        raise ValueError("El contorno necesita entre 3 y 40 esquinas")
    return [[finite(p[0], "x"), finite(p[1], "y")] for p in raw]


def _edges(corners: list[list[float]]):
    return zip(corners, corners[1:] + corners[:1])


def _snap_axes(corners: list[list[float]]) -> list[list[float]]:
    snapped = [list(point) for point in corners]
    for i in range(len(snapped)):
        a, b = snapped[i], snapped[(i + 1) % len(snapped)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        angle = math.degrees(math.atan2(abs(dy), abs(dx)))
        if angle <= SNAP_DEGREES:
            b[1] = a[1]
        elif angle >= 90 - SNAP_DEGREES:
            b[0] = a[0]
    return snapped


def _simplify(corners: list[list[float]]) -> list[list[float]]:
    span = max(
        max(x for x, _ in corners) - min(x for x, _ in corners),
        max(y for _, y in corners) - min(y for _, y in corners),
    )
    merged: list[list[float]] = []
    for point in corners:
        if merged and math.dist(point, merged[-1]) <= span * 0.01:
            continue
        merged.append(point)
    if len(merged) > 1 and math.dist(merged[0], merged[-1]) <= span * 0.01:
        merged.pop()
    result = [
        b
        for a, b, c in zip(merged[-1:] + merged[:-1], merged, merged[1:] + merged[:1])
        if abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > span * span * 1e-4
    ]
    if len(result) < 3:
        raise ValueError("El contorno detectado no forma una habitación")
    return result


def _rescale(corners: list[list[float]], estimated: bool) -> tuple[list[list[float]], float]:
    min_x = min(x for x, _ in corners)
    min_y = min(y for _, y in corners)
    moved = [[x - min_x, y - min_y] for x, y in corners]
    long_side = max(max(x for x, _ in moved), max(y for _, y in moved))
    factor = 1.0
    if estimated and not MIN_SIZE <= long_side <= MAX_SIZE:
        factor = ESTIMATED_LONG_SIDE / long_side
        moved = [[x * factor, y * factor] for x, y in moved]
    return moved, factor


def _validate_size(corners: list[list[float]]) -> None:
    width = max(x for x, _ in corners)
    depth = max(y for _, y in corners)
    if width > MAX_SIZE or depth > MAX_SIZE:
        raise ValueError("La habitación no puede superar 30 m por lado")
    area = abs(
        sum(a[0] * b[1] - b[0] * a[1] for a, b in _edges(corners))
    ) / 2
    if width < MIN_SIZE or depth < MIN_SIZE or area < MIN_AREA:
        raise ValueError("El plano es demasiado pequeño para una habitación")


def _fit_openings(
    raw: list, corners: list[list[float]], factor: float
) -> tuple[list[Json], list[str]]:
    openings: list[Json] = []
    dropped: list[str] = []
    walls = list(_edges(corners))
    for entry in raw:
        if not isinstance(entry, dict):
            dropped.append("Apertura ilegible descartada")
            continue
        kind = entry.get("kind")
        wall = entry.get("wall")
        if kind not in OPENING_KINDS or not isinstance(wall, int) or not 0 <= wall < len(walls):
            dropped.append(f"Apertura en una pared inexistente ({wall}), descartada")
            continue
        a, b = walls[wall]
        length = math.dist(a, b)
        width = min(max(finite(entry.get("width", 0), "width") * factor, 0.4), 3.0)
        if width > length - 0.1:
            dropped.append(f"Apertura más ancha que su pared {wall}, descartada")
            continue
        offset = finite(entry.get("offset", 0), "offset") * factor
        offset = min(max(offset, 0.05), length - width - 0.05)
        openings.append({"wall": wall, "offset": round(offset, 3), "width": round(width, 3), "kind": kind})
    return openings, dropped

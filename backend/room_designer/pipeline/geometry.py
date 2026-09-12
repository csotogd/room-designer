import itertools
import json
import struct

import numpy as np


def parse_glb(data: bytes) -> dict:
    if len(data) < 20:
        raise ValueError("GLB truncado")
    magic, version, length, chunk_length, chunk_type = struct.unpack_from("<5I", data)
    if magic != 0x46546C67 or version != 2 or length != len(data) or chunk_type != 0x4E4F534A:
        raise ValueError("Cabecera GLB inválida")
    if 20 + chunk_length > len(data):
        raise ValueError("JSON del GLB truncado")
    return json.loads(data[20 : 20 + chunk_length])


def scene_size(gltf: dict):
    points = []

    def visit(index, parent, ancestors):
        if index in ancestors:
            raise ValueError("Ciclo en la escena glTF")
        node = gltf.get("nodes", [])[index]
        if "matrix" in node:
            matrix = np.array(node["matrix"]).reshape((4, 4), order="F")
        else:
            x, y, z, w = node.get("rotation", [0, 0, 0, 1])
            matrix = np.eye(4)
            matrix[:3, :3] = np.array(
                [
                    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
                ]
            ) @ np.diag(node.get("scale", [1, 1, 1]))
            matrix[:3, 3] = node.get("translation", [0, 0, 0])
        world = parent @ matrix
        if "mesh" in node:
            for primitive in gltf["meshes"][node["mesh"]].get("primitives", []):
                accessor_index = primitive.get("attributes", {}).get("POSITION")
                if accessor_index is None:
                    continue
                accessor = gltf["accessors"][accessor_index]
                if "min" in accessor and "max" in accessor:
                    for corner in itertools.product(*zip(accessor["min"], accessor["max"])):
                        points.append((world @ np.array([*corner, 1]))[:3])
        for child in node.get("children", []):
            visit(child, world, ancestors | {index})

    scenes = gltf.get("scenes", [])
    if not scenes:
        return None
    for root in scenes[gltf.get("scene", 0)].get("nodes", []):
        visit(root, np.eye(4), set())
    if not points or not np.isfinite(points).all():
        return None
    return np.max(points, axis=0) - np.min(points, axis=0)


def furniture_dimensions(size):
    if size is None or not np.isfinite(size).all() or max(size) <= 0:
        return None
    for factor in (1, 0.01, 0.001, 0.0254, 0.1):
        if 0.05 <= max(size) * factor <= 6:
            return {
                "widthCm": round(size[0] * factor * 100, 1),
                "heightCm": round(size[1] * factor * 100, 1),
                "depthCm": round(size[2] * factor * 100, 1),
            }
    return None

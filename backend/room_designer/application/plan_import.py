"""Caso de uso: importar la imagen de un plano 2D y devolver un borrador editable.

El parser es un puerto (VLM real o determinista); el dominio garantiza que lo
que sale de aquí es un contorno válido con sus aperturas acotadas. El borrador
viaja al asistente de creación del editor, donde el usuario corrige y confirma.
"""

from room_designer.application.ports import PlanParser
from room_designer.domain.plan import normalize_plan
from room_designer.domain.room import Json


async def import_plan(parser: PlanParser, image: bytes) -> Json:
    return normalize_plan(await parser.parse(image))

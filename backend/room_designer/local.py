"""Arranque local de Gemini con la clave de dev obtenida de Secret Manager."""

import os

import uvicorn

from room_designer.adapters.http import MAX_WS_BYTES
from room_designer.adapters.secret_manager import read_secret
from room_designer.bootstrap import designer_app, setup

DEV_SECRET = "projects/room-designer-508414/secrets/room-designer-dev-gemini-api-key/versions/1"
ROLES = ("DESIGNER", "DESIGNER_PICKER", "DESIGNER_JUDGE")


def local_configuration(env: dict[str, str]) -> dict[str, str]:
    config = dict(env)
    secret = read_secret(config.get("DESIGNER_GEMINI_SECRET", DEV_SECRET))
    config["GOOGLE_API_KEY"] = secret
    config.setdefault("CATALOG_SITE", "polyhaven")
    config.setdefault("DESIGNER_TURN_TIMEOUT", "600")
    config["DESIGNER_LOCAL_FRESH_SESSIONS"] = "1"
    model = config.get("DESIGNER_MODEL", "gemini-3.5-flash")
    for role in ROLES:
        config[f"{role}_PROVIDER"] = "gemini"
        config.pop(f"{role}_API_KEY", None)
        config.setdefault(f"{role}_MODEL", model)
        config.pop(f"{role}_BASE_URL", None)
    config.pop("GEMINI_BASE_URL", None)
    return config


def main() -> None:
    setup()
    try:
        config = local_configuration(dict(os.environ))
    except (RuntimeError, ValueError) as error:
        raise SystemExit(str(error)) from None
    uvicorn.run(
        designer_app(config), host="127.0.0.1",
        port=int(config.get("DESIGNER_PORT", "8790")),
        ws_max_size=MAX_WS_BYTES, workers=1,
    )


if __name__ == "__main__":
    main()

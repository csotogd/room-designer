"""Acceso autenticado a Secret Manager sin persistir ni registrar el payload."""

import base64
import re

import google.auth
from google.auth.exceptions import DefaultCredentialsError, GoogleAuthError
from google.auth.transport.requests import AuthorizedSession
from requests import RequestException


def read_secret(resource: str) -> str:
    if not re.fullmatch(r"projects/[a-zA-Z0-9_-]+/secrets/[a-zA-Z0-9_-]+/versions/(?:[1-9][0-9]*|latest)", resource):
        raise ValueError("Indica una versión válida de Secret Manager: projects/PROYECTO/secrets/SECRETO/versions/1")
    try:
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        with AuthorizedSession(credentials) as session:
            response = session.get(f"https://secretmanager.googleapis.com/v1/{resource}:access", timeout=15)
            response.raise_for_status()
            secret = base64.b64decode(response.json()["payload"]["data"], validate=True).decode("utf-8").strip()
        if not secret:
            raise ValueError("Secreto vacío")
        return secret
    except DefaultCredentialsError:
        raise RuntimeError(
            "Inicia sesión con Google: gcloud auth application-default login. "
            "Después vuelve a ejecutar npm run designer:local."
        ) from None
    except (GoogleAuthError, RequestException, ValueError, KeyError, TypeError):
        # Los errores remotos pueden incluir el payload o detalles de autenticación.
        raise RuntimeError(
            "No se pudo leer la clave de Secret Manager. Comprueba tu sesión de Google, "
            "el permiso de acceso al secreto y que su versión esté habilitada."
        ) from None

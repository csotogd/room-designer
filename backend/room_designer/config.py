"""Validated configuration, loaded explicitly at the composition root."""

from dataclasses import dataclass, field
from typing import Mapping


@dataclass(frozen=True)
class ModelConfig:
    provider: str
    model: str
    api_key: str = field(default="", repr=False)
    base_url: str | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str], role: str = "DESIGNER") -> "ModelConfig":
        provider = env.get(f"{role}_PROVIDER", env.get("DESIGNER_PROVIDER", "auto")).lower()
        keys = {
            "gemini": env.get("GOOGLE_API_KEY") or env.get("GEMINI_API_KEY", ""),
            "anthropic": env.get("ANTHROPIC_API_KEY", ""),
            "openai": env.get("OPENAI_API_KEY", ""),
        }
        if provider == "auto":
            provider = next((p for p in ("gemini", "anthropic", "openai") if keys[p]), "fake")
        if provider not in (*keys, "fake"):
            raise ValueError(f"Proveedor desconocido: {provider}")
        defaults = {
            "gemini": "gemini-2.5-flash",
            "anthropic": "claude-sonnet-4-6",
            "openai": "gpt-4.1",
            "fake": "offline",
        }
        key = env.get(f"{role}_API_KEY") or keys.get(provider, "")
        if provider != "fake" and not key:
            raise ValueError(f"{role}_PROVIDER={provider} requiere su API key")
        # A role using another provider must not inherit an incompatible model name.
        parent_provider = env.get("DESIGNER_PROVIDER", "auto").lower()
        if parent_provider == "auto":
            parent_provider = next((p for p in ("gemini", "anthropic", "openai") if keys[p]), "fake")
        model = env.get(f"{role}_MODEL") or (
            env.get("DESIGNER_MODEL") if role != "DESIGNER" and provider == parent_provider else None
        )
        model = model or defaults[provider]
        if "/" in model:
            prefix, model = model.split("/", 1)
            if prefix != provider:
                raise ValueError("El prefijo del modelo no coincide con el proveedor")
        return cls(
            provider, model, key, env.get(f"{role}_BASE_URL") or env.get(f"{provider.upper()}_BASE_URL")
        )

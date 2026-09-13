import ast
from pathlib import Path

import pytest

PACKAGE = Path(__file__).parents[1] / "room_designer"


@pytest.mark.parametrize("layer", ["domain", "application"])
def test_dependency_direction(layer):
    forbidden = (
        "google",
        "litellm",
        "httpx",
        "fastapi",
        "uvicorn",
        "room_designer.adapters",
        "room_designer.bootstrap",
        "room_designer.config",
        "room_designer.pipeline",
    )
    for path in (PACKAGE / layer).rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            modules = (
                [node.module or ""]
                if isinstance(node, ast.ImportFrom)
                else [alias.name for alias in node.names]
                if isinstance(node, ast.Import)
                else []
            )
            for module in modules:
                assert not module.startswith(forbidden), f"{path}: forbidden dependency {module}"
                if layer == "domain":
                    assert not module.startswith("room_designer.application")


def test_no_node_backends_left():
    root = PACKAGE.parents[1]
    assert not list((root / "services").rglob("*.ts"))
    assert not list((root / "pipeline").rglob("*.ts"))

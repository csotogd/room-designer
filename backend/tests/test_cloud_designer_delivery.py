import json
from pathlib import Path

import pytest
from conftest import scenario

ROOT = Path(__file__).resolve().parents[2]


@scenario("Cloud chat uses private same-origin endpoints and real credentials")
def test_cloud_chat_has_same_origin_routes_and_external_catalog():
    nginx = (ROOT / "services/frontend/default.conf").read_text()
    assert "location = /ws" in nginx
    assert "proxy_pass http://127.0.0.1:8790" in nginx
    assert 'proxy_set_header Upgrade $http_upgrade' in nginx
    assert "location = /search" in nginx
    assert "location = /designer-healthz" in nginx
    assert "proxy_pass http://127.0.0.1:8787" in nginx
    assert "alias /cloud/catalog/" in nginx
    for service in ("designer", "search"):
        docker = (ROOT / f"services/{service}/Dockerfile").read_text()
        assert "COPY public/catalog" not in docker
        assert "USER app" in docker
    frontend = (ROOT / "services/frontend/Dockerfile").read_text()
    assert "VITE_DESIGNER_URL=/ws" in frontend
    assert 'VITE_SEARCH_URL=""' in frontend


def test_cloud_health_check_rejects_offline_or_empty_backend(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "ops"))
    from delivery import check_chat

    pages = {
        "/designer-healthz": {"ok": True, "brain": "gemini/gemini-3.5-flash", "catalog": 2},
        "/search?q=chair&limit=1": {"results": [{"id": "chair", "score": 1}]},
        "/catalog/index-polyhaven.json": [{"id": "chair"}, {"id": "desk"}],
    }
    def fetch(path):
        return json.dumps(pages[path]).encode()

    check_chat(fetch)
    pages["/designer-healthz"]["brain"] = "fake/offline"
    with pytest.raises(ValueError, match="Gemini"):
        check_chat(fetch)
    pages["/designer-healthz"]["brain"] = "gemini/gemini-3.5-flash"
    pages["/catalog/index-polyhaven.json"] = []
    with pytest.raises(ValueError, match="catálogo"):
        check_chat(fetch)

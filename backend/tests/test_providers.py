import json

import httpx
import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import Field
from room_designer.adapters.adk_runtime import AdkRuntime, create_model, run_agent
from room_designer.adapters.vision import AdkJudge, AdkPicker, ImageLoader
from room_designer.config import ModelConfig
from room_designer.domain.room import empty_state


@pytest.mark.parametrize(
    "provider,key,prefix",
    [
        ("openai", "OPENAI_API_KEY", "openai/"),
        ("anthropic", "ANTHROPIC_API_KEY", "anthropic/"),
        ("gemini", "GOOGLE_API_KEY", ""),
    ],
)
def test_model_factory(provider, key, prefix):
    config = ModelConfig.from_env({"DESIGNER_PROVIDER": provider, key: "dummy-test-key"})
    model = create_model(config)
    assert model.model == prefix + config.model
    assert "dummy-test-key" not in repr(config)
    if provider == "gemini":
        assert model.client.vertexai is False
        model.client.close()


@pytest.mark.parametrize(
    "env",
    [
        {"DESIGNER_PROVIDER": "unknown"},
        {"DESIGNER_PROVIDER": "openai"},
        {"DESIGNER_PROVIDER": "gemini"},
        {"DESIGNER_PROVIDER": "anthropic"},
        {"DESIGNER_PROVIDER": "openai", "OPENAI_API_KEY": "x", "DESIGNER_MODEL": "anthropic/claude"},
    ],
)
def test_configuration_fails_early(env):
    with pytest.raises(ValueError):
        ModelConfig.from_env(env)


def test_auto_alias_and_role_overrides():
    assert ModelConfig.from_env({}).provider == "fake"
    assert ModelConfig.from_env({"GEMINI_API_KEY": "g"}).provider == "gemini"
    assert ModelConfig.from_env({"OPENAI_API_KEY": "o"}).provider == "openai"
    config = ModelConfig.from_env(
        {
            "DESIGNER_PROVIDER": "openai",
            "OPENAI_API_KEY": "o",
            "DESIGNER_PICKER_PROVIDER": "anthropic",
            "ANTHROPIC_API_KEY": "a",
            "DESIGNER_PICKER_MODEL": "claude-test",
        },
        "DESIGNER_PICKER",
    )
    assert config.provider == "anthropic" and config.model == "claude-test" and config.api_key == "a"
    config = ModelConfig.from_env(
        {
            "DESIGNER_PROVIDER": "openai",
            "DESIGNER_MODEL": "gpt-4.1",
            "OPENAI_API_KEY": "o",
            "DESIGNER_PICKER_PROVIDER": "gemini",
            "GOOGLE_API_KEY": "g",
        },
        "DESIGNER_PICKER",
    )
    assert config.model == "gemini-2.5-flash"


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
async def test_litellm_adapter_tool_call_roundtrip(provider, design_tools, monkeypatch):
    """Real ADK and LiteLlm conversion; only the remote completion is substituted."""
    from google.adk.models.lite_llm import LiteLLMClient
    from litellm import ModelResponse

    requests = []

    async def completion(self, **kwargs):
        requests.append(kwargs)
        if len(requests) == 1:
            return ModelResponse(
                choices=[
                    {
                        "index": 0,
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call-1",
                                    "type": "function",
                                    "function": {
                                        "name": "place_furniture",
                                        "arguments": json.dumps({"search_query": "chair", "x": 2, "y": 0.6, "z": 2}),
                                    },
                                }
                            ],
                        },
                    }
                ]
            )
        assert any(m.get("role") == "tool" and m.get("tool_call_id") == "call-1" for m in kwargs["messages"])
        return ModelResponse(
            choices=[
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": "He colocado una silla."},
                }
            ]
        )

    monkeypatch.setattr(LiteLLMClient, "acompletion", completion)
    config = ModelConfig(provider, "gpt-4.1" if provider == "openai" else "claude-sonnet-4-6", "dummy")
    result = await AdkRuntime(create_model(config)).run(
        "silla", design_tools.editor.state, design_tools.functions()
    )
    assert result == "He colocado una silla."
    assert design_tools.editor.state["items"][0]["productId"] == "chair"
    assert design_tools.editor.state["items"][0]["y"] == 0.6
    assert requests[0]["model"].startswith(provider + "/")
    assert requests[0]["api_key"] == "dummy"
    assert {t["function"]["name"] for t in requests[0]["tools"]} >= {
        "set_room",
        "place_furniture",
        "search_catalog",
    }
    for name in ("place_furniture", "move_furniture"):
        function = next(t["function"] for t in requests[0]["tools"] if t["function"]["name"] == name)
        assert "y" in function["parameters"]["properties"]


async def test_gemini_adapter_tool_call_roundtrip(design_tools, monkeypatch):
    from google.genai.models import AsyncModels

    requests = []

    async def generate(self, **kwargs):
        requests.append(kwargs)
        content = (
            types.Content(
                role="model",
                parts=[
                    types.Part(
                        function_call=types.FunctionCall(
                            name="place_furniture",
                            args={"search_query": "chair", "x": 2, "y": 0.6, "z": 2},
                            id="call-1",
                        )
                    )
                ],
            )
            if len(requests) == 1
            else types.Content(role="model", parts=[types.Part(text="He colocado una silla.")])
        )
        return types.GenerateContentResponse(
            candidates=[types.Candidate(content=content, finish_reason="STOP")]
        )

    monkeypatch.setattr(AsyncModels, "generate_content", generate)
    result = await AdkRuntime(create_model(ModelConfig("gemini", "gemini-2.5-flash", "dummy"))).run(
        "silla", design_tools.editor.state, design_tools.functions()
    )
    assert result == "He colocado una silla."
    assert design_tools.editor.state["items"][0]["productId"] == "chair"
    assert design_tools.editor.state["items"][0]["y"] == 0.6
    assert any(p.function_response for c in requests[-1]["contents"] for p in c.parts or [])


class RecordingModel(BaseLlm):
    model: str = "recording"
    response: str = ""
    requests: list = Field(default_factory=list)

    async def generate_content_async(self, request, stream=False):
        self.requests.append(request)
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=self.response)]))


async def test_visual_picker_receives_photos_and_judge_receives_png(tmp_path, png, catalog):
    (tmp_path / "catalog").mkdir()
    (tmp_path / "catalog/photo.png").write_bytes(png)
    async with httpx.AsyncClient() as client:
        model = RecordingModel(response='{"productId":"desk","reason":"encaja visualmente"}')
        picker = AdkPicker(model, ImageLoader(client, tmp_path))
        assert (await picker.pick("office", "desk", [catalog["desk"]]))["productId"] == "desk"
        assert any(p.inline_data for p in model.requests[0].contents[0].parts)
    model = RecordingModel(
        response=json.dumps(
            {"cohesion": 8, "colors": 8, "style": 7, "adherence": 9, "rotation": 8, "completeness": 8, "overall": 8, "notes": "bien"}
        )
    )
    assert (await AdkJudge(model).judge("office", png))["overall"] == 8
    assert model.requests[0].contents[0].parts[1].inline_data.data == png


async def test_invalid_judge_score_rejected(png):
    model = RecordingModel(
        response=json.dumps(
            {"cohesion": 80, "colors": 8, "style": 7, "adherence": 9, "rotation": 8, "completeness": 8, "overall": 8, "notes": "bad"}
        )
    )
    with pytest.raises(ValueError):
        await AdkJudge(model).judge("office", png)


async def test_missing_final_response_is_failure():
    with pytest.raises(ValueError, match="respuesta final"):
        await run_agent(RecordingModel(response=""), "test", [types.Part(text="test")], [])


async def test_image_path_cannot_escape_public_directory(tmp_path):
    async with httpx.AsyncClient() as client:
        with pytest.raises(ValueError):
            await ImageLoader(client, tmp_path).part("/../secret.png")


async def test_runtime_carries_conversation_without_action_log():
    model = RecordingModel(response="respuesta")
    state = empty_state() | {"conversation": [{"role": "user", "text": "prefiero azul"}]}
    await AdkRuntime(model).run("añade silla", state, [])
    payload = json.loads(model.requests[0].contents[0].parts[0].text)
    assert payload["state"]["conversation"] == state["conversation"]
    assert "log" not in payload["state"]

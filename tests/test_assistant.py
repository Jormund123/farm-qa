"""Part B assistant tests.

The Gemini provider is stubbed, so these assert the deterministic parts: tool
wiring, grounding, the loop budget, the JSON contract, and the failure paths.
Nothing here touches the network.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api import assistant
from api.main import app

client = TestClient(app)


def _upload(sample_bytes: bytes) -> str:
    r = client.post(
        "/api/files",
        files={"files": ("Farm_file.geojson", sample_bytes, "application/geo+json")},
    )
    return r.json()["fileId"]


def _ask(file_id: str, text: str):
    return client.post(
        f"/api/files/{file_id}/assistant",
        json={"messages": [{"role": "user", "content": text}]},
    )


class ScriptedProvider:
    """Returns pre-scripted model turns; records what it was sent."""

    def __init__(self, turns: list[dict]) -> None:
        self.turns = list(turns)
        self.requests: list[dict] = []

    def __call__(self, payload: dict) -> dict:
        self.requests.append(payload)
        part = self.turns.pop(0)
        return {"candidates": [{"content": {"parts": [part]}}]}


@pytest.mark.integration
class TestAssistant:
    def test_answers_are_grounded_in_tool_results(self, sample_bytes, monkeypatch) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        provider = ScriptedProvider([
            {"functionCall": {"name": "get_qa_report", "args": {}}},
            {"text": '{"answer": "The file has 5 plots; 1 has invalid geometry."}'},
        ])
        monkeypatch.setattr(assistant, "_call_gemini", provider)

        file_id = _upload(sample_bytes)
        r = _ask(file_id, "How many plots are there?")

        assert r.status_code == 200
        body = r.json()
        assert body["toolCalls"] == ["get_qa_report"]
        # The JSON envelope is parsed server-side; the user sees only the answer.
        assert body["reply"] == "The file has 5 plots; 1 has invalid geometry."
        # The tool result actually reached the model on the second turn.
        second = provider.requests[1]
        sent = str(second)
        assert "functionResponse" in sent and "total_area_ha" in sent

    def test_mutating_tool_executes_real_repair(self, sample_bytes, monkeypatch) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        provider = ScriptedProvider([
            {"functionCall": {"name": "fix_geometries", "args": {}}},
            {"text": '{"answer": "Repaired 1 geometry."}'},
        ])
        monkeypatch.setattr(assistant, "_call_gemini", provider)

        file_id = _upload(sample_bytes)
        assert _ask(file_id, "Fix the broken plot").status_code == 200
        # The repair really happened — QA now reports zero invalid geometries.
        assert client.get(f"/api/files/{file_id}/qa").json()["invalid"] == []

    def test_loop_budget_is_bounded(self, sample_bytes, monkeypatch) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        endless = ScriptedProvider(
            [{"functionCall": {"name": "get_qa_report", "args": {}}}] * 10
        )
        monkeypatch.setattr(assistant, "_call_gemini", endless)

        file_id = _upload(sample_bytes)
        r = _ask(file_id, "loop forever")
        assert r.status_code == 200
        assert len(r.json()["toolCalls"]) == assistant.MAX_TOOL_CALLS

    def test_unknown_tool_is_reported_back_not_crashed(self, sample_bytes, monkeypatch) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        provider = ScriptedProvider([
            {"functionCall": {"name": "drop_database", "args": {}}},
            {"text": '{"answer": "That tool does not exist."}'},
        ])
        monkeypatch.setattr(assistant, "_call_gemini", provider)

        file_id = _upload(sample_bytes)
        assert _ask(file_id, "do something weird").status_code == 200

    def test_tool_results_speak_plot_fids_not_indices(self, sample_bytes, monkeypatch) -> None:
        """'index 4' means nothing to a user — that row is plot 5. The model
        must only ever see plot numbers, so it cannot leak internal indices."""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        provider = ScriptedProvider([
            {"functionCall": {"name": "get_qa_report", "args": {}}},
            {"text": '{"answer": "Plot 5 has a broken boundary."}'},
        ])
        monkeypatch.setattr(assistant, "_call_gemini", provider)

        file_id = _upload(sample_bytes)
        assert _ask(file_id, "which plot is broken?").status_code == 200

        sent = str(provider.requests[1])
        assert "'plot': 5" in sent      # the invalid entry names the plot
        assert "'index'" not in sent    # raw dataframe indices are stripped

    def test_malformed_reply_gets_one_repair_turn(self, sample_bytes, monkeypatch) -> None:
        """Prose instead of JSON → server sends a repair prompt, model recovers."""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        provider = ScriptedProvider([
            {"text": "There are 5 plots."},  # violates the JSON contract
            {"text": '{"answer": "There are 5 plots."}'},
        ])
        monkeypatch.setattr(assistant, "_call_gemini", provider)

        file_id = _upload(sample_bytes)
        r = _ask(file_id, "How many plots?")

        assert r.status_code == 200
        assert r.json()["reply"] == "There are 5 plots."
        # The second request carried the repair instruction.
        assert assistant.REPAIR_PROMPT in str(provider.requests[1])

    def test_persistently_malformed_reply_is_a_typed_502(self, sample_bytes, monkeypatch) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        provider = ScriptedProvider([{"text": "not json"}, {"text": "still not json"}])
        monkeypatch.setattr(assistant, "_call_gemini", provider)

        file_id = _upload(sample_bytes)
        r = _ask(file_id, "hello")
        assert r.status_code == 502
        assert r.json()["error"] == "AssistantBadReply"

    def test_fenced_json_is_accepted(self, sample_bytes, monkeypatch) -> None:
        """Models love ```json fences — the parser must tolerate them."""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        provider = ScriptedProvider([
            {"text": '```json\n{"answer": "All plots are valid."}\n```'},
        ])
        monkeypatch.setattr(assistant, "_call_gemini", provider)

        file_id = _upload(sample_bytes)
        r = _ask(file_id, "status?")
        assert r.status_code == 200
        assert r.json()["reply"] == "All plots are valid."

    def test_provider_rate_limit_is_a_typed_503_not_a_500(self, sample_bytes, monkeypatch) -> None:
        """Free-tier Gemini 429s under quick successive questions — the user
        must get a friendly retry message, never an Internal Server Error."""
        import httpx

        monkeypatch.setenv("GEMINI_API_KEY", "test-key")

        def rate_limited(payload: dict) -> dict:
            response = httpx.Response(429, request=httpx.Request("POST", "https://x"))
            raise httpx.HTTPStatusError("429", request=response.request, response=response)

        monkeypatch.setattr(assistant, "_call_gemini", rate_limited)

        file_id = _upload(sample_bytes)
        r = _ask(file_id, "hello")
        assert r.status_code == 503
        assert r.json()["error"] == "AssistantRateLimited"

    def test_provider_network_failure_is_a_typed_502(self, sample_bytes, monkeypatch) -> None:
        import httpx

        monkeypatch.setenv("GEMINI_API_KEY", "test-key")

        def unreachable(payload: dict) -> dict:
            raise httpx.ConnectError("boom")

        monkeypatch.setattr(assistant, "_call_gemini", unreachable)

        file_id = _upload(sample_bytes)
        r = _ask(file_id, "hello")
        assert r.status_code == 502
        assert r.json()["error"] == "AssistantUnreachable"

    def test_unconfigured_returns_typed_503(self, sample_bytes, monkeypatch) -> None:
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        file_id = _upload(sample_bytes)
        r = _ask(file_id, "hello")
        assert r.status_code == 503
        assert r.json()["error"] == "AssistantNotConfigured"

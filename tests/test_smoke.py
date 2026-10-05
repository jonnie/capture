"""Offline smoke test: exercises the REST API and web UI through the ASGI app.

Runs without network or an LLM: it points the app at a throwaway SQLite file
with LLM auto-tagging disabled, so a capture added without tags is given the
first configured tag (``inbox``).
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from capture.app import create_app

_SETTINGS = """\
server:
  host: 127.0.0.1
  port: 8000
database:
  path: smoke.db
llm:
  enabled: no
  url: http://localhost:8080/v1
  model: test-model
tags:
  - inbox
  - todo
  - idea
  - urgent
"""


class SmokeTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        settings_path = Path(self._tmp.name) / "settings.yaml"
        settings_path.write_text(_SETTINGS)
        # Fresh app + database per test (setUp runs before every method).
        self.app = create_app(settings_path)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_tags_and_ui(self) -> None:
        with TestClient(self.app) as client:
            r = client.get("/api/tags")
            self.assertEqual(r.status_code, 200)
            for expected in ("inbox", "todo", "idea", "urgent"):
                self.assertIn(expected, r.json()["tags"])
            # The web UI is served from the installed package (packaging check).
            r = client.get("/")
            self.assertEqual(r.status_code, 200)
            self.assertIn("Capture", r.text)

    def test_capture_crud(self) -> None:
        with TestClient(self.app) as client:
            r = client.post("/api/captures", json={"content": "Remember to buy milk"})
            self.assertEqual(r.status_code, 201)
            capture = r.json()
            cid = capture["id"]
            self.assertEqual(capture["content"], "Remember to buy milk")
            self.assertEqual(capture["tags"], ["inbox"])  # LLM disabled -> inbox
            self.assertFalse(capture["archived"])

            r = client.get(f"/api/captures/{cid}")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["id"], cid)

            r = client.get("/api/captures")
            self.assertEqual(r.status_code, 200)
            self.assertIn(cid, [c["id"] for c in r.json()["captures"]])

            r = client.patch(
                f"/api/captures/{cid}", json={"content": "Buy oat milk", "tags": ["todo"]}
            )
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["content"], "Buy oat milk")
            self.assertEqual(r.json()["tags"], ["todo"])

            r = client.patch(f"/api/captures/{cid}", json={"archived": True})
            self.assertEqual(r.status_code, 200)
            self.assertTrue(r.json()["archived"])
            r = client.get("/api/captures?archived=false")
            self.assertNotIn(cid, [c["id"] for c in r.json()["captures"]])

            r = client.delete(f"/api/captures/{cid}")
            self.assertEqual(r.status_code, 204)
            self.assertEqual(client.get(f"/api/captures/{cid}").status_code, 404)

    def test_rejects_unknown_tag(self) -> None:
        with TestClient(self.app) as client:
            r = client.post("/api/captures", json={"content": "x", "tags": ["not-a-tag"]})
            self.assertEqual(r.status_code, 400)

    def test_mcp_mounted(self) -> None:
        with TestClient(self.app) as client:
            # GET is not the JSON-RPC method, but /mcp must be mounted (no 404).
            self.assertNotEqual(client.get("/mcp").status_code, 404)


if __name__ == "__main__":
    unittest.main()

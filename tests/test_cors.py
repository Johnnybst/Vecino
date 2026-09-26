"""Exercise browser preflight and response headers without external requests."""
import importlib
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import api.main as main


class CorsTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "ALLOWED_ORIGINS": " http://localhost:5173, https://vecino-test.vercel.app/ , ,",
            "DEMO_MODE": "true",
        })
        self.env.start()
        self.client = TestClient(importlib.reload(main).app)

    def tearDown(self):
        self.client.close()
        self.env.stop()
        importlib.reload(main)

    def test_local_and_deployed_frontends(self):
        for origin in ("http://localhost:5173", "https://vecino-test.vercel.app"):
            with self.subTest(origin=origin):
                response = self.client.get("/hazards", headers={"Origin": origin})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["access-control-allow-origin"], origin)
                response = self.client.options("/route", headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["access-control-allow-origin"], origin)

    def test_other_website_does_not_receive_cors_permission(self):
        headers = {"Origin": "https://unlisted.example"}
        response = self.client.get("/hazards", headers=headers)
        self.assertNotIn("access-control-allow-origin", response.headers)
        response = self.client.options("/route", headers={
            **headers, "Access-Control-Request-Method": "POST",
        })
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access-control-allow-origin", response.headers)

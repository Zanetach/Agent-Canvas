from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PLUGIN_DIR = Path(__file__).parent


def load_plugin():
    name = "beemax_canvas_plugin_test"
    spec = importlib.util.spec_from_file_location(
        name,
        PLUGIN_DIR / "__init__.py",
        submodule_search_locations=[str(PLUGIN_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeCanvasHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/beemax/health":
            return self._json({"status": "ok", "service": "beemax-bridge"})
        if self.path == "/api/beemax/capabilities":
            return self._json({"success": True, "image": {"generate": {"async": True}}})
        if self.path == "/api/task/task-1":
            return self._json(
                {
                    "success": True,
                    "data": {
                        "task_id": "task-1",
                        "status": "completed",
                        "canonical_status": "success",
                        "server_urls": ["/beemax-assets/generated.png"],
                    },
                }
            )
        return self._json({"success": False, "error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        if self.path == "/api/image":
            payload = json.loads(body)
            self.server.last_image_payload = payload
            return self._json({"success": True, "task_id": "task-1"})
        if self.path == "/api/assets/localize":
            payload = json.loads(body)
            self.server.last_localize_payload = payload
            return self._json(
                {
                    "success": True,
                    "assets": [{"url": "/uploads/images/imported.png"}],
                }
            )
        if self.path == "/api/uploads/images":
            self.server.last_upload_content_type = self.headers.get("content-type")
            self.server.last_upload_body = body
            return self._json(
                {
                    "success": True,
                    "asset": {"url": "/uploads/images/local.png"},
                }
            )
        if self.path == "/api/task/task-1/cancel":
            return self._json({"ok": True, "task": {"status": "cancelled"}})
        if self.path == "/api/task/task-1/retry":
            return self._json({"success": True, "task_id": "task-2", "retry_of": "task-1"})
        return self._json({"success": False, "error": "not found"}, 404)


class FakeContext:
    def __init__(self):
        self.tools = {}

    def register_tool(self, **kwargs):
        self.tools[kwargs["name"]] = kwargs


class BeeMaxCanvasPluginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plugin = load_plugin()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeCanvasHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self):
        self.previous_url = self.plugin.os.environ.get("BEEMAX_CANVAS_URL")
        self.plugin.os.environ["BEEMAX_CANVAS_URL"] = self.base_url

    def tearDown(self):
        if self.previous_url is None:
            self.plugin.os.environ.pop("BEEMAX_CANVAS_URL", None)
        else:
            self.plugin.os.environ["BEEMAX_CANVAS_URL"] = self.previous_url

    def call(self, handler, args):
        return json.loads(handler(args))

    def test_registers_canvas_tool_contract(self):
        ctx = FakeContext()
        self.plugin.register(ctx)
        self.assertEqual(
            set(ctx.tools),
            {
                "beemax_canvas_status",
                "beemax_generate_image",
                "beemax_generate_and_import",
                "beemax_generate_from_references",
                "beemax_edit_image",
                "beemax_mask_edit",
                "beemax_outpaint_image",
                "beemax_create_variation",
                "beemax_import_image",
                "beemax_task_status",
                "beemax_cancel_task",
                "beemax_retry_task",
                "beemax_open_canvas",
            },
        )

    def test_status_reports_bridge_and_capabilities(self):
        result = self.call(self.plugin.handle_status, {})
        self.assertTrue(result["success"])
        self.assertEqual(result["health"]["service"], "beemax-bridge")
        self.assertTrue(result["capabilities"]["image"]["generate"]["async"])

    def test_bridge_generation_waits_for_completed_task(self):
        result = self.call(
            self.plugin.handle_generate_image,
            {"prompt": "a blue technology bee", "aspect_ratio": "16:9", "wait": True},
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["task"]["canonical_status"], "success")
        self.assertEqual(result["image_urls"], ["/beemax-assets/generated.png"])
        self.assertEqual(self.server.last_image_payload["size"], "16:9")

    def test_advanced_image_tools_submit_canonical_operations(self):
        cases = [
            (self.plugin.handle_generate_from_references, "generate", {}),
            (self.plugin.handle_edit_image, "edit", {}),
            (
                self.plugin.handle_mask_edit,
                "mask",
                {"mask_image": "https://example.com/mask.png"},
            ),
            (self.plugin.handle_outpaint_image, "outpaint", {}),
            (self.plugin.handle_create_variation, "variation", {}),
        ]
        for handler, operation, extra in cases:
            with self.subTest(operation=operation, handler=handler.__name__):
                result = self.call(
                    handler,
                    {
                        "prompt": "preserve the bee and use technology blue",
                        "input_images": ["https://example.com/source.png"],
                        "wait": True,
                        **extra,
                    },
                )
                self.assertTrue(result["success"])
                self.assertEqual(self.server.last_image_payload["operation"], operation)
                self.assertEqual(
                    self.server.last_image_payload["input_images"],
                    [{"url": "/uploads/images/imported.png"}],
                )
        self.assertEqual(
            self.server.last_image_payload["input_images"],
            [{"url": "/uploads/images/imported.png"}],
        )

    def test_advanced_image_tool_uploads_absolute_local_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "reference.png"
            image_path.write_bytes(b"\x89PNG\r\n\x1a\n")
            result = self.call(
                self.plugin.handle_create_variation,
                {
                    "prompt": "keep the bee and make a close variation",
                    "input_images": [str(image_path)],
                    "wait": True,
                },
            )

        self.assertTrue(result["success"])
        self.assertEqual(
            self.server.last_image_payload["input_images"],
            [{"url": "/uploads/images/local.png"}],
        )

    def test_imports_local_file_and_remote_url(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "sample.png"
            image_path.write_bytes(b"\x89PNG\r\n\x1a\n")
            local = self.call(
                self.plugin.handle_import_image,
                {"source": str(image_path)},
            )
        self.assertTrue(local["success"])
        self.assertEqual(local["asset"]["url"], "/uploads/images/local.png")
        self.assertIn("multipart/form-data", self.server.last_upload_content_type)
        self.assertIn(b"sample.png", self.server.last_upload_body)

        remote = self.call(
            self.plugin.handle_import_image,
            {"source": "https://example.com/generated.png"},
        )
        self.assertTrue(remote["success"])
        self.assertEqual(remote["asset"]["url"], "/uploads/images/imported.png")
        self.assertEqual(
            self.server.last_localize_payload,
            {"urls": ["https://example.com/generated.png"]},
        )

    def test_combined_tool_reuses_hermes_provider_then_imports(self):
        previous = self.plugin.hermes_generate_image
        self.plugin.hermes_generate_image = lambda _args: {
            "success": True,
            "image": "https://example.com/hermes.png",
            "provider": "openai-codex",
        }
        try:
            result = self.call(
                self.plugin.handle_generate_and_import,
                {"prompt": "a blue technology bee", "engine": "hermes"},
            )
        finally:
            self.plugin.hermes_generate_image = previous
        self.assertTrue(result["success"])
        self.assertEqual(result["engine"], "hermes")
        self.assertEqual(result["asset"]["url"], "/uploads/images/imported.png")

    def test_combined_tool_falls_back_to_bridge(self):
        previous = self.plugin.hermes_generate_image
        self.plugin.hermes_generate_image = lambda _args: {
            "success": False,
            "error": "Hermes image provider is not configured",
        }
        try:
            result = self.call(
                self.plugin.handle_generate_and_import,
                {
                    "prompt": "fallback bee",
                    "engine": "hermes",
                    "fallback_to_bridge": True,
                    "wait": True,
                },
            )
        finally:
            self.plugin.hermes_generate_image = previous
        self.assertTrue(result["success"])
        self.assertEqual(result["engine"], "bridge")
        self.assertIn("Hermes image provider is not configured", result["fallback_reason"])
        self.assertEqual(result["asset"]["url"], "/uploads/images/imported.png")

    def test_task_control_tools(self):
        status = self.call(self.plugin.handle_task_status, {"task_id": "task-1"})
        cancel = self.call(self.plugin.handle_cancel_task, {"task_id": "task-1"})
        retry = self.call(self.plugin.handle_retry_task, {"task_id": "task-1"})
        self.assertEqual(status["data"]["status"], "completed")
        self.assertEqual(cancel["task"]["status"], "cancelled")
        self.assertEqual(retry["retry_of"], "task-1")


if __name__ == "__main__":
    unittest.main()

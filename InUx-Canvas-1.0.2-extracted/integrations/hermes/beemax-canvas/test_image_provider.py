import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import hermes_image_provider as provider


PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
    "AAAADUlEQVR42mNk+M/wHwAF/gL+Xy4uAAAAAElFTkSuQmCC"
)


class HermesImageProviderTests(unittest.TestCase):
    def test_generate_dispatches_to_hermes_and_materializes_data_url(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "generated.png"
            payload = {
                "operation": "generate",
                "prompt": "一只蓝色蜜蜂",
                "model": "gpt-image-2-medium",
                "aspect_ratio": "3:4",
                "output_path": str(output),
            }
            data_url = "data:image/png;base64," + base64.b64encode(PNG_BYTES).decode()

            with patch.object(
                provider,
                "_dispatch_image_generate",
                return_value=json.dumps({"success": True, "image_url": data_url}),
            ) as dispatch:
                result = provider.run(payload)

            self.assertTrue(result["success"])
            self.assertEqual(output.read_bytes(), PNG_BYTES)
            dispatch.assert_called_once_with(
                prompt="一只蓝色蜜蜂",
                aspect_ratio="3:4",
            )

    def test_rejects_edit_operations_instead_of_silently_ignoring_inputs(self):
        with self.assertRaisesRegex(ValueError, "仅支持直接生图"):
            provider.run(
                {
                    "operation": "edit",
                    "prompt": "修改图片",
                    "output_path": "/tmp/unused.png",
                }
            )

    def test_rejects_local_files_outside_the_hermes_image_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "secret.png"
            output = Path(directory) / "output.png"
            source.write_bytes(PNG_BYTES)
            with patch.object(
                provider,
                "_dispatch_image_generate",
                return_value={"success": True, "image": str(source)},
            ):
                with self.assertRaisesRegex(RuntimeError, "不在受控缓存目录"):
                    provider.run(
                        {
                            "operation": "generate",
                            "prompt": "测试",
                            "output_path": str(output),
                        }
                    )


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Bridge command provider that reuses Hermes' configured image generation."""

from __future__ import annotations

import base64
import ipaddress
import json
import os
import socket
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


MAX_IMAGE_BYTES = 50 * 1024 * 1024


def _hermes_aspect_ratio(value: str) -> str:
    normalized = str(value or "").lower()
    if normalized in {"1:1", "square"}:
        return "square"
    if normalized in {"3:4", "4:5", "9:16", "portrait"}:
        return "portrait"
    return "landscape"


def _dispatch_image_generate(*, prompt: str, aspect_ratio: str) -> Any:
    # Plugin discovery registers bundled backends such as openai-codex in the
    # image provider registry. Tool discovery registers image_generate itself.
    from hermes_cli.plugins import discover_plugins
    from tools.registry import discover_builtin_tools, registry

    discover_plugins()
    discover_builtin_tools()
    return registry.dispatch(
        "image_generate",
        {"prompt": prompt, "aspect_ratio": _hermes_aspect_ratio(aspect_ratio)},
    )

def _probe_image_provider() -> dict[str, Any]:
    from hermes_cli.plugins import discover_plugins
    from hermes_cli.config import load_config
    from agent.image_gen_registry import get_provider

    discover_plugins()
    config = load_config()
    image_config = config.get("image_gen") if isinstance(config, dict) else {}
    provider_name = image_config.get("provider") if isinstance(image_config, dict) else ""
    provider = get_provider(str(provider_name or ""))
    if not provider_name or provider is None:
        raise RuntimeError("Hermes 尚未配置 image_gen.provider")
    if not provider.is_available():
        raise RuntimeError(f"Hermes image_gen Provider '{provider_name}' 未登录或依赖不完整")
    return {"success": True, "provider": provider_name}


def _normalize_result(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise RuntimeError("Hermes image_generate 返回了无效结果")
    if value.get("success") is False:
        raise RuntimeError(str(value.get("error") or "Hermes 生图失败"))
    return value


def _image_content_type(image: bytes) -> str:
    if image.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(image) >= 12 and image[:4] == b"RIFF" and image[8:12] == b"WEBP":
        return "image/webp"
    raise RuntimeError("Hermes 返回的内容不是受支持的图片")


def _is_public_hostname(hostname: str) -> bool:
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(hostname, None)}
    except socket.gaierror as exc:
        raise RuntimeError("Hermes 图片地址无法解析") from exc
    return bool(addresses) and all(ipaddress.ip_address(address).is_global for address in addresses)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


def _write_source(source: str, output: Path) -> str:
    output.parent.mkdir(parents=True, exist_ok=True)
    if source.startswith("data:image/"):
        try:
            encoded = source.split(",", 1)[1]
            image = base64.b64decode(encoded, validate=True)
        except (IndexError, ValueError) as exc:
            raise RuntimeError("Hermes 返回了无效图片 data URL") from exc
        if len(image) > MAX_IMAGE_BYTES:
            raise RuntimeError("Hermes 返回的图片超过 50 MB")
        content_type = _image_content_type(image)
        output.write_bytes(image)
        return content_type

    if source.startswith(("http://", "https://")):
        parsed = urllib.parse.urlparse(source)
        if not parsed.hostname or not _is_public_hostname(parsed.hostname):
            raise RuntimeError("Hermes 图片地址不能指向本机或私有网络")
        request = urllib.request.Request(source, headers={"User-Agent": "BeeMax-Canvas/1.0"})
        with urllib.request.build_opener(_NoRedirect).open(request, timeout=60) as response:
            response_type = str(response.headers.get_content_type() or "")
            image = response.read(MAX_IMAGE_BYTES + 1)
        if len(image) > MAX_IMAGE_BYTES:
            raise RuntimeError("Hermes 返回的图片超过 50 MB")
        content_type = _image_content_type(image)
        if response_type and response_type != content_type:
            raise RuntimeError("Hermes 图片响应的 Content-Type 与文件内容不一致")
        output.write_bytes(image)
        return content_type

    source_path = Path(source.removeprefix("file://")).expanduser().resolve()
    if not source_path.is_file():
        raise RuntimeError(f"Hermes 图片文件不存在：{source_path}")
    hermes_home = Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser().resolve()
    allowed_root = (hermes_home / "cache" / "images").resolve()
    if source_path != allowed_root and allowed_root not in source_path.parents:
        raise RuntimeError("Hermes 图片文件不在受控缓存目录中")
    if source_path.stat().st_size > MAX_IMAGE_BYTES:
        raise RuntimeError("Hermes 返回的图片超过 50 MB")
    image = source_path.read_bytes()
    content_type = _image_content_type(image)
    output.write_bytes(image)
    return content_type


def run(payload: dict[str, Any]) -> dict[str, Any]:
    operation = str(payload.get("operation") or "generate")
    if operation == "probe":
        return _probe_image_provider()
    if operation != "generate":
        raise ValueError("Hermes 命令 Provider 目前仅支持直接生图")
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt 不能为空")
    output_value = str(payload.get("output_path") or "").strip()
    if not output_value:
        raise ValueError("output_path 不能为空")
    output = Path(output_value).expanduser()

    result = _normalize_result(
        _dispatch_image_generate(
            prompt=prompt,
            aspect_ratio=str(payload.get("aspect_ratio") or "landscape"),
        )
    )
    source = str(
        result.get("image")
        or result.get("image_url")
        or result.get("url")
        or ""
    ).strip()
    if not source:
        raise RuntimeError("Hermes 生图成功，但没有返回图片")
    content_type = _write_source(source, output)
    return {
        "success": True,
        "image": str(output),
        "content_type": content_type,
        "provider": str(result.get("provider") or "openai-codex"),
        "model": str(result.get("model") or payload.get("model") or ""),
        "aspect_ratio": str(result.get("aspect_ratio") or payload.get("aspect_ratio") or ""),
    }


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        print(json.dumps(run(payload), ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

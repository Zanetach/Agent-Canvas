"""BeeMax Canvas tools for Hermes Agent.

This standalone plugin keeps Hermes' own image provider as the primary engine
and uses the BeeMax Bridge (Codex first, relay fallback) when requested or when
the Hermes provider is unavailable.
"""

from __future__ import annotations

import json
import mimetypes
import os
import threading
import time
import uuid
import webbrowser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


TOOLSET = "beemax_canvas"
TERMINAL_STATUSES = {"completed", "success", "failed", "error", "cancelled", "canceled", "save_failed"}
SUCCESS_STATUSES = {"completed", "success"}


def _result(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _error(message: str, **extra: Any) -> str:
    return _result({"success": False, "error": message, **extra})


def _base_url() -> str:
    return os.environ.get("BEEMAX_CANVAS_URL", "http://127.0.0.1:17851").rstrip("/")


def _timeout(args: dict[str, Any], default: float = 15.0) -> float:
    raw = args.get("timeout_seconds", os.environ.get("BEEMAX_CANVAS_TIMEOUT_SECONDS", default))
    try:
        return max(1.0, float(raw))
    except (TypeError, ValueError):
        return default


def _bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value.strip().lower() in {"true", "1", "yes", "on"}:
            return True
        if value.strip().lower() in {"false", "0", "no", "off"}:
            return False
    return default


def _request_json(
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 15.0,
) -> dict[str, Any]:
    url = path if path.startswith(("http://", "https://")) else f"{_base_url()}{path}"
    request_headers = {"accept": "application/json", **(headers or {})}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request_headers["content-type"] = "application/json"
    request = Request(url, data=body, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
            message = detail.get("error") or detail.get("detail") or raw
        except json.JSONDecodeError:
            message = raw or str(exc)
        raise RuntimeError(f"BeeMax Canvas HTTP {exc.code}: {message}") from exc
    except URLError as exc:
        raise RuntimeError(f"无法连接 BeeMax Canvas（{_base_url()}）：{exc.reason}") from exc


def register_agent_capabilities(capabilities: dict[str, Any]) -> dict[str, Any]:
    """Publish Hermes model names to Canvas without copying provider credentials."""
    models = capabilities.get("models") or {}
    payload = {
        "id": str(capabilities.get("id") or "hermes-agent").strip(),
        "agent": "Hermes Agent",
        "endpoint": str(capabilities.get("endpoint") or "").strip(),
        "models": {
            kind: [str(model).strip() for model in models.get(kind, []) if str(model).strip()]
            for kind in ("text", "image", "video")
        },
        "capabilities": capabilities.get("capabilities") or {},
    }
    return _request_json(
        "POST",
        "/api/beemax/agent-plugins/register",
        payload=payload,
        timeout=_timeout(capabilities),
    )


def discover_agent_capabilities(capabilities: dict[str, Any]) -> dict[str, Any]:
    """Ask Canvas to read the non-secret model manifest from a local Agent gateway."""
    return _request_json(
        "POST",
        "/api/beemax/agent-plugins/discover",
        payload={"endpoint": str(capabilities.get("endpoint") or "").strip()},
        timeout=_timeout(capabilities),
    )


def _multipart_file(path: Path) -> tuple[bytes, str]:
    boundary = f"----BeeMaxHermes{uuid.uuid4().hex}"
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    body = bytearray()
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(
        (
            f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
    )
    body.extend(path.read_bytes())
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def _first_asset(payload: dict[str, Any]) -> dict[str, Any] | None:
    asset = payload.get("asset")
    if isinstance(asset, dict):
        return asset
    for key in ("assets", "localized_assets", "results"):
        values = payload.get(key)
        if isinstance(values, list) and values:
            first = values[0]
            if isinstance(first, dict):
                return first
            if isinstance(first, str):
                return {"url": first}
    for key in ("urls", "localized_urls"):
        values = payload.get(key)
        if isinstance(values, list) and values:
            return {"url": values[0]}
    return None


def import_image(source: str, *, timeout: float = 30.0) -> dict[str, Any]:
    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        payload = _request_json(
            "POST",
            "/api/assets/localize",
            payload={"urls": [source]},
            timeout=timeout,
        )
    else:
        path = Path(source).expanduser().resolve()
        if not path.is_file():
            raise ValueError(f"图片文件不存在：{path}")
        body, content_type = _multipart_file(path)
        payload = _request_json(
            "POST",
            "/api/uploads/images",
            body=body,
            headers={"content-type": content_type},
            timeout=timeout,
        )
    asset = _first_asset(payload)
    if not asset or not asset.get("url"):
        raise RuntimeError(f"BeeMax Canvas 未返回可用图片资产：{payload}")
    return {"success": True, "source": source, "asset": asset, "response": payload}


def _task_data(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    return data if isinstance(data, dict) else payload


def _task_urls(task: dict[str, Any]) -> list[str]:
    for key in ("server_urls", "image_urls"):
        values = task.get(key)
        if isinstance(values, list) and values:
            return [str(value) for value in values if value]
    result = task.get("result")
    if isinstance(result, dict) and isinstance(result.get("image_urls"), list):
        return [str(value) for value in result["image_urls"] if value]
    return []


def _wait_for_task(task_id: str, timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while True:
        response = _request_json("GET", f"/api/task/{quote(task_id)}", timeout=min(timeout, 15.0))
        task = _task_data(response)
        status = str(task.get("canonical_status") or task.get("status") or "").lower()
        if status in TERMINAL_STATUSES:
            return task
        if time.monotonic() >= deadline:
            raise TimeoutError(f"等待 BeeMax 任务 {task_id} 超时（{timeout:g} 秒）")
        time.sleep(0.5)


def bridge_generate(args: dict[str, Any]) -> dict[str, Any]:
    prompt = str(args.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt 不能为空")
    payload = {
        "operation": str(args.get("operation") or "generate"),
        "prompt": prompt,
        "size": str(args.get("aspect_ratio") or args.get("size") or "1:1"),
        "n": max(1, min(4, int(args.get("n") or 1))),
        "async_mode": True,
    }
    optional_fields = (
        "model",
        "quality",
        "resolution",
        "project_id",
        "node_id",
        "run_id",
        "parent_id",
        "parent_asset_id",
        "batch_id",
    )
    payload.update({key: args[key] for key in optional_fields if args.get(key) not in (None, "")})
    if args.get("input_images"):
        payload["input_images"] = args["input_images"]
    if args.get("mask_image"):
        payload["mask_image"] = args["mask_image"]
    response = _request_json("POST", "/api/image", payload=payload, timeout=_timeout(args, 30.0))
    task_id = str(response.get("task_id") or "")
    if not response.get("success") or not task_id:
        raise RuntimeError(str(response.get("error") or "BeeMax Bridge 未返回任务 ID"))
    result: dict[str, Any] = {"success": True, "task_id": task_id, "submitted": response}
    if not _bool(args.get("wait"), True):
        return result
    task = _wait_for_task(task_id, _timeout(args, 180.0))
    status = str(task.get("canonical_status") or task.get("status") or "").lower()
    result.update({"task": task, "image_urls": _task_urls(task)})
    if status not in SUCCESS_STATUSES:
        result["success"] = False
        result["error"] = str(task.get("error") or f"BeeMax 任务状态：{status}")
    return result


def bridge_generate_and_import(args: dict[str, Any]) -> dict[str, Any]:
    generated = bridge_generate({**args, "wait": True})
    if not generated.get("success"):
        return generated
    image_urls = generated.get("image_urls") or []
    if not image_urls:
        raise RuntimeError("BeeMax Bridge 任务完成但未返回图片 URL")
    source = str(image_urls[0])
    if source.startswith("/uploads/"):
        imported = {"success": True, "source": source, "asset": {"url": source}}
    else:
        absolute_source = f"{_base_url()}{source}" if source.startswith("/") else source
        imported = import_image(absolute_source, timeout=_timeout(args, 30.0))
    generated.update({"asset": imported["asset"], "import": imported})
    return generated


def hermes_generate_image(args: dict[str, Any]) -> dict[str, Any]:
    """Dispatch the existing Hermes image tool without starting another model turn."""
    try:
        from tools.registry import registry

        raw = registry.dispatch(
            "image_generate",
            {
                "prompt": str(args.get("prompt") or "").strip(),
                "aspect_ratio": str(args.get("aspect_ratio") or "1:1"),
            },
        )
        payload = json.loads(raw) if isinstance(raw, str) else raw
        return payload if isinstance(payload, dict) else {"success": False, "error": str(payload)}
    except Exception as exc:
        return {"success": False, "error": f"Hermes image_generate 调用失败：{exc}"}


def handle_status(args: dict[str, Any], **_kwargs: Any) -> str:
    try:
        timeout = _timeout(args)
        health = _request_json("GET", "/api/beemax/health", timeout=timeout)
        capabilities = _request_json("GET", "/api/beemax/capabilities", timeout=timeout)
        return _result(
            {
                "success": True,
                "canvas_url": _base_url(),
                "health": health,
                "capabilities": capabilities,
                "hermes_provider_policy": "Hermes image_generate first; BeeMax Bridge fallback",
            }
        )
    except Exception as exc:
        return _error(str(exc), canvas_url=_base_url())


def handle_generate_image(args: dict[str, Any], **_kwargs: Any) -> str:
    try:
        return _result(bridge_generate(args))
    except Exception as exc:
        return _error(str(exc))


def _prepare_image_reference(value: Any) -> dict[str, Any]:
    reference = dict(value) if isinstance(value, dict) else {"url": str(value or "")}
    source = str(reference.get("url") or reference.get("source") or "").strip()
    if not source:
        raise ValueError("图片引用不能为空")
    local_path = Path(source).expanduser()
    if local_path.is_file():
        imported = import_image(str(local_path.resolve()), timeout=30.0)
        source = str(imported["asset"]["url"])
        if imported["asset"].get("id"):
            reference["asset_id"] = imported["asset"]["id"]
    elif source.startswith(("http://", "https://")):
        imported = import_image(source, timeout=30.0)
        source = str(imported["asset"]["url"])
        if imported["asset"].get("id"):
            reference["asset_id"] = imported["asset"]["id"]
    elif not source.startswith(("data:image/", "/")):
        imported = import_image(source, timeout=30.0)
        source = str(imported["asset"]["url"])
        if imported["asset"].get("id"):
            reference["asset_id"] = imported["asset"]["id"]
    reference.pop("source", None)
    reference["url"] = source
    return reference


def _handle_advanced_operation(args: dict[str, Any], operation: str) -> str:
    try:
        input_images = [_prepare_image_reference(value) for value in (args.get("input_images") or [])]
        if not input_images:
            return _error(f"{operation} 至少需要一张 input_images")
        request = {**args, "operation": operation, "input_images": input_images}
        if args.get("mask_image"):
            request["mask_image"] = _prepare_image_reference(args["mask_image"])
        return _result(bridge_generate_and_import(request))
    except Exception as exc:
        return _error(str(exc), operation=operation)


def handle_generate_from_references(args: dict[str, Any], **_kwargs: Any) -> str:
    return _handle_advanced_operation(args, "generate")


def handle_edit_image(args: dict[str, Any], **_kwargs: Any) -> str:
    return _handle_advanced_operation(args, "edit")


def handle_mask_edit(args: dict[str, Any], **_kwargs: Any) -> str:
    if not args.get("mask_image"):
        return _error("mask_image 不能为空", operation="mask")
    return _handle_advanced_operation(args, "mask")


def handle_outpaint_image(args: dict[str, Any], **_kwargs: Any) -> str:
    return _handle_advanced_operation(args, "outpaint")


def handle_create_variation(args: dict[str, Any], **_kwargs: Any) -> str:
    return _handle_advanced_operation(args, "variation")


def handle_import_image(args: dict[str, Any], **_kwargs: Any) -> str:
    source = str(args.get("source") or "").strip()
    if not source:
        return _error("source 不能为空")
    try:
        return _result(import_image(source, timeout=_timeout(args, 30.0)))
    except Exception as exc:
        return _error(str(exc))


def _generated_source(payload: dict[str, Any]) -> str:
    for key in ("image", "image_url", "url"):
        if payload.get(key):
            return str(payload[key])
    for key in ("images", "image_urls"):
        values = payload.get(key)
        if isinstance(values, list) and values:
            first = values[0]
            if isinstance(first, dict):
                return str(first.get("url") or first.get("image") or "")
            return str(first)
    return ""


def handle_generate_and_import(args: dict[str, Any], **_kwargs: Any) -> str:
    prompt = str(args.get("prompt") or "").strip()
    if not prompt:
        return _error("prompt 不能为空")
    engine = str(args.get("engine") or "hermes").strip().lower()
    if engine not in {"hermes", "bridge"}:
        return _error("engine 只能是 hermes 或 bridge")
    try:
        if engine == "bridge":
            return _result({"engine": "bridge", **bridge_generate_and_import(args)})

        generated = hermes_generate_image(args)
        source = _generated_source(generated)
        hermes_ok = bool(generated.get("success")) and bool(source)
        if hermes_ok:
            imported = import_image(source, timeout=_timeout(args, 30.0))
            return _result(
                {
                    "success": True,
                    "engine": "hermes",
                    "generation": generated,
                    "asset": imported["asset"],
                    "import": imported,
                }
            )

        reason = str(generated.get("error") or "Hermes image_generate 未返回图片")
        if not _bool(args.get("fallback_to_bridge"), True):
            return _error(reason, engine="hermes", generation=generated)
        fallback = bridge_generate_and_import(args)
        return _result({"engine": "bridge", "fallback_reason": reason, **fallback})
    except Exception as exc:
        return _error(str(exc), engine=engine)


def _handle_task_action(args: dict[str, Any], method: str, suffix: str = "") -> str:
    task_id = str(args.get("task_id") or "").strip()
    if not task_id:
        return _error("task_id 不能为空")
    try:
        path = f"/api/task/{quote(task_id)}{suffix}"
        payload = {} if method == "POST" else None
        return _result(_request_json(method, path, payload=payload, timeout=_timeout(args)))
    except Exception as exc:
        return _error(str(exc), task_id=task_id)


def handle_task_status(args: dict[str, Any], **_kwargs: Any) -> str:
    return _handle_task_action(args, "GET")


def handle_cancel_task(args: dict[str, Any], **_kwargs: Any) -> str:
    return _handle_task_action(args, "POST", "/cancel")


def handle_retry_task(args: dict[str, Any], **_kwargs: Any) -> str:
    return _handle_task_action(args, "POST", "/retry")


def handle_open_canvas(args: dict[str, Any], **_kwargs: Any) -> str:
    try:
        _request_json("GET", "/api/beemax/health", timeout=_timeout(args))
        opened = False
        if _bool(args.get("open_browser"), True):
            opened = bool(webbrowser.open(_base_url(), new=2))
        return _result({"success": True, "canvas_url": _base_url(), "browser_opened": opened})
    except Exception as exc:
        return _error(str(exc), canvas_url=_base_url())


def _schema(description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "name": "",
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required or [],
            "additionalProperties": False,
        },
    }


PROMPT = {"type": "string", "description": "Image generation prompt."}
ASPECT = {"type": "string", "description": "Aspect ratio such as 1:1, 16:9, 3:4, or 9:16."}
WAIT = {"type": "boolean", "description": "Wait for the asynchronous task to finish. Defaults to true."}
TIMEOUT = {"type": "number", "description": "Request or task timeout in seconds."}
IMAGE_INPUTS = {
    "type": "array",
    "items": {"type": "string"},
    "minItems": 1,
    "maxItems": 10,
    "description": "Local image paths, Canvas asset paths, HTTP(S) URLs, or image Data URLs.",
}


def _advanced_schema(description: str, *, mask: bool = False) -> dict[str, Any]:
    properties = {
        "prompt": PROMPT,
        "input_images": IMAGE_INPUTS,
        "aspect_ratio": ASPECT,
        "resolution": {"type": "string", "enum": ["1k", "2k", "4k"]},
        "quality": {"type": "string", "enum": ["low", "medium", "high"]},
        "project_id": {"type": "string"},
        "node_id": {"type": "string"},
        "parent_asset_id": {"type": "string"},
        "timeout_seconds": TIMEOUT,
    }
    required = ["prompt", "input_images"]
    if mask:
        properties["mask_image"] = {
            "type": "string",
            "description": "PNG mask with an alpha channel; transparent pixels are edited.",
        }
        required.append("mask_image")
    return _schema(description, properties, required)

TOOLS = (
    (
        "beemax_canvas_status",
        _schema("Check BeeMax Canvas, Bridge health, and image capabilities.", {"timeout_seconds": TIMEOUT}),
        handle_status,
        "🩺",
    ),
    (
        "beemax_generate_image",
        _schema(
            "Generate images through BeeMax Bridge (Codex provider first, relay fallback).",
            {
                "prompt": PROMPT,
                "aspect_ratio": ASPECT,
                "n": {"type": "integer", "minimum": 1, "maximum": 4},
                "model": {"type": "string"},
                "quality": {"type": "string"},
                "project_id": {"type": "string"},
                "node_id": {"type": "string"},
                "timeout_seconds": TIMEOUT,
            },
            ["prompt"],
        ),
        handle_generate_image,
        "🎨",
    ),
    (
        "beemax_generate_and_import",
        _schema(
            "Generate with Hermes' configured image_generate provider and import into BeeMax Canvas; optionally fall back to BeeMax Bridge. Text-to-image is supported in this version.",
            {
                "prompt": PROMPT,
                "aspect_ratio": ASPECT,
                "engine": {"type": "string", "enum": ["hermes", "bridge"], "description": "Defaults to hermes."},
                "fallback_to_bridge": {"type": "boolean", "description": "Defaults to true."},
                "project_id": {"type": "string"},
                "node_id": {"type": "string"},
                "wait": WAIT,
                "timeout_seconds": TIMEOUT,
            },
            ["prompt"],
        ),
        handle_generate_and_import,
        "🐝",
    ),
    (
        "beemax_generate_from_references",
        _advanced_schema("Generate a new image from one to ten high-fidelity reference images and import it into BeeMax Canvas."),
        handle_generate_from_references,
        "🖼️",
    ),
    (
        "beemax_edit_image",
        _advanced_schema("Edit an existing image with a prompt while preserving unrequested details, then import the result."),
        handle_edit_image,
        "✏️",
    ),
    (
        "beemax_mask_edit",
        _advanced_schema("Edit only the area selected by an alpha PNG mask and import the result.", mask=True),
        handle_mask_edit,
        "🎭",
    ),
    (
        "beemax_outpaint_image",
        _advanced_schema("Extend an image beyond its original boundaries to a requested aspect ratio or resolution."),
        handle_outpaint_image,
        "↔️",
    ),
    (
        "beemax_create_variation",
        _advanced_schema("Create a close high-fidelity variation of an image and import it into BeeMax Canvas."),
        handle_create_variation,
        "🔀",
    ),
    (
        "beemax_import_image",
        _schema(
            "Import a local image path or remote HTTP(S) image URL into the BeeMax Canvas asset library.",
            {"source": {"type": "string"}, "timeout_seconds": TIMEOUT},
            ["source"],
        ),
        handle_import_image,
        "📥",
    ),
    (
        "beemax_task_status",
        _schema("Read a BeeMax generation task.", {"task_id": {"type": "string"}, "timeout_seconds": TIMEOUT}, ["task_id"]),
        handle_task_status,
        "🔎",
    ),
    (
        "beemax_cancel_task",
        _schema("Cancel a running BeeMax generation task.", {"task_id": {"type": "string"}, "timeout_seconds": TIMEOUT}, ["task_id"]),
        handle_cancel_task,
        "⏹️",
    ),
    (
        "beemax_retry_task",
        _schema("Retry a finished or failed BeeMax generation task.", {"task_id": {"type": "string"}, "timeout_seconds": TIMEOUT}, ["task_id"]),
        handle_retry_task,
        "🔁",
    ),
    (
        "beemax_open_canvas",
        _schema(
            "Open the local BeeMax Canvas web app in the default browser after checking its health.",
            {"open_browser": {"type": "boolean", "description": "Defaults to true."}, "timeout_seconds": TIMEOUT},
        ),
        handle_open_canvas,
        "🌐",
    ),
)


def register(ctx: Any) -> None:
    for name, schema, handler, emoji in TOOLS:
        schema = {**schema, "name": name}
        ctx.register_tool(
            name=name,
            toolset=TOOLSET,
            schema=schema,
            handler=handler,
            description=schema["description"],
            emoji=emoji,
        )
    gateway = os.environ.get("BEEMAX_AGENT_GATEWAY_URL", "").strip()
    raw_models = os.environ.get("BEEMAX_AGENT_MODELS_JSON", "").strip()
    if gateway:
        def sync_capabilities() -> None:
            for attempt in range(12):
                try:
                    if raw_models:
                        register_agent_capabilities(
                            {
                                "id": os.environ.get("BEEMAX_AGENT_INSTANCE_ID", "hermes-agent"),
                                "endpoint": gateway,
                                "models": json.loads(raw_models),
                                "timeout_seconds": 2,
                            }
                        )
                    else:
                        discover_agent_capabilities(
                            {"endpoint": gateway, "timeout_seconds": 2}
                        )
                    return
                except Exception:
                    if attempt < 11:
                        time.sleep(5)

        threading.Thread(
            target=sync_capabilities,
            name="beemax-agent-capability-sync",
            daemon=True,
        ).start()

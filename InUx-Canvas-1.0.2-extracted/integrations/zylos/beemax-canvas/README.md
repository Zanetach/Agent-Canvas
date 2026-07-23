# BeeMax Canvas for Zylos

This Zylos capability component connects a Zylos agent to BeeMax Canvas without
changing Zylos core or copying model credentials. Zylos invokes a local CLI;
the CLI uses the BeeMax HTTP contract; BeeMax Bridge routes image work to Codex
and an optional relay fallback.

## Capabilities

- Text-to-image generation
- Generation from one to ten reference images
- Whole-image editing
- Alpha-mask editing
- Outpainting to a new aspect ratio
- Variations
- Canvas asset upload and remote image localization
- Task status, cancellation, and retry
- Canvas health/capability discovery and browser launch

## Local installation

Start BeeMax Canvas first, then install the local component through the Zylos
CLI so it is registered for list, upgrade, uninstall, hooks, and configuration:

```bash
cd /path/to/InUx-Canvas-1.0.2-extracted
./start-web.sh --no-open
zylos add "$PWD/integrations/zylos/beemax-canvas" --yes
```

Or run the included installer:

```bash
integrations/zylos/install-beemax-canvas.sh
```

Zylos keeps components in `.claude/skills` for both runtimes. When Codex is the
active runtime, Zylos creates `.agents/skills` as a symlink to that directory,
so the same component is discovered automatically. Every operation is a
runtime-neutral Node.js CLI command and returns JSON.

Configure a non-default Canvas URL with the Zylos component hook:

```bash
printf '%s\n' '{"BEEMAX_CANVAS_URL":"http://127.0.0.1:17851"}' \
  | ZYLOS_DATA_DIR="$HOME/zylos/components/beemax-canvas" \
    node "$HOME/zylos/.claude/skills/beemax-canvas/hooks/configure.js"
```

Verify the connection:

```bash
node "$HOME/zylos/.claude/skills/beemax-canvas/scripts/beemax.js" status
```

After installation, start a new Zylos agent session so its runtime reloads the
component description. Example user instructions:

```text
Use BeeMax Canvas to create a 3:4 technology-blue campaign poster.
Use these two product photos as references and keep the product identity.
Outpaint this image to 16:9 and import the result into the canvas.
Open BeeMax Canvas.
```

## Provider policy

This component does not require a Gemini or OpenAI key. BeeMax Bridge owns image
routing and authentication. The current route is Codex native first, then the
configured relay fallback. Zylos only receives task metadata and local Canvas
asset URLs.

Zylos hosts that expose their own local model gateway should implement
`GET /v1/manifest` and set `BEEMAX_AGENT_GATEWAY_URL`. The component calls the
exported `discoverAgentCapabilities` function at startup, so text, image, and
video model names appear automatically in Canvas without copying a model list.
Older hosts can continue using `registerAgentCapabilities`. Credentials always
remain inside Zylos.

## Development

```bash
npm test
```

The `upgrade.repo` metadata targets the intended upstream component repository.
Until that repository is published in the Zylos registry, install this bundled
component from the local BeeMax distribution using the commands above.

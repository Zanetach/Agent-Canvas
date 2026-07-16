---
name: beemax-canvas
version: 0.1.0
description: >
  BeeMax Canvas image creation and editing for Zylos agents. Use when the user
  asks to generate images, create from reference images, edit an image, paint
  through a mask, outpaint, create variations, import an image into the canvas,
  inspect or cancel a generation task, or open the BeeMax Canvas web app.
type: capability

lifecycle:
  npm: false
  data_dir: ~/zylos/components/beemax-canvas
  hooks:
    configure: hooks/configure.js
    post-install: hooks/post-install.js
  preserve:
    - config.json

upgrade:
  repo: zylos-ai/zylos-beemax-canvas
  branch: main

config:
  required: []
  optional:
    - name: BEEMAX_CANVAS_URL
      description: BeeMax Canvas URL
      default: "http://127.0.0.1:17851"
    - name: BEEMAX_CANVAS_TIMEOUT_SECONDS
      description: Default request and task timeout in seconds
      default: "300"

dependencies: []
---

# BeeMax Canvas

All commands print machine-readable JSON. Run the status command before a
generation request when availability is unknown.

```bash
node ~/zylos/.claude/skills/beemax-canvas/scripts/beemax.js status
node ~/zylos/.claude/skills/beemax-canvas/scripts/beemax.js generate --prompt "A blue technology poster" --aspect-ratio 3:4
node ~/zylos/.claude/skills/beemax-canvas/scripts/beemax.js references --input ./product.png --prompt "Create a premium product poster"
node ~/zylos/.claude/skills/beemax-canvas/scripts/beemax.js edit --input ./source.png --prompt "Change the background to blue"
node ~/zylos/.claude/skills/beemax-canvas/scripts/beemax.js mask --input ./source.png --mask ./mask.png --prompt "Replace the transparent mask area"
node ~/zylos/.claude/skills/beemax-canvas/scripts/beemax.js outpaint --input ./source.png --prompt "Extend naturally" --aspect-ratio 16:9
node ~/zylos/.claude/skills/beemax-canvas/scripts/beemax.js variation --input ./source.png --prompt "Keep the subject and create a variation"
node ~/zylos/.claude/skills/beemax-canvas/scripts/beemax.js open
```

Use `--input` repeatedly for up to ten reference images. Local files and remote
images are imported into Canvas assets before advanced operations. A mask must
be a PNG with an alpha channel and the same dimensions as its source image.

Run `node ~/zylos/.claude/skills/beemax-canvas/scripts/beemax.js --help` for the
complete command reference.

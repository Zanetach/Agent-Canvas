# Hermes Marketing Agent Skills

This bundle contains 15 upstream open-source Skills for a Hermes marketing Agent:

```text
project positioning -> audience research -> competitor insight -> market signals
-> marketing planning -> content -> creative -> publishing -> conversion -> optimization
```

## Install or Update

Unzip the bundle, then run:

```bash
cd hermes-marketing-agent-skills
./install-hermes-marketing-skills.sh --dry-run
./install-hermes-marketing-skills.sh
```

The installer updates `~/.hermes/skills/marketing/`. Before replacing a same-name Skill, it moves the old folder into `~/.hermes/backups/`, outside Hermes' Skill discovery path.

To install into a non-default Hermes home or test directory:

```bash
./install-hermes-marketing-skills.sh --target /path/to/.hermes/skills/marketing
./install-hermes-marketing-skills.sh --backup-dir /path/to/hermes-backups
```

## Included Skills

| Capability | Skills |
| --- | --- |
| Positioning and customer insight | `product-marketing`, `customer-research`, `competitor-profiling`, `marketing-plan` |
| Market signals and content | `news-aggregator-skill`, `content-strategy`, `copywriting`, `social` |
| Creative and publishing | `baoyu-cover-image`, `baoyu-xhs-images`, `baoyu-post-to-wechat` |
| Conversion and optimization | `cro`, `revops`, `analytics`, `ab-testing` |

Government policy is configured as an official source in `news-aggregator-skill`; it is not a separate Skill. Keep policy source, agency, publication date, and original link in every output.

## Required Runtime Setup

- `news-aggregator-skill`: Python 3.10+, `pip install -r requirements.txt`; install Playwright Chromium if deep page retrieval is needed.
- `baoyu-post-to-wechat`: Bun or npx, Chrome, and either WeChat Official Account API credentials or a logged-in Chrome profile.
- Visual Skills: an image-generation backend available to Hermes.

The bundle provides Skill files only. It does not include account credentials, cookies, CRM data, Feishu access, or government source configuration.

## Upstream Sources and Licenses

- `news-aggregator-skill`: https://github.com/cclank/news-aggregator-skill
- Marketing strategy and growth Skills: https://github.com/coreyhaines31/marketingskills
- Creative and WeChat Skills: https://github.com/JimLiu/baoyu-skills

Upstream license files are included under `licenses/`.

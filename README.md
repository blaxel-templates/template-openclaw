# OpenClaw on Blaxel

Run [OpenClaw](https://docs.openclaw.ai) as a Blaxel agent. This template packages the OpenClaw gateway inside a VM and deploys it on Blaxel's infrastructure, giving you a fully managed OpenClaw instance accessible via a public URL.

OpenClaw's Control UI, WebSocket API, and optional channel integrations (Telegram, Discord, WhatsApp, etc.) all work out of the box.

## Prerequisites

- **[Blaxel CLI](https://docs.blaxel.ai/Get-started)** installed and logged in:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/blaxel-ai/toolkit/main/install.sh | BINDIR=/usr/local/bin sudo -E sh
  bl login YOUR-WORKSPACE
  ```
- An API key from a supported model provider (Anthropic, OpenAI, Google, etc.)

## Quick Start

1. Clone the template:
   ```bash
   bl create-agent --template openclaw my-openclaw
   cd my-openclaw
   ```

2. Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```

3. Deploy:
   ```bash
   bl deploy
   ```

4. Open the Control UI at the URL shown in the deploy output. Enter your gateway token on the Overview page to connect.

## Configuration

All configuration is done through environment variables in `.env`. Copy the example and fill in your values:

```bash
cp .env.example .env
```

Variables defined in `.env` are automatically stored in Blaxel's secret manager on deploy.

### Required

| Variable | Description |
|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Token to authenticate with the gateway. Auto-generated if not set, but you won't know the value — set one explicitly. |
| Provider API key | At least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc. |

### Optional

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_MODEL` | `anthropic/claude-sonnet-4-5` | Primary model in `provider/model` format. |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token from [@BotFather](https://t.me/BotFather). Enables the Telegram channel automatically. |
| `OPENCLAW_ALLOWED_ORIGIN` | Auto-computed from Blaxel env | Override the allowed CORS origin for the Control UI. |

## How It Works

The Dockerfile installs OpenClaw from npm and runs the gateway via an entrypoint script:

- **`tini`** runs as PID 1 for proper signal handling and zombie reaping
- **`entrypoint.sh`** generates the OpenClaw config from environment variables, then runs the gateway in a restart loop
- The gateway listens on `$PORT` (set by Blaxel) with `--bind lan`
- CORS origins for the Control UI are auto-computed from Blaxel's runtime variables (`BL_NAME`, `BL_WORKSPACE_ID`, `BL_REGION`)
- Blaxel's internal proxy IPs are added to `trustedProxies` so the gateway correctly identifies client connections

## Project Structure

```
template-openclaw/
├── Dockerfile          # Node.js Alpine + OpenClaw + tini
├── entrypoint.sh       # Config generation + gateway restart loop
├── blaxel.toml         # Blaxel agent configuration
├── .env.example        # Environment variables template
└── .dockerignore
```

## Channels

OpenClaw supports many channels. To enable one, set the relevant environment variable and redeploy. For example, for Telegram:

Add the token to your `.env`:
```
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
```
Then redeploy:
```bash
bl deploy
```

For other channels (Discord, WhatsApp, Slack, etc.), configure them through the Control UI after connecting, or add them to the `openclaw.json` config in `entrypoint.sh`.

## Troubleshooting

**Can't connect to the Control UI**: Make sure you've set `OPENCLAW_GATEWAY_TOKEN` and entered it on the Overview page. If you didn't set one, check the agent logs for the auto-generated token:
```bash
bl logs agent openclaw-agent
```

**Origin not allowed**: The entrypoint auto-computes allowed origins from Blaxel env vars. If you access the agent from a custom domain, set `OPENCLAW_ALLOWED_ORIGIN` to that URL.

**Gateway keeps restarting**: The restart loop is intentional — it recovers from OpenClaw's self-restart behavior (SIGUSR1). Check the logs for the root cause of the exit.

## Support

- [OpenClaw Documentation](https://docs.openclaw.ai)
- [Blaxel Documentation](https://docs.blaxel.ai)
- [Blaxel Discord](https://discord.gg/G3NqzUPcHP)

## License

This project is licensed under the MIT License.

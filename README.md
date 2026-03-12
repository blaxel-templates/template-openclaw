# OpenClaw on Blaxel

Run [OpenClaw](https://docs.openclaw.ai) as a Blaxel agent. This template packages the OpenClaw gateway inside a VM and deploys it on Blaxel's infrastructure, giving you a fully managed OpenClaw instance accessible via a public URL.

OpenClaw's Control UI, WebSocket API, and optional channel integrations (Telegram, Discord, WhatsApp, etc.) all work out of the box.

## Deploy on Blaxel

### One-Click Deploy

Create an OpenClaw agent directly from the Blaxel console:

[![Deploy on Blaxel](https://raw.githubusercontent.com/blaxel-ai/toolkit/main/assets/deploy-on-blaxel.svg)](https://app.blaxel.ai/global-agentic-network/agents/create?type=openclaw)

### Custom Deploy

If you want to customize the template before deploying, use the Blaxel CLI:

1. Install the [Blaxel CLI](https://docs.blaxel.ai/Get-started) and log in:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/blaxel-ai/toolkit/main/install.sh | BINDIR=/usr/local/bin sudo -E sh
   bl login YOUR-WORKSPACE
   ```

2. Create from template:
   ```bash
   bl new agent --template openclaw my-openclaw
   cd my-openclaw
   ```

3. Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```

4. Make your changes, then deploy:
   ```bash
   bl deploy
   ```

5. Open the Control UI at the URL shown in the deploy output.

### Authentication

When deployed on Blaxel (`BL_CLOUD=true`), the auth proxy shows a login page where users authenticate with their Blaxel account via email (passwordless OTP). Only users who belong to the configured workspace (`BL_WORKSPACE`) can access the instance.

The platform automatically sets `BL_CLOUD=true` and other runtime variables when deployed on Blaxel.

### Environment Variables

Variables in `.env` are automatically stored in Blaxel's secret manager on deploy.

#### Model Configuration

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_MODEL` | `anthropic/claude-sonnet-4-5` | Primary model in `provider/model` format (e.g. `anthropic/claude-opus-4-6`, `openai/gpt-4o`). |
| `ANTHROPIC_API_KEY` | | Anthropic API key. Required if using an Anthropic model. |
| `OPENAI_API_KEY` | | OpenAI API key. Required if using an OpenAI model. |
| `GEMINI_API_KEY` | | Google Gemini API key. Required if using a Gemini model. |

#### Authentication (set automatically by Blaxel)

| Variable | Default | Description |
|---|---|---|
| `BL_CLOUD` | | Set to `true` by the platform. Enables OAuth2 email login instead of basic auth. |
| `BL_WORKSPACE` | | Blaxel workspace name. When set, only users belonging to this workspace can log in. |
| `BL_ENV` | `prod` | Blaxel environment (`prod` or `dev`). Determines which API endpoints are used for authentication. |

#### Blaxel Sandbox (optional)

| Variable | Description |
|---|---|
| `BL_API_KEY` | Blaxel API key for the sandbox plugin. Enables code execution in isolated sandboxes. |

#### Advanced

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_ALLOWED_ORIGIN` | Auto-computed | Override the allowed CORS origin for the Control UI. |
| `COOKIE_SECRET` | Auto-generated | Secret used to sign session cookies. Auto-generated if not set. |

### How It Works

The Dockerfile installs OpenClaw and bundles the Blaxel sandbox plugin. At startup:

1. **`entrypoint.sh`** generates the OpenClaw config from environment variables
2. **`auth-proxy.js`** starts as a reverse proxy on the public port, handling authentication and forwarding requests to the OpenClaw gateway
3. The OpenClaw gateway runs on an internal port with `trusted-proxy` auth mode, relying on the `X-Forwarded-User` header from the auth proxy
4. CORS origins are auto-computed from Blaxel's runtime variables (`BL_NAME`, `BL_WORKSPACE_ID`, `BL_REGION`)
5. If the gateway crashes, the entrypoint automatically restarts it

### Project Structure

```
template-openclaw/
├── Dockerfile          # Node.js Alpine + OpenClaw + tini
├── entrypoint.sh       # Config generation + gateway restart loop
├── auth-proxy.js       # Authentication proxy (email login / basic auth)
├── setup-server.js     # First-run setup wizard (self-hosted mode)
├── blaxel.toml         # Blaxel agent configuration
├── .env.example        # Environment variables template
└── openclaw-blaxel/    # Blaxel sandbox plugin
```

---

## Self-Hosted Deployment

You can also run this template outside of Blaxel using Docker.

### Quick Start

1. Copy `.env.example` to `.env` and configure your model and credentials:
   ```bash
   cp .env.example .env
   ```

2. Build and run:
   ```bash
   make run
   ```

3. Open http://localhost:8888 in your browser. On first run, a setup wizard will guide you through configuration.

### Authentication

When not deployed on Blaxel (no `BL_CLOUD=true`), the auth proxy uses HTTP basic auth. Credentials can be set via environment variables or through the setup wizard on first run.

### Environment Variables

#### Required

| Variable | Description |
|---|---|
| `OPENCLAW_MODEL` | Primary model in `provider/model` format. If not set, the setup wizard will ask. |
| Provider API key | At least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`. |

#### Authentication

| Variable | Description |
|---|---|
| `PROXY_USER` | Username for basic auth. If not set, the setup wizard will ask. |
| `PROXY_PASSWORD` | Password for basic auth. If not set, the setup wizard will ask. |

#### Blaxel Sandbox (optional)

If you want to enable the Blaxel sandbox plugin for code execution:

| Variable | Description |
|---|---|
| `BL_WORKSPACE` | Your Blaxel workspace name. |
| `BL_API_KEY` | Your Blaxel API key (generate one at https://app.blaxel.ai). |

### Makefile Targets

| Target | Description |
|---|---|
| `make build` | Build the Docker image. |
| `make run` | Build and start the container (port 8888). |
| `make stop` | Stop the container. |
| `make restart` | Restart the container. |
| `make logs` | Tail container logs. |
| `make clean` | Stop and remove container + volume. |

---

## Troubleshooting

**Can't access the UI**: Check that the auth proxy started correctly:
```bash
make logs
# Look for: [auth-proxy] Listening on port 80
```

**Origin not allowed**: The entrypoint auto-computes allowed origins from Blaxel env vars. If you access the agent from a custom domain, set `OPENCLAW_ALLOWED_ORIGIN` to that URL. For local development, the host-header fallback is enabled automatically.

**Gateway keeps restarting**: The restart loop is intentional -- it recovers from OpenClaw's self-restart behavior. Check the logs for the root cause of the exit.

**Email login not working**: Ensure `OAUTH_BASE_URL` and `OAUTH_INTERNAL_URL` are correctly set if running against a non-default Blaxel API. In production on Blaxel, these are not needed (auto-detected from `BL_ENV`).

## Support

- [OpenClaw Documentation](https://docs.openclaw.ai)
- [Blaxel Documentation](https://docs.blaxel.ai)
- [Blaxel Discord](https://discord.gg/G3NqzUPcHP)

## License

This project is licensed under the MIT License.

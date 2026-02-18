#!/bin/bash
set -e

export PATH="$(npm prefix -g)/bin:$PATH"

PORT="${PORT:-80}"
HOST="${HOST:-0.0.0.0}"
export OPENCLAW_HOME="${OPENCLAW_HOME:-/root}"
OPENCLAW_DIR="$OPENCLAW_HOME/.openclaw"

mkdir -p "$OPENCLAW_DIR" "$OPENCLAW_DIR/workspace"

if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  OPENCLAW_GATEWAY_TOKEN="blaxel-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
export OPENCLAW_GATEWAY_TOKEN

MODEL="${OPENCLAW_MODEL:-anthropic/claude-sonnet-4-5}"

if [ -z "$OPENCLAW_ALLOWED_ORIGIN" ] && [ -n "$BL_NAME" ] && [ -n "$BL_WORKSPACE_ID" ]; then
  if [ "$BL_ENV" = "dev" ]; then
    RUN_URL="runv2.blaxel.dev"
  else
    RUN_URL="bl.run"
  fi
  WS_ID=$(echo "$BL_WORKSPACE_ID" | tr '[:upper:]' '[:lower:]')
  ORIGIN_BASE="agt-${BL_NAME}-${WS_ID}"
  ORIGIN_GLOBAL="https://${ORIGIN_BASE}.${RUN_URL}"
  if [ -n "$BL_REGION" ]; then
    ORIGIN_REGIONAL="https://${ORIGIN_BASE}.${BL_REGION}.${RUN_URL}"
  fi
fi

ORIGINS="[]"
if [ -n "$OPENCLAW_ALLOWED_ORIGIN" ]; then
  ORIGINS="[\"$OPENCLAW_ALLOWED_ORIGIN\"]"
elif [ -n "$ORIGIN_GLOBAL" ]; then
  if [ -n "$ORIGIN_REGIONAL" ]; then
    ORIGINS="[\"$ORIGIN_GLOBAL\", \"$ORIGIN_REGIONAL\"]"
  else
    ORIGINS="[\"$ORIGIN_GLOBAL\"]"
  fi
fi

TELEGRAM_BLOCK=""
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  TELEGRAM_BLOCK="\"channels\": { \"telegram\": { \"enabled\": true, \"botToken\": \"$TELEGRAM_BOT_TOKEN\", \"dmPolicy\": \"open\", \"allowFrom\": [\"*\"] } },"
fi

cat > "$OPENCLAW_DIR/openclaw.json" << EOF
{
  $TELEGRAM_BLOCK
  "gateway": {
    "mode": "local",
    "reload": { "mode": "hot" },
    "auth": {
      "mode": "token"
    },
    "trustedProxies": ["172.16.0.0/12", "10.0.0.0/8"],
    "controlUi": {
      "allowedOrigins": $ORIGINS,
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  },
  "plugins": {
    "load": {
      "paths": ["$(npm root -g)/@blaxel/openclaw-skill"]
    }
  },
  "agents": {
    "defaults": {
      "workspace": "$OPENCLAW_DIR/workspace",
      "model": {
        "primary": "$MODEL"
      }
    }
  }
}
EOF

echo "============================================"
echo "OpenClaw Gateway starting on $HOST:$PORT"
echo "Model: $MODEL"
echo "Gateway Token: $OPENCLAW_GATEWAY_TOKEN"
echo "Allowed Origins: $ORIGINS"
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  echo "Telegram: enabled"
fi
echo "============================================"

while true; do
  pkill -f "openclaw gateway" 2>/dev/null || true
  sleep 1

  openclaw gateway \
    --port "$PORT" \
    --bind lan \
    --token "$OPENCLAW_GATEWAY_TOKEN" \
    --force \
    --allow-unconfigured \
    --verbose || true

  echo "OpenClaw exited with code $?, restarting..."
done

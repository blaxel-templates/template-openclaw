#!/bin/bash
set -e

export PATH="$(npm prefix -g)/bin:$PATH"

PORT="${PORT:-80}"
HOST="${HOST:-0.0.0.0}"
export OPENCLAW_HOME="${OPENCLAW_HOME:-/root}"
OPENCLAW_DIR="$OPENCLAW_HOME/.openclaw"
OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"

mkdir -p "$OPENCLAW_DIR" "$OPENCLAW_DIR/workspace"

if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  OPENCLAW_GATEWAY_TOKEN="blaxel-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
export OPENCLAW_GATEWAY_TOKEN

MODEL="${OPENCLAW_MODEL:-anthropic/claude-sonnet-4-5}"
AUTH_MODE="${OPENCLAW_AUTH_MODE:-token}"

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

if [ ! -f "$OPENCLAW_CONFIG" ]; then
  echo '{}' > "$OPENCLAW_CONFIG"
fi

cp "$OPENCLAW_CONFIG" "$OPENCLAW_CONFIG.bak" 2>/dev/null || true

TMP_CONFIG="$(mktemp)"

jq \
  --arg workspace "$OPENCLAW_DIR/workspace" \
  --arg model "$MODEL" \
  --argjson origins "$ORIGINS" \
  '
  .gateway = {
    mode: "local",
    reload: { mode: "hot" },
    auth: { mode: "token" },
    trustedProxies: ["172.16.0.0/12", "10.0.0.0/8"],
    controlUi: {
      allowedOrigins: $origins,
      allowInsecureAuth: true,
      dangerouslyDisableDeviceAuth: true
    }
  }
  | .agents = (.agents // {})
  | .agents.defaults = (.agents.defaults // {})
  | .agents.defaults.workspace = $workspace
  | .agents.defaults.model = (.agents.defaults.model // {})
  | .agents.defaults.model.primary = $model
  ' \
  "$OPENCLAW_CONFIG" > "$TMP_CONFIG"

mv "$TMP_CONFIG" "$OPENCLAW_CONFIG"

echo "============================================"
echo "OpenClaw Gateway starting on $HOST:$PORT"
echo "Model: $MODEL"
echo "Gateway Token: $OPENCLAW_GATEWAY_TOKEN"
echo "Allowed Origins: $ORIGINS"
echo "============================================"

MAX_RETRIES="${MAX_RETRIES:-5}"
RETRY_COUNT=0

while true; do
  pkill -9 -f "openclaw gateway" 2>/dev/null || true
  sleep 1

  rm -f "$OPENCLAW_DIR"/*.lock "$OPENCLAW_DIR"/*.pid 2>/dev/null || true
  rm -f /tmp/openclaw/*.lock /tmp/openclaw/*.pid 2>/dev/null || true

  fuser -k "$PORT/tcp" 2>/dev/null || true
  sleep 0.5

  openclaw gateway \
    --port "$PORT" \
    --bind lan \
    --token "$OPENCLAW_GATEWAY_TOKEN" \
    --force \
    --allow-unconfigured \
    --verbose
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    RETRY_COUNT=0
  else
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "OpenClaw exited with code $EXIT_CODE (failure $RETRY_COUNT/$MAX_RETRIES)"
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
      echo "Max retries reached, giving up."
      exit 1
    fi
  fi

  echo "Restarting..."
done

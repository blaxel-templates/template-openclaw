FROM node:22-alpine

RUN apk add --no-cache bash curl jq git tini \
    make cmake g++ build-base linux-headers python3

RUN npm install -g openclaw@2026.3.12

ENV HOME=/root
ENV OPENCLAW_HOME=/root

COPY openclaw-blaxel /opt/openclaw-blaxel
RUN cd /opt/openclaw-blaxel && npm install
RUN cd /opt/openclaw-blaxel && npx tsc
# Point plugin entry at compiled JS so OpenClaw skips its TS loader
# (the TS loader can wrap the module in a Promise, causing
# "async registration is ignored" and silently dropping all tools)
RUN cd /opt/openclaw-blaxel && \
    node -e "const p=require('./package.json'); p.openclaw.extensions=['./dist/index.js']; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
RUN cd /opt/openclaw-blaxel && npm prune --omit=dev
RUN openclaw plugins install /opt/openclaw-blaxel
RUN openclaw plugins enable openclaw-blaxel-sandbox

# Snapshot only plugin files so we can restore them instantly at runtime
RUN mkdir -p /opt/openclaw-snapshot && \
    cp -a /root/.openclaw/extensions /opt/openclaw-snapshot/ && \
    [ -f /root/.openclaw/plugins.json ] && cp -a /root/.openclaw/plugins.json /opt/openclaw-snapshot/ || true

COPY auth-proxy.js /auth-proxy.js
COPY setup-server.js /setup-server.js
COPY blaxel-logo.png /assets/blaxel-logo.png
COPY icon-dark.png /assets/openclaw-logo.png
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["tini", "--", "/entrypoint.sh"]

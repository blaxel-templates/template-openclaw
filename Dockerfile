FROM node:22-alpine

RUN apk add --no-cache bash curl jq git tini \
    make cmake g++ build-base linux-headers python3

RUN npm install -g openclaw@2026.3.12

ENV HOME=/root
ENV OPENCLAW_HOME=/root

COPY openclaw-blaxel /opt/openclaw-blaxel
RUN cd /opt/openclaw-blaxel && npm install --omit=dev
RUN openclaw plugins install /opt/openclaw-blaxel
RUN openclaw plugins enable blaxel-sandbox

COPY auth-proxy.js /auth-proxy.js
COPY setup-server.js /setup-server.js
COPY blaxel-logo.png /assets/blaxel-logo.png
COPY icon-dark.png /assets/openclaw-logo.png
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["tini", "--", "/entrypoint.sh"]

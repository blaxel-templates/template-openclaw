FROM node:22-alpine

RUN apk add --no-cache bash curl jq git tini \
    make cmake g++ build-base linux-headers python3

RUN npm install -g openclaw@latest

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV HOME=/root
ENV OPENCLAW_HOME=/root

ENTRYPOINT ["tini", "--", "/entrypoint.sh"]

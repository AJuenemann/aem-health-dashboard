FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4400 \
    DATA_DIR=/data

# Abhängigkeiten zuerst (Layer-Cache). tsx führt die TypeScript-Quellen direkt aus.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY config ./config
COPY src ./src
COPY public ./public

# Verlauf liegt im Volume /data. Der Dienst läuft ohne Root-Rechte.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4400

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4400/healthz || exit 1

CMD ["node", "--import", "tsx", "src/server.ts"]

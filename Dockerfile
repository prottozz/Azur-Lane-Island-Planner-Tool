# Build once on the runner's native platform: the output (static files + bundled JS) is CPU-independent,
# so npm never runs under QEMU emulation (arm64 npm ci crashed there).
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# data/gamedata.json (when committed) becomes the first-run seed; a missing file is skipped silently.
COPY data/ /app/seed/
ENV HOST=0.0.0.0 \
    PORT=4747 \
    DATA_DIR=/data \
    SEED_GAMEDATA=/app/seed/gamedata.json \
    NODE_ENV=production
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 4747
USER node
HEALTHCHECK CMD wget -qO- http://127.0.0.1:4747/api/health || exit 1
CMD ["node", "dist-server/index.mjs"]

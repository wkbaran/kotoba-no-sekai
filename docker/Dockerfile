# Build context is the repo root: docker build -f docker/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain for better-sqlite3 in case no prebuilt binary matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json config.yaml sources.yaml ./
# Digests, audio, JSON, and the dedup DB all live here; mount it to persist.
RUN mkdir -p output && chown node:node output
USER node
VOLUME ["/app/output"]
ENTRYPOINT ["node", "dist/index.js"]

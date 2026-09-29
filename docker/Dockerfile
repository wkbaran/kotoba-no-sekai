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
ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.49
# tzdata so the cron schedule follows TZ. supercronic is the scheduler for
# docker/crontab; curl only fetches it, then goes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
 && case "$TARGETARCH" in \
      amd64) sha1=e63c11a9726b775a6a11801e81af4f3fb926aa68 ;; \
      arm64) sha1=0b6c5bb743e0b0dafed1132198c81807927ac413 ;; \
      *) echo "no supercronic checksum for $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH}" \
 && echo "${sha1}  /usr/local/bin/supercronic" | sha1sum -c - \
 && chmod +x /usr/local/bin/supercronic \
 && apt-get purge -y --auto-remove curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json config.yaml sources.yaml ./
COPY docker/crontab docker/run-and-publish.sh ./docker/
# A Windows checkout can hand these over with CRLF endings, which Linux reads as
# "bad interpreter"; strip them so the build is immune.
RUN sed -i 's/\r$//' docker/crontab docker/run-and-publish.sh && chmod +x docker/run-and-publish.sh
# Digests, audio, JSON, and the dedup DB all live here; mount it to persist.
RUN mkdir -p output && chown node:node output
USER node
VOLUME ["/app/output"]
ENTRYPOINT ["node", "dist/index.js"]

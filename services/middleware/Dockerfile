# Build context is the pnpm workspace root (services/middleware/docker-compose.yml
# sets `context: ../..`), because @codestra/middleware depends on sibling
# workspace packages (@codestra/contracts, @codestra/connector-kit,
# @codestra/webhook-sdk) that must be built first.
#
#   docker build -f services/middleware/Dockerfile -t codestra-middleware .

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/connector-kit/package.json packages/connector-kit/package.json
COPY packages/webhook-sdk/package.json packages/webhook-sdk/package.json
COPY services/middleware/package.json services/middleware/package.json
RUN pnpm install --frozen-lockfile --filter @codestra/middleware...

FROM deps AS build
COPY packages/contracts packages/contracts
COPY packages/connector-kit packages/connector-kit
COPY packages/webhook-sdk packages/webhook-sdk
COPY services/middleware services/middleware
COPY tsconfig.base.json tsconfig.base.json
RUN pnpm --filter @codestra/contracts build \
 && pnpm --filter @codestra/connector-kit build \
 && pnpm --filter @codestra/webhook-sdk build \
 && pnpm --filter @codestra/middleware run prisma:generate \
 && pnpm --filter @codestra/middleware build

FROM base AS runtime
ENV NODE_ENV=production
# wget is used for HEALTHCHECK instead of spawning `node -e ...`: booting a
# fresh V8 isolate on every check creates its own GC/compiler worker
# threads via clone3(), which some hosts' seccomp profiles (older
# Docker/runc, or a hardened default profile) reject outright -- the
# container's own long-running process is unaffected since it only starts
# once, but every subsequent healthcheck tick fails. wget is a single
# lightweight, single-threaded binary with no such requirement.
RUN apt-get update && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 codestra && useradd --uid 10001 --gid codestra --shell /usr/sbin/nologin --no-create-home codestra
COPY --from=build /workspace/pnpm-workspace.yaml /workspace/pnpm-lock.yaml /workspace/package.json ./
COPY --from=build /workspace/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist packages/contracts/dist
COPY --from=build /workspace/packages/connector-kit/package.json packages/connector-kit/package.json
COPY --from=build /workspace/packages/connector-kit/dist packages/connector-kit/dist
COPY --from=build /workspace/packages/webhook-sdk/package.json packages/webhook-sdk/package.json
COPY --from=build /workspace/packages/webhook-sdk/dist packages/webhook-sdk/dist
COPY --from=build /workspace/services/middleware/package.json services/middleware/package.json
COPY --from=build /workspace/services/middleware/dist services/middleware/dist
COPY --from=build /workspace/services/middleware/prisma services/middleware/prisma
COPY --from=build /workspace/services/middleware/prisma.config.ts services/middleware/prisma.config.ts
COPY --from=build /workspace/services/middleware/node_modules services/middleware/node_modules
COPY --from=build /workspace/node_modules node_modules
WORKDIR /workspace/services/middleware
USER codestra
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=15s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health/ready || exit 1
CMD ["node", "dist/index.js"]

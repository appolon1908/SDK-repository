# Build context is the pnpm workspace root (see root docker-compose.yml,
# which sets `context: .` for this service), because
# @codestra/developer-portal depends on sibling workspace packages
# (@codestra/apps-shared, @codestra/contracts, @codestra/social-sdk) and its
# build step regenerates public/api-reference.html from the canonical
# public OpenAPI contract at contracts/openapi/codestra-public.openapi.yaml.
#
#   docker build -f apps/developer-portal/Dockerfile -t codestra-developer-portal .

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/_shared/package.json apps/_shared/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/connector-kit/package.json packages/connector-kit/package.json
COPY packages/social-sdk/package.json packages/social-sdk/package.json
COPY apps/developer-portal/package.json apps/developer-portal/package.json
RUN pnpm install --frozen-lockfile --filter @codestra/developer-portal...

FROM deps AS build
COPY apps/_shared apps/_shared
COPY packages/contracts packages/contracts
COPY packages/connector-kit packages/connector-kit
COPY packages/social-sdk packages/social-sdk
COPY apps/developer-portal apps/developer-portal
COPY contracts/openapi contracts/openapi
COPY tsconfig.base.json tsconfig.base.json
RUN pnpm --filter @codestra/contracts build \
 && pnpm --filter @codestra/connector-kit build \
 && pnpm --filter @codestra/social-sdk build \
 && pnpm --filter @codestra/apps-shared build \
 && pnpm --filter @codestra/developer-portal build

FROM base AS runtime
ENV NODE_ENV=production
# wget is used for HEALTHCHECK instead of spawning `node -e ...`: booting a
# fresh V8 isolate on every check creates its own GC/compiler worker threads
# via clone3(), which some hosts' seccomp profiles (older Docker/runc, or a
# hardened default profile) reject outright. wget is a single lightweight,
# single-threaded binary with no such requirement.
RUN apt-get update && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 codestra && useradd --uid 10001 --gid codestra --shell /usr/sbin/nologin --no-create-home codestra
# next.config.mjs sets `output: "standalone"`, so the standalone server
# bundles only the production node_modules its own require graph actually
# reaches -- no full workspace node_modules copy needed at runtime.
COPY --from=build /workspace/apps/developer-portal/.next/standalone ./
COPY --from=build /workspace/apps/developer-portal/.next/static apps/developer-portal/.next/static
# public/api-reference.html is generated at build time (not part of the
# standalone trace) and must be served as a real static asset.
COPY --from=build /workspace/apps/developer-portal/public apps/developer-portal/public
WORKDIR /workspace/apps/developer-portal
USER codestra
EXPOSE 3002
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=15s \
  CMD wget --quiet --tries=1 --spider http://localhost:3002/ || exit 1
CMD ["node", "server.js"]

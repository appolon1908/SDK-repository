# Container Images

## Services

| Service | Dockerfile | Port | Build context |
|---|---|---:|---|
| `services/middleware` | `services/middleware/Dockerfile` | 3000 | repo root |
| `apps/admin-console` | `apps/admin-console/Dockerfile` | 3003 | repo root |
| `apps/developer-portal` | `apps/developer-portal/Dockerfile` | 3002 | repo root |
| `apps/ops-dashboard` | `apps/ops-dashboard/Dockerfile` | 3001 | repo root |
| `services/camel-protocol-gateway` | `services/camel-protocol-gateway/Dockerfile` | 8080 | `services/camel-protocol-gateway` |

Every image runs as a non-root user (uid/gid `10001`), and every Node-based
image is a multi-stage build that ships no build toolchain or dev
dependencies in its runtime layer. The three Next.js apps build with
`output: "standalone"` (each app's `next.config.mjs` also sets
`outputFileTracingRoot` to the workspace root, required for a pnpm monorepo
so the standalone trace resolves sibling workspace packages correctly) --
the runtime image ships only the traced `node_modules` subset the compiled
server actually requires, not the full workspace install.

`camel-protocol-gateway` is a deliberate exception to "build from a floating
base tag": its `Dockerfile` takes `MAVEN_IMAGE`/`RUNTIME_IMAGE` as required
build args and its own `compose.yaml` only consumes an already-published,
sha256-digest-pinned image (`CODESTRA_CAMEL_GATEWAY_IMAGE`) -- see that
directory's own files for the immutable-reference rationale. Nothing in
this repository fabricates a digest for it.

## Local / staging: docker compose

The root [`docker-compose.yml`](../../docker-compose.yml) unifies every
service via Compose's `include:` (Compose spec v2.20+), rather than
duplicating each service's own hardened compose file:

```bash
docker compose up                              # middleware + postgres + the 3 apps
docker compose --profile optional-camel up     # also start camel-protocol-gateway
```

The camel gateway profile requires `CODESTRA_CAMEL_GATEWAY_IMAGE` to already
be set to a real, digest-pinned image reference (see
`services/camel-protocol-gateway/compose.yaml`); without it, `up` still
works for every other service.

The three dashboard apps currently render from synthetic fixtures (see
`apps/_shared`'s package description) rather than calling middleware live,
so they are not wired with `depends_on: middleware` in compose -- that
runtime dependency does not exist in the application code yet. They run on
compose's default network, same as middleware; only camel-protocol-gateway
keeps its own external, more restricted network.

## CI: building and publishing images

[`.github/workflows/docker-publish.yml`](../../.github/workflows/docker-publish.yml)
builds and pushes middleware and the three apps to GHCR
(`ghcr.io/<owner>/codestra-<service>`) on every push to `main` or
`production`, tagged by branch name, full commit SHA, and (on `production`
only) `latest`.

camel-protocol-gateway is excluded from that default matrix for the same
reason its compose file won't build from source alone: publishing it
requires two real, immutable image references. Its build job is gated on
the repository variables `CAMEL_GATEWAY_MAVEN_IMAGE` and
`CAMEL_GATEWAY_RUNTIME_IMAGE` (Settings -> Secrets and variables -> Actions
-> Variables) and skips cleanly, rather than failing the workflow, until
both are set.

## What this does not cover

Per this repository's own [Authority boundary](../../README.md#production-configuration),
these images are build artifacts, not a deployment. Runtime configuration
(OIDC, SMTP, DNS, Kong, provider credentials, the deployed Middleware
instance these images would actually talk to) remains outside this
repository's ownership; see
[docs/PRODUCTION_CONFIGURATION_CHECKLIST.md](../PRODUCTION_CONFIGURATION_CHECKLIST.md).

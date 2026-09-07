# Codestra SDK Repository

Codestra's contract-first developer platform for reusable SDKs, webhook tooling, connector interfaces, automation nodes, provider adapters, compatibility gates, generated clients, and optional delivery/protocol gateways.

## Connector ownership boundary

This repository is the **developer-facing SDK and connector distribution authority**. It owns reusable packages such as contracts, generated clients, webhook helpers, `@codestra/connector-kit`, n8n node packages, provider adapter libraries intended for distribution, and compatibility/contract-drift gates.

`appolon1908-hue/Middleware-` separately owns the **privileged connector runtime and enforcement boundary** under its internal connector framework/runtime. Middleware owns authenticated command execution, tenant/actor authorization, idempotency, durable inbox/outbox state, provider credential access, read-back, reconciliation, kill switches and production connector activation.

The two repositories are intentionally complementary rather than competing:

```text
SDK-repository
  -> public/reusable contracts and connector-kit APIs
  -> generated clients and integration developer tooling

Middleware-
  -> trusted connector registry/runtime
  -> privileged provider execution and durable state
  -> production capability activation
```

A reusable SDK must never become an alternate cross-system write path. Provider-specific runtime authority remains in the owning product/adapter repository and is invoked through Middleware.

## Release branches

Implementation is delivered as a stacked, dependency-ordered branch series:

1. `feat/01-contracts`
2. `feat/02-social-sdk`
3. `feat/03-webhook-sdk`
4. `feat/04-connector-kit`
5. `feat/05-n8n-nodes`
6. `feat/06-provider-adapters`
7. `feat/07-pact-contract-gates`
8. `feat/08-python-php-generation`
9. `optional/09-svix-delivery`
10. `optional/10-camel-protocol-gateway`

Each branch is based on the preceding branch so reviews remain small and the release dependency order is explicit.

## Authority boundary

SDKs and connectors never bypass Codestra Middleware. Middleware remains the only cross-system write authority and owns authorization, tenant isolation, idempotency, inbox/outbox processing, retries, reconciliation, audit, and privileged credentials.

Optional runtime integrations are disabled by default and must not activate external delivery or production mutations merely by installing this repository.

## Current enablement state

The reusable SDK layer is enabled for application integration. Enabling the SDK is intentionally separate from enabling a live provider effect.

| Surface | State | Boundary |
| --- | --- | --- |
| Unified TypeScript SDK | Enabled | Caller supplies HTTPS API base URL, short-lived token, tenant, correlation, and idempotency context |
| Landing-page/form/chat/voice intake client | Enabled | Browser sends only to a same-origin BFF; no service credential is shipped to the browser |
| Intake BFF | Enabled when configured | Requires the `sdk-intake` client secret and an explicit server-side tenant allowlist |
| MoneyBee Middleware operation readback | Enabled when client is explicitly constructed | Secure URL and token provider are required; `enabled=false` remains the global kill switch |
| MoneyBee/connector mutations | Disabled by default | `allowed_capabilities` is empty until each capability is explicitly approved |
| Provider adapters | Disabled by default | Middleware capability, identity, tenant, staging, reconciliation, and activation gates must pass |
| Optional Svix delivery | Disabled by default | Separate deployment and activation approval required |
| Optional Camel protocol gateway | Disabled by default | Immutable image and explicit protocol allowlist required |
| Email, SMS, social, callback, Odoo, and PSTN effects | Disabled by default | Owning runtime must provide exact capability readback and production approval |

This means websites can install and wire the SDK now without turning the SDK repository into a privileged execution path. Runtime capability activation still occurs only in the owning Middleware/provider environment.

## Unified SDK surface

Product teams should import one stable SDK facade from [packages/codestra_sdk](packages/codestra_sdk). Domain-specific packages such as `@codestra/communications-sdk` and `@codestra/social-sdk` remain reusable implementation packages, but application code should depend on the facade when it needs the complete Codestra platform surface:

```text
codestra_sdk
  marketing
  ai
  communication
  social
  automation
  events
  common
```

```ts
codestra.marketing.campaigns.list();
codestra.ai.generate({ task: "summarize", input: "Summarize this lead." }, { idempotencyKey });
codestra.communication.messages.send(message, { idempotencyKey });
codestra.social.posts.schedule(post, { idempotencyKey });
```

CRM has no direct read/write edge on this facade. Lead submission goes through [packages/intake-bff](packages/intake-bff) to `POST /v1/intake/leads`; CRM record mutation goes through the canonical Middleware command plane (`codestra.control.crm`).

Workflow triggering has no dedicated route either: `codestra.automation.commands.trigger({ workflowKey, payload }, { idempotencyKey })` submits through the same canonical command plane (`POST /v1/commands`), read back with `codestra.operations.get(commandId)`.

The facade is the programming contract product developers see. Backend implementations can move between Middleware, product services, or provider adapters without forcing product teams to hand-roll HTTP calls or chase service topology changes.

## Production configuration

Password reset, SMTP, OIDC clients, provider credentials, DNS, Kong, and deployed Middleware settings are intentionally outside this SDK repository. Use [docs/PRODUCTION_CONFIGURATION_CHECKLIST.md](docs/PRODUCTION_CONFIGURATION_CHECKLIST.md) to verify those owners and gates before any production activation.

## Container images

Every deployable service (`services/middleware`, the three `apps/*` dashboards, `services/camel-protocol-gateway`) has a production Dockerfile, and the root [`docker-compose.yml`](docker-compose.yml) unifies them into one local/staging stack (`docker compose up`). CI publishes images to GHCR on every push to `main`/`production`. See [docs/production/DOCKER-DEPLOYMENT.md](docs/production/DOCKER-DEPLOYMENT.md) for the full picture, including why `camel-protocol-gateway` is a deliberate exception.

## Communications API v1

Communications API v1 is tracked as a canonical SDK surface in [contracts/openapi/codestra-communications.openapi.yaml](contracts/openapi/codestra-communications.openapi.yaml), [contracts/asyncapi/codestra-events.asyncapi.yaml](contracts/asyncapi/codestra-events.asyncapi.yaml), and [packages/communications-sdk](packages/communications-sdk). The production-readiness gate is documented in [docs/COMMUNICATIONS_PRODUCTION_READINESS.md](docs/COMMUNICATIONS_PRODUCTION_READINESS.md) and enforced by:

```bash
pnpm communications:ready
```

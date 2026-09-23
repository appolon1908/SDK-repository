# Repository memory

This file records the stable working context for maintainers and automated coding agents. Read it before changing contracts, SDKs, connectors, workflows, or optional gateway services.

## Repository purpose

`SDK-repository` is a contract-first SDK and connector monorepo. It is **not** the Codestra Middleware API server and it does not contain the product-local Postiz, Odoo, Klyrow, Telnexa, or VICIdial gateway implementations.

The authority path is:

```text
Application -> Codestra SDK -> Kong -> Codestra Middleware -> provider adapter -> product-local restricted gateway
```

Codestra Middleware remains the only cross-system write authority. This repository must not introduce a direct frontend, n8n, SDK, Svix, Camel, or provider-to-provider write path.

## Audited baseline

The full stacked implementation audited on 2026-08-28 UTC is:

```text
branch: optional/10-camel-protocol-gateway
commit: 91a2ae5a2dbd8ac8c8b432c47fbdd1abde34e3a4
```

The API audit is maintained in [`docs/API_AUDIT_REPORT.md`](docs/API_AUDIT_REPORT.md).

## Canonical API and event contracts

- Public OpenAPI: `contracts/openapi/codestra-public.openapi.yaml`
- Enterprise connector OpenAPI: `contracts/openapi/codestra-enterprise.openapi.yaml`
- AsyncAPI catalogue: `contracts/asyncapi/codestra-events.asyncapi.yaml`
- Shared event and error schemas: `contracts/schemas/**`
- Handwritten TypeScript contract types: `packages/contracts/src/index.ts`

Contract source files are authoritative only after semantic OpenAPI, AsyncAPI, and JSON Schema validation passes. File-presence or YAML-prefix checks are not sufficient evidence that a contract is valid.

## Implementation entry points

- Public TypeScript API client: `packages/social-sdk/src/client.ts`
- Webhook signing and verification: `packages/webhook-sdk/src/index.ts`
- Connector execution boundary: `packages/connector-kit/src/index.ts`
- Restricted gateway transport: `packages/provider-adapters/src/base.ts`
- Product adapter manifests: `packages/provider-adapters/src/{postiz,odoo,klyrow,telnexa,vicidial}.ts`
- n8n public API actions: `integrations/n8n-nodes/src/nodes/Codestra/Codestra.node.ts`
- n8n internal event trigger: `integrations/n8n-nodes/src/nodes/CodestraInternalTrigger/CodestraInternalTrigger.node.ts`
- Optional Svix handoff: `packages/svix-delivery/src/index.ts`
- Optional Camel gateway: `services/camel-protocol-gateway/src/main/java/co/codestra/gateway/**`

The actual Middleware HTTP handlers and provider-local restricted gateways live outside this repository and require separate audits.

## Test entry points

Workspace commands:

```bash
pnpm contracts:validate
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @codestra/social-sdk test:pact
pnpm pacts:validate
```

Current focused tests:

- `packages/contracts/test/contracts.test.ts`
- `packages/social-sdk/test/client.test.ts`
- `packages/social-sdk/test/pact/social-post.pact.test.ts`
- `packages/webhook-sdk/test/webhook.test.ts`
- `packages/connector-kit/test/runner.test.ts`
- `packages/provider-adapters/test/adapters.test.ts`
- `packages/svix-delivery/test/delivery.test.ts`

Workflow entry points:

- `.github/workflows/ci.yml`
- `.github/workflows/contracts.yml`
- `.github/workflows/compatibility.yml`
- `.github/workflows/sdk-generation.yml`
- `.github/workflows/camel-gateway.yml`

There is no shared `vitest.config.*` at the audited baseline. Do not interpret `--passWithNoTests` as meaningful behavioral coverage.

## Change protocol

“Fix all” is not a safe unit of work. Work in dependency-ordered slices:

1. Record the defect, affected boundary, failure mode, and acceptance tests.
2. Change one security or correctness concern per branch whenever practical.
3. Add a regression test that fails before the fix.
4. Validate the exact head SHA with deterministic dependencies.
5. Update contracts, handwritten types, SDKs, Pact files, generated clients, and documentation together when the public behavior changes.
6. Keep optional delivery and protocol integrations disabled unless a separately reviewed activation change explicitly enables them.

## Non-negotiable safety rules

- Never commit credentials, tenant mappings, production host addresses, or private keys.
- Never let n8n or an SDK bypass Middleware for a mutation.
- Never release an idempotency claim after an external mutation has an unknown outcome; reconcile or retain an indeterminate state instead.
- Bind idempotency to tenant, operation, and a canonical request fingerprint.
- Verify webhook signatures over the exact raw body before parsing, then enforce timestamp and replay protection in durable tenant-scoped storage.
- Keep outbound API credentials separate from inbound trigger credentials.
- Treat webhook destination URLs as SSRF-sensitive and validate resolution, redirects, and private/reserved address ranges at delivery time.
- Do not describe a branch as production-ready solely because compilation or a small unit-test suite is green.

<!-- CODESTRA_AGENT_PROTOCOL_V1 -->
## Codestra continuation contract

Canonical protocol:
https://github.com/ingtrader21-spec/codestra/blob/main/docs/AGENT-CONTINUATION-PROTOCOL.md

Quick start:
https://github.com/ingtrader21-spec/codestra/blob/main/docs/AGENT-QUICKSTART.md

Before changing code:
1. Read `.codestra-mission/*` when present.
2. Read the active Linear issue and linked Notion architecture.
3. Inspect exact Git branch/HEAD/dirty/worktree/upstream/PR/CI state.
4. Preserve all existing local work.
5. If acting as Builder, verify exclusive issue ownership and use a dedicated worktree.
6. Do not invent or self-assign the next task.
7. Update GitHub + Linear + Notion + the mission checkpoint before handoff.
8. Do not cross the live-production approval boundary.

The canonical protocol's no-loss, one-writer, protected-merge, checkpoint, and production-boundary rules are mandatory.

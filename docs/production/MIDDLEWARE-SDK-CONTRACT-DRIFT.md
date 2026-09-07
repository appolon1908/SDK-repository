# Middleware–SDK Contract Drift

## Authority

- Runtime repository: `appolon1908-hue/Middleware-`
- Protected source SHA: `9cd3fd3e46fb0366fbff69aeef251a1b85beff1d`
- Source contract: `contracts/platform/middleware-openapi.generated.json`
- Vendored evidence: `contracts/middleware-runtime-current.openapi.json`
- OpenAPI: 3.1.0
- Registered runtime paths: 132
- Registered runtime operations: 133

The vendored document is an evidence snapshot, not an SDK-owned API. `pnpm
contracts:middleware` verifies its repository/SHA/content binding and checks the
SDK routes claimed to target Middleware. Update it only with
`scripts/import-middleware-runtime-contract.mjs` from the pinned source commit.

## Corrected drift

| Classification | Result | Resolution |
|---|---:|---|
| SDK_ROUTE_STALE | 19 | Preserved as pre-existing compatibility contracts, but excluded from the canonical Middleware route set because deleting them without a published deprecation window would be a breaking SDK change. They are not staging-certifiable against the pinned Middleware runtime. |
| VERSION_MISMATCH | 0 | Both authorities use OpenAPI 3.1.0. |
| HTTP_METHOD_MISMATCH | 0 | The 62 normalized SDK/runtime operations checked by CI use the same methods. |
| RUNTIME_ROUTE_MISSING | 0 | Every operation asserted by the Middleware alignment allowlist exists at the pinned runtime SHA. |
| SDK_ROUTE_MISSING | 0 | Every operation in the current alignment allowlist exists in an SDK OpenAPI document. |

Path-parameter names are normalized during comparison because
`{tenantId}` and `{tenant_id}` are URI-template documentation names, not a
runtime routing difference. Request, response, header, error, and security
shape parity remains covered by the canonical runtime snapshot and follow-on
generated-client work; no SDK schema may be treated as runtime authority.

## Separate authorities (not Middleware drift)

The restricted gateway contract is server-only and independently owned. The
same-origin voice session/BFF routes are also not Middleware routes. They are
excluded from the Middleware comparison rather than falsely added to the
Middleware snapshot.

## Runtime operations not exposed to ordinary SDK applications

Provider callback ingress (`/api/v1/*/events`), generic provider webhooks,
metrics, inbox/outbox mutation controls, audit, policy administration, and
operator reconciliation routes are intentionally not treated as browser SDK
coverage. Any server/operator client added for them must use a separate export
and the least-privilege runtime scope.

## Non-runtime compatibility and invented application routes

The communications template, sender-identity, domain, suppression, and
preference facades are compatibility-only at this SHA. The unified SDK now
exposes canonical platform, global-operation, and domain command/status
clients for Marketing, AI, CRM, Odoo, n8n, Social, and Telephony. The following
older wrappers remain present so this change does not silently break consumers:

- `/v1/auth/session` (`deprecated: true`; see below)
- `/v1/marketing/campaigns*`
- `/v1/ai/generate`
- `/v1/crm/leads*` (`deprecated: true`; see below)
- `/v1/workflow/runs*` (`deprecated: true`; see below)

`/v1/crm/leads*` was a direct CRM read edge that
`docs/PLATFORM-OPENAPI-ROUTE-CONVERGENCE-V2.md` flags as a prohibited
pattern. The unified SDK no longer exposes it: lead submission goes through
`packages/intake-bff` to `POST /v1/intake/leads`, and CRM record mutation
goes through `codestra.control.crm`. The route itself stays in
`codestra-platform.openapi.yaml`, marked `deprecated: true`, for the
published sunset window this section requires before final contract
removal (the breaking-change gate in `scripts/check-contract-drift.mjs`
rejects an outright path deletion unconditionally, with no exemption for
already-deprecated operations).

`/v1/auth/session` never had a real backend at all: it was invented
alongside the rest of this contract, and this repository's own authority
boundary places OIDC/session infrastructure outside its ownership entirely
(there is no "same-origin BFF package" here to publish a real contract
for). The unified SDK no longer exposes it. Same sunset treatment as
`/v1/crm/leads*` above -- deprecated in the contract, not yet removable.

`/v1/workflow/runs*` was superseded orchestration vocabulary
(`docs/PLATFORM-OPENAPI-ROUTE-CONVERGENCE-V2.md`). The real Middleware
successor, `/v2/automation/*`, turned out to be n8n-orchestrator-internal
machinery on inspection (every authorized client in its operation policy
is an `n8n-*` machine client; tenant/actor context is explicitly derived
server-side, never from a caller) -- not a product-facing route, so this
SDK does not target it. Workflow triggering instead goes through the real,
already-implemented canonical command plane: `codestra.automation.commands.trigger()`
submits `POST /v1/commands` with `command_type: "automation.workflow.trigger"`,
`target: "n8n"`, read back via the existing `GET /v1/operations/{command_id}`
-- the same pattern every other domain command already uses. Same sunset
treatment as the routes above.

These compatibility routes are absent from Middleware SHA `9cd3fd3e…`; they
must not be used as evidence for staging or production certification and need
a published sunset before removal. The canonical runtime
families are `/v1/marketing/commands`, `/v1/ai/commands`, `/v1/crm/commands`,
and `/v1/integrations/n8n/commands`, with operation read-back routes.

## Gate status

`OPENAPI_ALIGNMENT` is PASS for the 62 explicitly checked canonical runtime
operations. Whole-SDK production readiness remains blocked until staging
validates the exact runtime contract and compatibility consumers complete the
published migration.

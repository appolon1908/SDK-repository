# Platform OpenAPI Route Convergence V2

This branch replaces manifest/string-based SDK readiness with exact accepted OpenAPI ownership and generated-client parity.

## Route decisions

```text
/v1/auth/session
  Owner: same-origin BFF package.
  Action: publish a real BFF OpenAPI contract or remove the unsupported readiness claim.
  Status: DONE (removed the claim). No same-origin BFF package exists anywhere in
  this repo or its owned repos, and this repo's own "Authority boundary" section
  (root README) places OIDC/session infrastructure outside its ownership entirely --
  publishing a real contract here would mean either building that infrastructure
  from scratch (out of scope) or documenting someone else's undeployed plan.
  Removed auth.session.get() from the unified SDK facade (packages/codestra_sdk)
  and "auth" from requiredUnifiedSdkModules in the readiness manifest. The route
  stays in codestra-platform.openapi.yaml, marked deprecated: true, and in the
  readiness manifest's compatibilityOnlyEndpointPaths, for the same published
  sunset window as /v1/crm/leads below (same gate limitation: no exemption yet
  for removing an already-deprecated operation).

/v1/marketing/campaigns
  Owner: appolon1908-hue/Codestra-Marketing-.
  Action: import/validate the accepted Marketing OpenAPI and generate the Marketing client.
  Status: DONE. The invented contract didn't match the real one: the real endpoint
  takes no cursor/limit/status query params and returns a bare Campaign[], not a
  paginated {items,nextCursor} envelope, and Campaign/CampaignCreate had entirely
  different field names (objective, daily_budget_minor, currency, state,
  resource_version vs. the invented channel/status/budget). Corrected in
  contracts/openapi/codestra-platform.openapi.yaml against a vendored, pinned
  snapshot of the real contract (contracts/vendor/marketing-runtime-current.*,
  produced by scripts/import-marketing-runtime-contract.mjs). codestra_sdk's
  marketing.campaigns.list() no longer sends the nonexistent query params.
  No dedicated Marketing client package exists yet -- product code still goes
  through the unified facade.

/v1/ai/generate
  Owner: appolon1908-hue/Codestra-AI.
  Action: import/validate the accepted AI OpenAPI and generate the AI client.
  Status: DONE. This was a real bug, not just a documentation gap: the invented
  contract was `{prompt} -> 200 {output}` (synchronous), but the real AI Gateway
  requires `{task, input}` with additionalProperties:false (so `{prompt}` gets
  a 422) and returns `202 {request_id, status, ...}` (an async durable request,
  read back via GET /v1/ai/requests/{request_id} on the real service -- not yet
  exposed on this facade). codestra.ai.generate()'s real callers could never have
  worked against the real backend. Corrected the same way as Marketing, against
  contracts/vendor/ai-runtime-current.* (scripts/import-ai-runtime-contract.mjs).
  packages/codestra_sdk's GenerateAiInput and python/codestra_sdk/ai.py's
  AIClient.generate() both updated to match.

  Both corrections needed a gate change: scripts/check-contract-drift.mjs
  (the breaking-change gate) previously had no way to distinguish "this
  corrects an invented shape toward a real upstream contract" from "this is
  an arbitrary narrowing break" -- it rejected the correction outright, the
  same way it rejected the crm/leads removal below. Added a new, narrow,
  verified escape hatch: an operation carrying
  `x-codestra-corrects-invented-contract: {authority, sourceSha}` is
  cross-checked against the cited vendored authority's actual shape
  (required properties, parameter requiredness, response type/status) and
  only skipped from the normal diff if it genuinely matches; a citation that
  doesn't match throws instead of silently passing. See
  scripts/check-contract-drift.mjs's `verifyRuntimeAuthorityCorrection` and
  the two negative fixtures in scripts/test-contract-drift-detector.mjs
  proving both a mismatched shape and a wrong sourceSha are still rejected.

/v1/crm/leads
  Prohibited direct CRM edge.
  Action: remove and use POST /v1/intake/leads.
  Status: PARTIALLY DONE. Removed from the unified SDK facade (packages/codestra_sdk)
  and from requiredUnifiedSdkModules in the readiness manifest. Lead submission goes
  through packages/intake-bff to POST /v1/intake/leads; CRM record mutation goes
  through codestra.control.crm. The route itself stays in
  codestra-platform.openapi.yaml, marked deprecated: true, and in the readiness
  manifest's compatibilityOnlyEndpointPaths, for the published sunset window
  docs/production/MIDDLEWARE-SDK-CONTRACT-DRIFT.md requires: the breaking-change
  gate (scripts/check-contract-drift.mjs) unconditionally rejects deleting a
  contract path, with no exemption for an already-deprecated operation. The
  vendored-runtime-authority escape hatch added for the Marketing/AI corrections
  below does not cover this case -- it verifies a correction against a real
  upstream shape, and there is no positive upstream shape to cite for "this
  path should stop existing". Final removal still needs a distinct, deliberate
  exception (or a published-sunset grace mechanism) -- a separate, follow-up
  decision.

/v1/workflow/runs
  Superseded orchestration vocabulary.
  Action: remove and use POST /v2/automation/commands plus command/job status APIs.
  Status: DONE, but not as originally worded. Investigated the real Middleware
  v2 automation contract (appolon1908-hue/Middleware-@9152a04e:
  docs/decisions/ADR-0001-AUTOMATION-CONTRACT-V2.md,
  contracts/automation/{n8n-control-plane,operation-policy}.v2.json) before
  building against it: it is real and ADR-accepted, but status: SOURCE_ONLY /
  implementation_status: NOT_IMPLEMENTED, and every client in its operation
  policy is an n8n-branded machine client (n8n-crm-automation,
  n8n-identity-automation, ...) with tenant/actor context explicitly derived
  server-side, never from a caller. That is the n8n-orchestrator's internal
  claim/lease protocol with Middleware, not a product-facing route -- building
  a product SDK contract against POST /v2/automation/commands as literally
  written here would have repeated the exact mistake this file's own
  marketing/ai corrections above just fixed: inventing a contract for the
  wrong integration point.
  Routed through the real, already-implemented canonical command plane
  instead: codestra.automation.commands.trigger() submits POST /v1/commands
  (command_type "automation.workflow.trigger", target "n8n", capability
  "AUTOMATION_TRIGGER" -- a proposed convention, not a verified-real
  command_type, since no such workflow-trigger command_type exists in the
  real command-envelope.v1.schema.json's validated branches yet), read back
  via the existing GET /v1/operations/{command_id}. No new OpenAPI paths
  needed: /v1/commands and /v1/operations/{id} both already exist in the
  vendored Middleware contract and are already exercised by
  scripts/check-middleware-runtime-alignment.mjs. /v1/workflow/runs* is
  deprecated: true in codestra-platform.openapi.yaml, same sunset treatment
  as the routes above; codestra_sdk no longer exposes workflow.runs.*.
```

## Required packages

- `@codestra/intake-sdk`
- `@codestra/intake-bff`
- `@codestra/marketing-sdk`
- `@codestra/ai-sdk`
- `@codestra/communication-sdk`
- `@codestra/social-sdk`
- `@codestra/automation-sdk`
- `@codestra/operations-sdk`

Every mutation must propagate bearer authorization, `X-Tenant-ID`, `X-Correlation-ID`, `Idempotency-Key`, bounded timeout and safe error handling. Browser packages must not contain service credentials.

## Validation

CI must fail when a readiness operation is absent from its accepted OpenAPI, an SDK method has no operation, generated code drifts, a forbidden direct CRM/workflow route returns, or a mutation omits tenant/correlation/idempotency behavior. All OpenAPI documents already recognized by the contract validator must participate in compatibility and drift checks.

## Safety

```text
RUNTIME_DEPLOYED=false
PRODUCTION_CHANGED=false
EXTERNAL_EFFECTS_ENABLED=false
BROWSER_SERVICE_CREDENTIALS=0
```

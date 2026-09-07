# M01 signed inbound n8n boundary

Date: 2026-09-07. Base: accepted `integration/v0.1` commit `9fb3e13c52027b37aeada59f3a7269a494d45596`. This implementation is a review candidate; hosted gates and independent approval are required on the published head. The archived Slice 2 implementation was not used as a base.

## Implemented boundary

- Separate inbound signing/tenant/replay credentials; outbound API credentials no longer carry the legacy inbound token.
- Exact raw-byte HMAC verification through the shared webhook SDK, before strict JSON parsing. Timestamp bounds, key rotation, duplicate-header/key rejection and deterministic sanitized HTTP failures are enforced.
- Canonical CloudEvents now require `tenantid`; event ID, tenant, source, type and full payload schemas are checked before dispatch. Generated n8n schema data is compared against canonical contracts in CI.
- Shared Redis security claims use tenant/event keys, atomic `SET NX EX`, a SHA-256 body fingerprint, at least 24-hour retention, no eviction and confirmed local AOF fsync. A replay, store failure or ambiguous outcome emits no workflow data. Claims are never released after uncertainty.
- The node uses n8n's request/raw-body and response APIs and returns `noWebhookResponse`. It does not call restricted systems or become a business-write authority.
- Optional Svix handoff enforces the newly required tenant UUID at runtime and compares it with the command tenant before resolving an application or sending. It remains disabled by default. Four review regressions (missing, malformed, mismatched and equivalent-case tenant IDs) failed before this follow-up and pass after it.

## Reproducible checks

The focused unit suite covers signature tampering (including whitespace), expiry/future timestamps, wrong keys, rotation, tenant/data-tenant mismatches, source/type rejection, malformed payload/date fields, duplicate JSON and headers, ID mismatch, body limits, unsafe Redis endpoints, mandatory remote authentication, store failure, credential separation and n8n response/no-execution behavior.

The credential-separation regression was run against the accepted base's outbound credential and failed before the change. The changed implementation passes it.

The separate real-Redis suite verifies twelve concurrent duplicate deliveries produce exactly one acceptance, a confirmed claim survives SIGKILL/restart with the same AOF directory, event IDs are tenant-scoped, and disabled AOF, unsafe eviction policy and unavailable Redis reject acceptance. Local testing used Redis 8.10.1 built from its official release. CI uses the immutable Redis image recorded in `required-gates.yml`, and requires all six real-store tests; there is no skip fallback.

Commands: `pnpm install --frozen-lockfile`, `pnpm workflows:validate`, `pnpm run ci`, and `pnpm test:redis` with the local binary or CI image environment described in the n8n README. Protected CI additionally runs coverage, negative contract fixtures, Pact validation, SDK generation and Camel verification on the exact PR head.

## Certification still required

Source tests use the actual n8n API shape but do not boot a deployed n8n worker. Staging must demonstrate raw-body preservation before parsing, private authenticated ingress, TLS/ACL credentials, producer migration to the signed tenant extension, key rotation, body limits, multi-worker routing and recovery. Neither deployment credentials nor live provider access are introduced here.

`WAITAOF 1 0` proves local AOF persistence only. Replicated failover, restored backups and storage durability require topology-specific certification. The claim-to-workflow crash gap requires authoritative delivery reconciliation; this boundary does not promise exactly-once workflow execution. Full M01 operational acceptance remains open until that evidence exists.

The repository remains an SDK/connector implementation. Middleware owns cross-system writes, authorization and business idempotency. M02 contract ownership and the restricted gateway matrix remain next source work; release/promotion criteria in the master mission remain unchanged.

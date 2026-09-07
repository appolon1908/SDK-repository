# `@codestra/n8n-nodes`

Thin n8n actions for social posts and webhook subscriptions plus a private internal trigger for canonical events emitted by Middleware.

## Security boundary

- The action node calls only Codestra Middleware, never Postiz, Odoo, Klyrow, Telnexa, or VICIdial directly.
- The internal trigger must be reachable only from Middleware through private networking, mTLS or an equivalent service boundary, and an allowlist.
- Configure the trigger with **Codestra Signed Internal Events** credentials. Outbound action credentials contain only the API token; the former shared `internalWebhookToken` is no longer accepted.
- Workflows orchestrate approved commands; they do not own authorization, tenant isolation, idempotency, retries, or write correctness.
- Do not expose the internal n8n webhook route to the public internet.

## Signed inbound events

The trigger reads the exact request bytes using n8n's request object before JSON parsing. Its hidden `options.binaryData` default requests raw-body handling for the version-1 webhook route. A missing raw body fails closed; the handler never reconstructs signed bytes from parsed JSON. Configure a proxy/n8n request-size limit as well as the credential's maximum body size (at most 1 MiB), so oversized requests are bounded before buffering.

Send uncompressed `application/json` or `application/cloudevents+json` with `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers produced by `@codestra/webhook-sdk`. The event ID must match the signed header. Duplicate security headers, invalid signatures, expired/future timestamps, duplicate JSON keys, invalid schemas, and unauthorized tenants, sources or types are rejected before workflow output. Default timestamp tolerance is 300 seconds, bounded to at most 3600.

Set an explicit tenant UUID and exact source/event-type allowlists in the inbound credential. Each event requires the canonical `tenantid` UUID extension; social-event `data.tenantId` must agree. Canonical schemas currently support `codestra.social.post.status.v1` and `codestra.webhook.delivery.status.v1`. The embedded validators are generated from `contracts/`, with drift checked by `pnpm contracts:validate`; regenerate after intentional contract edits with `pnpm contracts:n8n:generate`.

Use a `whsec_` signing secret containing at least 32 random bytes in canonical base64. For rotation, enter the current and previous secrets on separate lines (at most three), coordinate with Middleware, then remove retired keys after the accepted delivery window. Never reuse the outbound API token.

## Durable replay store

All workers receiving a tenant's events must share the same persistent Redis database. Remote endpoints require `rediss://`, a username and password in the separate credential fields, trusted TLS and private networking. Credentials embedded in URLs are rejected. Unencrypted Redis is accepted only on loopback for local testing.

Use Redis 7.2 or later with AOF enabled, durable storage and `maxmemory-policy noeviction`. Grant the service account the commands required by the client handshake plus `INFO memory`, `SET` and `WAITAOF`, restricted to `codestra:n8n:replay:*` keys where applicable. Deny application access to destructive/configuration commands. Monitor capacity, persistence errors and rejected claims. A non-evicting store can reject writes when full; this must produce an operational alert, not a fallback store.

Acceptance requires an atomic tenant/event `SET NX EX` claim and confirmation from `WAITAOF 1 0` that the local AOF was fsynced. Claims remain for at least 24 hours, exceeding the maximum signature window. A replay returns 409; an unavailable, unsafe or unconfirmed store returns a sanitized 503. Claims are never deleted after an uncertain outcome.

This proves local-disk crash persistence, not replicated failover durability. Before deploying a failover topology, certify claim preservation across promotion, backup restore and all worker routes. A server crash after claiming but before n8n schedules the workflow can leave an accepted claim without execution. Reconcile that case through the authoritative Middleware delivery process; do not clear claims or assume exactly-once business execution. Middleware still owns authorization and business idempotency.

## Migration and evidence

This changes the unreleased integration line: producers must add `tenantid`, sign the exact envelope, and configure separate inbound credentials. Existing workflows using the old token need a coordinated migration, including verification that the deployed n8n release exposes the raw-body request API and applies the node's raw-body option. Keep those workflows disabled until the deployed ingress, credentials, Redis persistence and tenant routing have passed staging checks.

Run `pnpm run ci` for source checks. Run `pnpm test:redis` with either `SDK_REDIS_SERVER_BIN` pointing to a local Redis 7.2+ server or `SDK_REDIS_TEST_IMAGE` set to an immutable `redis@sha256:...` image and Docker available. This suite starts disposable local servers and exercises concurrency, SIGKILL/restart, tenant isolation, AOF failure, eviction policy and unavailability; it has no mock/skip fallback. Protected integration CI runs it with a pinned Redis image.

See [M01 evidence](../../docs/evidence/M01-signed-inbound-boundary.md) for the exact scope and remaining deployment certification.

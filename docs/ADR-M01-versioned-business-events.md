# Versioned business events and reusable API components

The mission pack uses snake_case envelopes and four business streams. Existing
consumers use CloudEvents and established communications streams. Add the four
new streams to the canonical AsyncAPI without modifying old message schemas.
Middleware owns admission, tenant authorization and any Odoo projection.

New daily usage events are immutable ledger snapshots. Consumers project by
tenant, date and unit, applying only newer snapshot_at revisions. Replaying an
event must not charge again or add its quantity to an existing daily total.

The reusable OpenAPI document contains Error, Page, CorrelationId,
IdempotencyKey, Limit, Cursor and all four identity schemes. It defines reusable
components rather than adding fictitious server operations. Contract CI
validates it together with the existing public and internal contracts.

Rollout requires the receiving Middleware revision before enabling the Klyrow
business publisher. Existing CloudEvents subscribers do not need to migrate.
Rollback disables the new publisher and retains accepted facts for replay.

# Kyqra crawler contracts

This directory is the cross-repository contract authority for Kyqra crawler events and source profiles.

The integration boundary is:

Kyqra crawler -> Codestra Middleware -> Odoo

Kyqra never writes to Odoo. Middleware is the only cross-system write authority. Grafana, Superset, Prometheus, Alertmanager, Alloy, Loki, Tempo, exporters, and OpenBao are not ingestion authorities.

Consumers must pin the SDK-repository commit that supplied the schema and record that SHA in their dependency metadata. A contract change is additive within v1; breaking changes require a new v2 schema and a coordinated migration.

Canonical files:

- contracts/schemas/kyqra/crawler-event-envelope.v1.schema.json
- contracts/schemas/kyqra/crawler-source.v1.schema.json
- packages/contracts/src/kyqra.ts

Runtime activation, source credentials, and production delivery remain separately gated and are not enabled by these schemas.

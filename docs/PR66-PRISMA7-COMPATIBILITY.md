# Prisma 7 dependency compatibility

PR #66 updated the client to 7.10.0 while leaving the generator at 6.19.3,
which fails client generation. The repair keeps the client, CLI and PostgreSQL
adapter at 7.10.0 and moves CLI datasource configuration to
`services/middleware/prisma.config.ts`.

The existing generated-client import paths remain compatible. Database access
uses Prisma's PostgreSQL driver adapter with a five-second connection timeout
and normal certificate verification. Every runtime and test client uses the
same factory. Empty connection strings are rejected instead of allowing ambient
PostgreSQL defaults. Export `DATABASE_URL` explicitly for migrations and runtime;
client generation and image builds need only the schema, with no database URL.
The existing migrations and data model are unchanged. The runtime image also
contains the CLI configuration for controlled operator use; startup does not
apply migrations.

The `mysql2` transitive dependency is pinned to the patched 3.22.0 version for
[GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr).
The production audit passes its High/Critical gate with three Moderate findings.
The repair follows the [Prisma 7 upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).

Local generation and the Middleware dependency build pass. Required hosted CI
must additionally prove the full workspace build, tests and real PostgreSQL
migration/idempotency suite. Revert the dependency/configuration repair together
for source rollback; no database migration or deployment was performed here.

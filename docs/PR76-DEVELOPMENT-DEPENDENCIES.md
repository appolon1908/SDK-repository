# Development dependency refresh

The original grouped update advanced the Prisma CLI without its client, and its
production audit failed on the Prisma CLI's transitive mysql2 dependency. This
branch includes the prerequisite Prisma 7 repair from PR #66: client, CLI and
PostgreSQL adapter at 7.10.0, explicit CLI configuration, a bounded PostgreSQL
connection timeout, and patched mysql2 3.22.0. Merge #66 first, then refresh this
branch from development before merging #76.

The remaining refresh aligns Vitest and V8 coverage at 4.1.11 across the
workspace, with Changesets 3.0.1, Redocly 2.49.0 and tsx 4.23.13. Node type
definitions stay on the Node 22 line used by the repository's CI/runtime rather
than advancing to Node 26 as the original group proposed. pnpm stays pinned to
10.15.0 and the lockfile is regenerated and frozen-install checked.

Vitest 4 reported function coverage below the existing 80% gate despite all
172 prior tests passing. Added behavioral tests cover intake retry identity,
tenant headers, occurrence time, survey privacy, separate survey routing and
HTTP rejection, plus email/SMS batch validation before transport. Coverage
thresholds and exclusions are unchanged. The repaired suite passes 179 tests
across 35 files, with 81.84% function coverage.

Validation also includes all 21 workspace builds/type checks and the contract,
authority and negative-fixture gates. The production High/Critical audit passes;
three Moderate findings remain. Hosted CI must validate the exact published
head, including the real PostgreSQL service suite inherited from #66. This is
maintenance on development, separate from new milestones on integration/v0.1.

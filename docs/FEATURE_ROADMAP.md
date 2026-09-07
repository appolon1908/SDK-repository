# Feature roadmap

Candidate features and hardening work, grounded in gaps observed while working in this
repository. Not commitments or a schedule — a backlog to pull from. Each item names the
concrete gap it closes, not just a general direction.

## Contract governance

- **Automate re-vendoring of pinned external authority contracts.** The pattern in
  `contracts/vendor/calling-contract-authority/` (and the older `marketing-runtime-current`,
  `ai-runtime-current` vendor files) requires a human to clone the authority repo, diff it
  against the current pin, recompute the sha256 digest, and hand-update
  `*.source.json` every time. A script that does this end-to-end — fetch the authority repo
  at a given commit, diff against the current vendored copy, recompute the digest, and open a
  PR with the result — would remove most of that manual work and the transcription errors
  that come with it.
- **Detect upstream drift on a schedule, not just on request.** Nothing currently notices when
  an authority repo (`codestra-production-platform`, the marketing/AI runtime sources) moves
  past the commit this repo has pinned. A scheduled check that compares the pinned
  `source_sha` against the authority repo's current head and opens an issue or PR when they
  diverge would surface this instead of relying on someone remembering to look.
- **Port `validate-workflow-policy.mjs`'s composite-action recursion from `integration/v0.1` to
  `main`.** The version on `integration/v0.1` recurses into a local composite action's
  `action.yml` (`uses: ./.github/actions/...`) to catch mutable nested dependencies, closed
  there this session — `main` still carries an earlier copy of this validator without that
  check. (A local *reusable workflow*, `uses: ./.github/workflows/build.yml`, needs no separate
  handling: the validator already reads every YAML file directly under `.github/workflows`, so
  that file gets validated independently regardless of whether anything else references it.)

## Supply chain / CI hardening

- **SBOM generation on published Docker images.** `docker-publish.yml` uses Buildx to push to
  GHCR, which already attaches a minimal SLSA provenance attestation by default — but there's
  still no SBOM. Adding one (e.g. `docker/build-push-action`'s `sbom: true` input, or a
  dedicated `syft` step) would give consumers a verifiable record of what's actually in each
  image, which provenance alone doesn't provide.
- **Branch-protection parity check across `development`/`staging`/`main`/`production`.** This
  session repeatedly hit required-status-check lists that had drifted out of sync across the
  four promotion branches (a check present on one branch's protection rules but not another's,
  discovered only when a merge was unexpectedly blocked or unexpectedly not). A small script
  that reads each branch's required-checks list via the API and fails if they disagree (modulo
  documented exceptions, e.g. production not requiring approval) would catch this before it
  causes a confusing merge failure.
- **Default new PRs to auto-merge instead of manual polling.** GitHub's built-in auto-merge
  (used ad hoc on a few PRs this session) collapses "wait for CI, notice approval, merge" into
  one step. Making it the default for PRs opened by automation — rather than something enabled
  PR-by-PR — would remove most of the manual status-checking this session did by hand.

## SDK / developer experience

- **A real retry/backoff policy for the shared `RestrictedGatewayAdapter` transport.** All five
  checked-in provider adapters (`vicidial`, `klyrow`, `postiz`, `telnexa`, `odoo`) inherit this
  one base class rather than implementing their own retry logic, and it currently only
  classifies which HTTP statuses are `retryable` — it doesn't retry or back off. Adding that
  policy at the shared transport, where it actually lives, would benefit every adapter at once
  without asking each one to implement it.
- **A stitched-together docs site instead of scattered top-level `docs/*.md` files.** There are
  over a dozen standalone markdown files in `docs/` (architecture, production readiness,
  contract boundaries, deployment) with no index or cross-linking beyond what individual files
  happen to reference from the README.
- **A scaffolding script for new provider adapter packages.** `packages/provider-adapters`
  entries share a lot of boilerplate (capability gates, activation checks, Middleware client
  wiring); a `pnpm create-adapter <name>` style generator would reduce the copy-paste involved
  in adding one.

## Observability

- **Post-deploy smoke tests wired into the publish pipeline.** `scripts/smoke_test_python_sdk.py`
  and `scripts/smoke_test_middleware_python_sdk.py` exist and run during local SDK generation,
  but nothing in `docker-publish.yml` runs an equivalent check against a freshly published
  image before or after it reaches GHCR.
- **Shared OpenTelemetry instrumentation in `connector-kit`.** Tracing/metrics setup is left to
  each consuming service today; a shared helper would give consistent spans across provider
  adapters, the middleware client, and generated clients without each one wiring it up
  independently.

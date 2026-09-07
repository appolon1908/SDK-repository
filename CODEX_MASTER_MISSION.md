# Codestra SDK completion mission

This repository is a contract-first, testable, reproducible SDK and connector
platform. Its non-negotiable write-authority path is:

```text
Application -> Codestra SDK or approved n8n node -> Kong -> Codestra Middleware
  -> provider adapter -> product-local restricted gateway -> provider
```

Codestra Middleware is the only cross-system write authority. Browser code,
SDKs, n8n, optional Svix or Camel components, adapters, and providers must not
create another mutation path or own business approval policy.

## Release line

- Rescue baseline: `37e416c68353b714f74e87572b315b482c620acf`.
- The partial Slice 2 head `48ab78ff0bea490b320f50740234c4e52a2eb7fa`
  is archive evidence, not a development base.
- Milestones land through short-lived branches into `integration/v0.1`.
- The first candidate is `v0.1.0-rc.1`. Stable `v0.1.0` requires explicit
  approval and cross-repository certification.

## Safety boundary

Repository work must never deploy infrastructure; enable email, SMS, social
delivery, PSTN dialing, callbacks, or production webhooks; modify Kong,
Keycloak, DNS, firewalls, or production state; commit secrets or customer data;
or publish stable packages from a pull-request workflow. Optional integrations
remain disabled by default. Exact raw bytes are required for signed inbound
messages, runtime validation is mandatory at trust boundaries, and uncertain
post-dispatch outcomes retain their idempotency record for reconciliation.

## Milestone protocol

Each milestone starts from the latest accepted `integration/v0.1`, records its
base and evidence under `docs/evidence/`, adds regression coverage, runs all
applicable local and hosted gates on the exact head, and uses a pull request.
Missing external evidence is documented as a blocker and never converted into
a success claim. Final merge to `main`, stable publication, credentials,
production approval, and all live activation remain human-controlled.

The detailed M00-M17 deliverables and global definition of done are maintained
in the corresponding milestone evidence records and pull requests. `AGENTS.md`
remains the repository-level implementation protocol.

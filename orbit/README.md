# Codestra Orbit V2 source authority

This directory is the source authority for the Codestra Orbit shared shell, exact design tokens, browser-session controls, brand/domain registry, governed content client, schemas, policy configurations, test helpers, and repository rollout catalog.

## Exact visual contract

```text
canvas=#000000
surface=#101010
elevated-surface=#171717
secondary-surface=#202020
primary-text=#FFFFFF
supporting-text=#D8D8D8
muted-text=#9A9A9A
default-border=#353535
strong-border=#5A5A5A
primary-action=#FFFFFF on #000000
primary-hover=#E7E7E7
primary-active=#CCCCCC
success=#36C98F
warning=#F4B860
error=#FF6469
information=#79B8FF
```

```text
header-desktop=76px
header-tablet=64px
header-mobile=56px
control-standard=52px
control-compact=44px
auth-column-max=480px
control-radius=2px
standard-radius-max=6px
social-icon-visual=20px
social-target=44px
content-main=1280px
content-wide=1440px
text-column=720px
```

Gradients, glass effects, glow, decorative neon, heavy shadows, and oversized rounded cards are prohibited in the shared corporate shell. Blue is informational, not the default corporate action color.

## Footer and social authority

Supported footer variants are exactly:

```text
full
compact
auth-compact
legal-only
```

Supported social networks are LinkedIn, Facebook, Instagram, X, YouTube, GitHub, TikTok, and Threads. Frontend repositories do not contain production social destinations. The shared footer reads them from:

```text
GET /api/v1/brands/{brand}/footer
```

A social entry renders only when the footer resource is published and the entry has an approved HTTPS URL with `enabled=true` and `validated=true`.

Administrators use the governed API contract in `contracts/brand-content.openapi.yaml`. Every mutation requires authorization, `Idempotency-Key`, `X-Correlation-ID`, `Expected-Version`, `X-Change-Reason`, approval history, audit evidence, publication evidence, and rollback evidence as applicable.

## Authentication boundary

- Browser OAuth/OIDC tokens remain server-side. JavaScript receives only a same-origin session summary.
- Codestra retains its own identity provider, domains, callback registration, sessions, roles, protected deep links, MFA, logout, and account workflows.
- External client IDs, redirect URIs, callback routes, query-string return values, state, nonce, PKCE challenges, external account logic, branding, source, and private content are not copied into Orbit.
- Login, signup, refresh, logout, and logout-all use the approved same-origin `/auth` boundary.

## Absolute repository rules

- First-party rendered applications consume the protected, pinned packages; they do not fork tokens, headers, footers, auth layouts, social links, or browser-session code.
- Public and authenticated pages declare their header/footer variants and registered content/asset resources.
- Vendor operator tools use supported theming and SSO rather than invasive source forks.
- Backend and exporter repositories never receive fabricated login pages.
- A hostname is not live merely because it matches a naming convention. Registry, DNS, TLS, routing, release, and rollback evidence are all required.
- Every new page updates the route, content, asset, shell/footer, domain, state, test, and rollback manifests in the same pull request.

## Package artifact policy

The committed tarballs under `orbit/dist/` are a superseded pre-correction candidate and have `installAllowed=false` in `release/orbit-v2.0.0.json`. Do not install them.

The exact-head GitHub workflow builds all nine packages from the current protected source, creates `SHA256SUMS` and `SOURCE_COMMIT`, and uploads a bounded CI artifact. A post-merge release must publish immutable packages tied to the final accepted source SHA before any consumer is certified for production.

Run `npm run orbit:validate` from the repository root.

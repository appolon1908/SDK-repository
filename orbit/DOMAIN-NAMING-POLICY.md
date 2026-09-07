# Domain naming policy

## Registered core boundaries

- Corporate site: `codestra.co` with `www.codestra.co` as an alias.
- Identity: `auth.codestra.co`.
- Public API edge: `api.codestra.co`.
- Social suite: `social.codestra.co`.
- Odoo: `crm.codestra.agency`.
- n8n operator: `n8n.codestra.agency`.

`api.codestra.agency` is recorded as a legacy migration boundary and must not be introduced into new client code.

## New suite convention

Production candidates use `{application}.codestra.co`; staging candidates use `{application}.staging.codestra.co`; previews use `pr-{pullRequest}.{application}.preview.codestra.co`.

A candidate is not active until the exact hostname is added to the registry with an owner, source repository, upstream, identity client, redirect allowlist, DNS evidence, TLS evidence, route evidence, monitoring, and rollback record. Repository names and branch names must never be used to derive live routing automatically.

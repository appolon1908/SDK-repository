# Repository status

The active SDK release line is `integration/v0.1`, created from coherent Slice
1 commit `37e416c68353b714f74e87572b315b482c620acf`. The former Slice 2 head is
archived and is not an accepted base.

M00 establishes deterministic source and governance only. The repository is
not system-production-ready: Middleware, Kong/identity, restricted gateways,
credentials, deployed mTLS, provider behavior, and staging remain external and
uncertified. No live delivery or dialing capability is authorized.

Current milestone evidence is under `docs/evidence/`. Candidate publication is
blocked until M00-M14 and applicable M17 certification pass on one exact SHA.
Stable publication and merge to protected `main` require human approval.

M01 source work now implements the signed inbound n8n boundary with canonical
tenant validation and a durable Redis replay claim. See
`docs/evidence/M01-signed-inbound-boundary.md` for test evidence and the remaining
deployed n8n, ingress, producer migration and Redis topology certification.
This does not certify system readiness or authorize live delivery.

# Codestra MoneyBee Connectors

Server-only Python safety contracts for MoneyBee provider integrations.

- Middleware connectivity and operation readback are enabled when a server explicitly constructs `CodestraMiddlewareClient` with a secure base URL and token provider.
- Consequential Middleware capabilities remain disabled by default because `allowed_capabilities` starts empty.
- A caller must explicitly allowlist each mutation capability, such as `ODOO_WRITE`, before `submit_command` can send a request.
- `enabled=False` remains an emergency/global kill switch and blocks reads and mutations before any network request.
- Provider adapters and external provider effects remain disabled by default.
- Middleware mutations use only the verified `POST /v1/commands` contract.
- Ambiguous mutation outcomes are never retried blindly; callers reconcile through `GET /v1/operations/{command_id}`.
- Consequential calls carry tenant, principal, request, correlation, operation, idempotency, provider, and release context.
- Webhook HMAC verification operates on the exact raw body and requires an injected durable replay store in production.

This package contains no credentials and is not intended for browser bundles.

## Safe activation example

```python
from codestra_moneybee_connectors import CodestraMiddlewareClient, MiddlewareClientConfig

# Readback is available after explicit construction. No mutation capability is enabled.
client = CodestraMiddlewareClient(
    MiddlewareClientConfig(base_url="https://api.codestra.co"),
    token_provider=get_short_lived_service_token,
)

# Enabling a mutation is a separate, explicit decision:
write_client = CodestraMiddlewareClient(
    MiddlewareClientConfig(
        base_url="https://api.codestra.co",
        allowed_capabilities=frozenset({"ODOO_WRITE"}),
    ),
    token_provider=get_short_lived_service_token,
)
```

Do not add a capability to `allowed_capabilities` until the owning Middleware capability, identity, tenant authorization, staging certification, reconciliation, and production activation gates have passed.

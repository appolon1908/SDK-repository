# Unified Marketing SDK Surface

The existing Codestra SDK remains the single client SDK. Add typed modules without bypassing Kong or service ownership.

## Modules
- codestra.auth
- codestra.marketing
- codestra.ai
- codestra.communication
- codestra.social
- codestra.automation

## Initial methods
- marketing.campaigns.create/get/list/request_approval
- marketing.capabilities.get
- ai.generate
- communication.messages.create
- communication.capabilities.get
- social.posts.create/request_approval
- social.capabilities.get

## Client rules
All mutations accept idempotency keys where supported, propagate correlation IDs, use short timeouts, expose typed domain errors, and never store service credentials in browser clients. Provider-specific APIs must not leak into the public SDK surface.

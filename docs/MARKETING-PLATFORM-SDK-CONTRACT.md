# Codestra SDK — Marketing Platform Contract

## Mission
The Codestra SDK is the stable developer-facing client layer for Codestra platform APIs. It must expose typed, versioned modules without allowing callers to bypass Kong, identity policy or service ownership boundaries.

## Required Modules
- codestra.auth
- codestra.marketing
- codestra.communication
- codestra.social
- codestra.ai
- codestra.crm
- codestra.automation

## Core Rules
1. The SDK contains clients and shared types, not business authority.
2. Browser clients use approved user auth flows; service clients use approved service credentials.
3. Tokens, secrets and provider credentials are never persisted in unsafe client storage.
4. Every mutation supports request/correlation IDs and idempotency where required.
5. APIs are versioned and generated/validated against canonical OpenAPI contracts where practical.
6. Provider-specific payloads do not leak into public SDK interfaces unless explicitly modeled as extension metadata.

## Example Surface
marketing.campaigns.create()
marketing.campaigns.approve()
marketing.performance.get()
communication.messages.send()
communication.templates.list()
social.posts.create()
social.posts.schedule()
ai.generate()
ai.classify()
automation.commands.trigger()

## Compatibility Policy
Breaking API changes require a new version or documented migration path. SDK CI must validate generated clients/types, authentication behavior, error normalization, retry safety and contract drift.

## Implementation Order
1. Shared transport/auth/error foundation
2. Marketing module
3. AI module
4. Communication module
5. Social module
6. CRM integration module
7. Automation module
8. Contract tests against staging
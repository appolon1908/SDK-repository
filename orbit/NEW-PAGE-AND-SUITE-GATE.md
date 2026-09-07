# New page and suite merge gate

Every pull request that adds or changes a route must update the following in the same logical change:

1. Route path and application ownership.
2. Page template and shell variant.
3. Authentication class: public, optional, required, or operator.
4. Header navigation entry and footer variant.
5. Stable content keys and asset IDs; no editable copy or direct media URL in components.
6. Loading, empty, degraded, offline, error, permission-denied, and success states as applicable.
7. Registered domain or an explicit pending-registration blocker.
8. Login, logout, session-expiration, protected-deep-link, multi-tab logout, and return-URL behavior for private routes.
9. Responsive evidence at 320, 360, 390, 768, 1024, 1280, 1440, and 1920 pixels.
10. Keyboard, screen-reader, focus, reduced-motion, localization, SEO, analytics, security, performance, visual-regression, API-contract, audit, and rollback evidence.

The pull request remains blocked when any applicable field is missing, when a raw color bypasses semantic tokens, when a local header/footer/auth copy appears, or when a browser token is persisted.

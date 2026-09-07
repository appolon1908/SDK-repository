# codestra_sdk

`codestra_sdk` is the unified developer-facing Codestra package. Product teams import one SDK and use stable domain modules while backend ownership remains free to change behind Kong and Middleware.

```ts
import { createCodestraSdk } from "codestra_sdk";

const codestra = createCodestraSdk({
  baseUrl: "https://api.codestra.co",
  tenantId: "tenant-001",
  requestedBy: "moneybee-backend",
  getAccessToken: async () => token,
});

await codestra.marketing.campaigns.list();
await codestra.ai.generate({ task: "summarize", input: "Summarize this lead." }, { idempotencyKey });
await codestra.communication.messages.send(
  { channel: "email", to: ["customer@example.com"], content: { subject: "Hi", text: "Hello" } },
  { idempotencyKey },
);
await codestra.social.posts.schedule(
  { workspaceId, channels: ["linkedin"], content: { text: "Launch update" }, publishAt },
  { idempotencyKey },
);

// Canonical Middleware command plane. Preserve this Idempotency-Key when
// retrying the same logical operation.
const operation = await codestra.control.odoo.submit(
  {
    commandType: "crm.lead.upsert",
    target: "odoo-19",
    capability: "ODOO_WRITE",
    payload: { external_id: "lead-123", name: "Example lead" },
  },
  { idempotencyKey: "lead-123-upsert-20260902" },
);

// UNKNOWN and RECONCILIATION_REQUIRED remain visible. They are never
// converted into an automatic resubmission.
await codestra.control.odoo.get(operation.operation_id);

// Workflow triggering has no dedicated route -- it submits through the
// same canonical command plane, read back with the generic operations
// collection every canonical command uses.
const command = await codestra.automation.commands.trigger(
  { workflowKey: "lead-intake", payload: { source: "sdk-example" } },
  { idempotencyKey: "lead-intake-20260902-0001" },
);
await codestra.operations.get(command.command_id);
```

## Module Map

```text
codestra_sdk
  platform
  operations
  control
  marketing
  ai
  communication
  social
  automation
  events
  common
```

`communication` delegates to `@codestra/communications-sdk`. `social` delegates to `@codestra/social-sdk`. New domain packages should be mounted here first so product code keeps importing one stable SDK.

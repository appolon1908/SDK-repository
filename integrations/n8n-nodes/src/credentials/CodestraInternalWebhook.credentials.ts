import type { ICredentialType, INodeProperties } from "n8n-workflow";

export class CodestraInternalWebhook implements ICredentialType {
  name = "codestraInternalWebhook";
  displayName = "Codestra Signed Internal Events";
  properties: INodeProperties[] = [
    { displayName: "Expected Tenant ID", name: "expectedTenantId", type: "string", default: "", required: true },
    { displayName: "Signing Secrets (Current, Then Previous)", name: "webhookSecrets", type: "string", typeOptions: { password: true }, default: "", required: true, description: "One whsec_ secret per line, each containing at least 32 random bytes." },
    { displayName: "Allowed Sources", name: "allowedSources", type: "string", typeOptions: { rows: 3 }, default: "", required: true, description: "Exact source identifiers, one per line." },
    { displayName: "Allowed Event Types", name: "allowedEventTypes", type: "string", typeOptions: { rows: 3 }, default: "codestra.social.post.status.v1\ncodestra.webhook.delivery.status.v1", required: true },
    { displayName: "Replay Redis URL", name: "replayRedisUrl", type: "string", default: "", required: true, description: "rediss:// endpoint for the shared persistent security replay store. Credentials belong in the separate fields below." },
    { displayName: "Replay Redis Username", name: "replayUsername", type: "string", default: "" },
    { displayName: "Replay Redis Password", name: "replayPassword", type: "string", typeOptions: { password: true }, default: "" },
    { displayName: "Signature Tolerance Seconds", name: "timestampToleranceSeconds", type: "number", default: 300 },
    { displayName: "Maximum Body Bytes", name: "maxBodyBytes", type: "number", default: 1048576 },
    { displayName: "Replay Timeout Milliseconds", name: "replayTimeoutMs", type: "number", default: 5000 },
  ];
}

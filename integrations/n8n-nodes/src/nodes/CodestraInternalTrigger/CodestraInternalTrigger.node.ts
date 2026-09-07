import type { INodeType, INodeTypeDescription, IWebhookFunctions, IWebhookResponseData } from "n8n-workflow";
import { acceptSignedInternalEvent, InboundEventError } from "../../internal-event-boundary.js";

export class CodestraInternalTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Codestra Internal Event Trigger",
    name: "codestraInternalTrigger",
    group: ["trigger"],
    version: 1,
    description: "Receive signed tenant-bound events from Codestra Middleware",
    defaults: { name: "Codestra Internal Event Trigger" },
    inputs: [], outputs: ["main"],
    credentials: [{ name: "codestraInternalWebhook", required: true }],
    webhooks: [{ name: "default", httpMethod: "POST", responseMode: "onReceived", path: "codestra-internal-events" }],
    // n8n's version-1 webhook parser honors this option before parsing JSON.
    properties: [{ displayName: "Options", name: "options", type: "hidden", default: { binaryData: true } }],
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const response = this.getResponseObject();
    try {
      const request = this.getRequestObject();
      const headers = this.getHeaderData();
      const names = (request.rawHeaders ?? []).filter((_, index) => index % 2 === 0).map((name) => name.toLowerCase());
      for (const name of ["webhook-id", "webhook-timestamp", "webhook-signature", "content-type", "content-encoding"]) {
        if (names.filter((entry) => entry === name).length > 1) throw new InboundEventError("DUPLICATE_HEADER", 400);
      }
      const contentType = headers["content-type"];
      const encoding = headers["content-encoding"];
      if (typeof contentType !== "string" || !/^application\/(?:json|cloudevents\+json)(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
        throw new InboundEventError("UNSUPPORTED_CONTENT_TYPE", 415);
      }
      if (encoding !== undefined && encoding !== "identity") throw new InboundEventError("UNSUPPORTED_CONTENT_ENCODING", 415);
      if (request.rawBody === undefined) await request.readRawBody?.();
      if (!(request.rawBody instanceof Uint8Array)) throw new InboundEventError("RAW_BODY_UNAVAILABLE", 400);
      const event = await acceptSignedInternalEvent({ rawBody: request.rawBody, headers,
        credentials: await this.getCredentials("codestraInternalWebhook") });
      const workflowData = [this.helpers.returnJsonArray([event])];
      response.status(202).json({ accepted: true, eventId: event.id });
      return { noWebhookResponse: true, workflowData };
    } catch (error) {
      const failure = error instanceof InboundEventError ? error : new InboundEventError("INBOUND_UNAVAILABLE", 503);
      response.status(failure.status).json({ error: failure.code });
      // Absence of workflowData tells n8n that a rejected event must not execute.
      return { noWebhookResponse: true };
    }
  }
}

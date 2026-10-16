import { describe, expect, it } from "vitest";
import { listKnownEventTypes, loadEventCatalogue } from "../lib/contracts.js";

// Parses the real contracts/asyncapi/codestra-events.asyncapi.yaml file --
// this is an integration test against the actual checked-in contract, not a
// fixture, so it fails if the event catalogue page would fail to render.
describe("loadEventCatalogue", () => {
  it("parses all real channels from the AsyncAPI catalogue", () => {
    const channels = loadEventCatalogue();
    expect(channels.map((channel) => channel.address).sort()).toEqual(
      [
        "codestra.communications.message.event.v1",
        "codestra.communications.message.status.v1",
        "codestra.communications.provider.health.changed.v1",
        "codestra.communications.reputation.changed.v1",
        "codestra.events.call_disposition_updated",
        "codestra.events.sms_received",
        "codestra.integration.events",
        "codestra.klyrow.events",
        "codestra.telnexa.events",
        "codestra.vicidial.events",
        "codestra.social.post.status.v1",
        "codestra.webhook.delivery.status.v1",
      ].sort(),
    );
  });

  it("documents internal business envelopes without offering them as customer subscriptions", () => {
    const internal = loadEventCatalogue().filter((channel) => channel.exposure === "internal");
    expect(internal).toHaveLength(4);
    for (const channel of internal) {
      expect(channel.messages[0]?.cloudEventType).not.toBe("unknown");
      expect(channel.messages[0]?.fields.map((field) => field.name)).toEqual(
        expect.arrayContaining(["id", "type", "source", "tenant_id", "version", "data"]),
      );
    }
    expect(listKnownEventTypes()).not.toContain("unknown");
  });

  it("resolves the externally-referenced JSON Schema for the social post status message", () => {
    const channels = loadEventCatalogue();
    const social = channels.find((channel) => channel.address === "codestra.social.post.status.v1");
    expect(social).toBeDefined();
    const message = social!.messages[0];
    expect(message).toBeDefined();
    expect(message!.cloudEventType).toBe("codestra.social.post.status.v1");
    const fieldNames = message!.fields.map((field) => field.name);
    expect(fieldNames).toEqual(expect.arrayContaining(["postId", "tenantId", "status", "deliveries", "occurredAt"]));
    expect(message!.fields.find((field) => field.name === "postId")?.required).toBe(true);
  });

  it("resolves the inline schema for the webhook delivery status message", () => {
    const channels = loadEventCatalogue();
    const delivery = channels.find((channel) => channel.address === "codestra.webhook.delivery.status.v1");
    const message = delivery?.messages[0];
    expect(message?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["deliveryId", "endpointId", "status", "occurredAt"]),
    );
  });

  it("resolves the VICIdial and SMS direct payload schemas", () => {
    const channels = loadEventCatalogue();
    const call = channels.find((channel) => channel.address === "codestra.events.call_disposition_updated")?.messages[0];
    const sms = channels.find((channel) => channel.address === "codestra.events.sms_received")?.messages[0];

    expect(call?.cloudEventType).toBe("call_disposition_updated");
    expect(call?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["correlation_id", "causation_id", "disposition", "phone_number", "provider_call_id"]),
    );
    expect(sms?.cloudEventType).toBe("sms_received");
    expect(sms?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["correlation_id", "causation_id", "from_number", "body_preview", "provider_event_id"]),
    );
  });
});

describe("listKnownEventTypes", () => {
  it("returns the event type constants used by the webhook subscription form", () => {
    expect(listKnownEventTypes().sort()).toEqual(
      [
        "call_disposition_updated",
        "codestra.communications.message.event.v1",
        "codestra.communications.message.status.v1",
        "codestra.communications.provider.health.changed.v1",
        "codestra.communications.reputation.changed.v1",
        "codestra.social.post.status.v1",
        "codestra.webhook.delivery.status.v1",
        "sms_received",
      ].sort(),
    );
  });
});

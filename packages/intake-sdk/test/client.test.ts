import { describe, expect, it, vi } from "vitest";
import { createIntakeClient, type LeadSubmission, type SurveyResponseSubmission } from "../src/index.js";

const lead: LeadSubmission = { tenantId: "tenant-a", siteId: "site-1", source: "form", submittedAt: "2026-09-07T00:00:00.000Z" };
const survey: SurveyResponseSubmission = { ...lead, surveyId: "survey-1", surveyVersion: "1", surveyCategory: "feedback", anonymous: true, answers: { rating: 5 } };
function receipt(duplicate = false) {
  return new Response(JSON.stringify({ event_id: "event-1", correlation_id: "corr-1", duplicate, status: duplicate ? "duplicate" : "accepted" }), { status: 202 });
}

describe("intake SDK transport contract", () => {
  it("preserves tenant, occurrence time and retry identity across identical submissions", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(receipt(true));
    const client = createIntakeClient({ fetchImpl });
    const options = { idempotencyKey: "lead-retry-1", correlationId: "corr-1" };
    await expect(client.submitLead(lead, options)).resolves.toMatchObject({ eventId: "event-1", duplicate: false });
    await expect(client.submitLead(lead, options)).resolves.toMatchObject({ eventId: "event-1", duplicate: true, status: "duplicate" });
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(url).toBe("/api/codestra/intake");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(lead);
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Tenant-ID")).toBe("tenant-a");
      expect(headers.get("Idempotency-Key")).toBe("lead-retry-1");
      expect(headers.get("X-Correlation-ID")).toBe("corr-1");
      expect(headers.has("Authorization")).toBe(false);
    }
  });
  it("routes surveys separately and generates occurrence and correlation metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(receipt());
    const client = createIntakeClient({ surveyEndpoint: "/custom/survey", fetchImpl });
    const { submittedAt, ...input } = survey;
    await client.submitSurveyResponse(input);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/custom/survey");
    const sent = JSON.parse(String(init?.body));
    expect(sent).toMatchObject(input);
    expect(Number.isFinite(Date.parse(sent.submittedAt))).toBe(true);
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toMatch(/^survey-/u);
    expect(headers.get("X-Correlation-ID")).toMatch(/^corr-/u);
    expect(input).not.toHaveProperty("submittedAt");
  });
  it.each(["contactId", "leadId"])("rejects %s on anonymous surveys before transport", async (key) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createIntakeClient({ fetchImpl });
    await expect(client.submitSurveyResponse({ ...survey, [key]: "person-1" })).rejects.toThrow("Anonymous survey responses");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("supports an explicitly configured server endpoint and bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(receipt());
    await createIntakeClient({ endpoint: "https://middleware.example.test/v1/intake/leads", bearerToken: "test-service-token", fetchImpl }).submitLead(lead);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://middleware.example.test/v1/intake/leads");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-service-token");
  });
  it("propagates rejected HTTP responses without inventing an accepted receipt", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("rejected", { status: 403 }));
    await expect(createIntakeClient({ fetchImpl }).submitLead(lead)).rejects.toThrow("Codestra intake failed (403): rejected");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { KlyrowDailyUsageEvent } from "../src/index.js";

const source = (path: string) => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8"));

describe("versioned business facts", () => {
  it("validates the producer example and rejects a negative total or missing tenant", () => {
    const schema = source("contracts/schemas/events/business-event.v1.schema.json");
    const example: KlyrowDailyUsageEvent = source("contracts/examples/usage-daily.v1.json");
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(example)).toBe(true);
    expect(validate({ ...example, data: { ...example.data, quantity: -1 } })).toBe(false);
    expect(validate({ ...example, tenant_id: "" })).toBe(false);
    expect(validate({ ...example, version: 2 })).toBe(false);
  });
});

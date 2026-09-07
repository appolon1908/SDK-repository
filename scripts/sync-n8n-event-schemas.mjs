import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";

const source = parse(await readFile("contracts/asyncapi/codestra-events.asyncapi.yaml", "utf8"));
const social = JSON.parse(await readFile("contracts/schemas/events/social-post-status.schema.json", "utf8"));
const { $id, $schema, ...socialData } = social;
function resolve(value) {
  if (Array.isArray(value)) return value.map(resolve);
  if (value === null || typeof value !== "object") return value;
  if (value.$ref === "#/components/schemas/CloudEventEnvelope") return resolve(source.components.schemas.CloudEventEnvelope);
  if (value.$ref === "../schemas/events/social-post-status.schema.json") return socialData;
  if (value.$ref) throw new Error(`Unregistered event schema reference: ${value.$ref}`);
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, resolve(nested)]));
}
const schemas = Object.fromEntries(Object.values(source.components.messages).map((message) => [message.name, resolve(message.payload)]));
const path = "integrations/n8n-nodes/src/event-schemas.ts";
const output = "// Generated from canonical AsyncAPI/JSON Schema; run pnpm contracts:n8n:generate.\n" +
  `export const eventSchemas = ${JSON.stringify(schemas, null, 2)} as const;\n`;
if (process.argv.includes("--write")) await writeFile(path, output);
else if (await readFile(path, "utf8") !== output) throw new Error("n8n event schemas drifted from canonical contracts.");
console.log("n8n event schema parity passed.");

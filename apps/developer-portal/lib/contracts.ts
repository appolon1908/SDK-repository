import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/**
 * Parses `contracts/asyncapi/codestra-events.asyncapi.yaml` at request time
 * (server component only -- this module uses `node:fs`) so the developer
 * portal's event catalogue page always reflects the current contract file
 * without a separate build step. Field/type names below come straight out
 * of the YAML document; nothing here is invented.
 */

// Resolved from this file's own location (not process.cwd()) so it works
// whether Next/Vitest is invoked from this package directory or from the
// repo root, e.g. by the root `pnpm test`.
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolve(APP_DIR, "..", "..");
const ASYNCAPI_PATH = join(REPO_ROOT, "contracts", "asyncapi", "codestra-events.asyncapi.yaml");

export interface EventSchemaField {
  name: string;
  type: string;
  required: boolean;
  enumValues?: readonly string[];
}

export interface EventCatalogueMessage {
  name: string;
  title: string;
  cloudEventType: string;
  fields: readonly EventSchemaField[];
}

export interface EventCatalogueChannel {
  key: string;
  address: string;
  exposure: "public" | "internal";
  messages: readonly EventCatalogueMessage[];
}

// Minimal shape of the parsed AsyncAPI YAML document -- just enough to walk
// the channels/messages/schemas this catalogue page needs.
interface RawDocument {
  channels?: Record<string, RawChannel>;
  components?: {
    messages?: Record<string, RawMessage>;
    schemas?: Record<string, RawSchema>;
  };
}
interface RawChannel {
  "x-codestra-exposure"?: "internal";
  address?: string;
  messages?: Record<string, { $ref?: string }>;
}
interface RawMessage {
  title?: string;
  payload?: RawSchema;
}
interface RawSchema {
  type?: string | string[];
  allOf?: RawSchema[];
  properties?: Record<string, RawSchema & { const?: string; $ref?: string; enum?: string[]; items?: RawSchema; format?: string }>;
  required?: string[];
  $ref?: string;
  const?: string;
  pattern?: string;
}

export function loadEventCatalogue(): EventCatalogueChannel[] {
  const source = readFileSync(ASYNCAPI_PATH, "utf8");
  const document = parse(source) as RawDocument;
  const channels = document.channels ?? {};
  const messages = document.components?.messages ?? {};
  const schemas = document.components?.schemas ?? {};

  return Object.entries(channels).map(([key, channel]) => {
    const channelMessages = Object.entries(channel.messages ?? {}).map(([messageKey, ref]) => {
      const messageName = ref.$ref?.split("/").pop() ?? messageKey;
      const rawMessage = messages[messageName];
      return resolveMessage(messageName, rawMessage, schemas);
    });
    return { key, address: channel.address ?? key, messages: channelMessages,
      exposure: channel["x-codestra-exposure"] ?? "public" };
  });
}

export function listKnownEventTypes(): string[] {
  // Internal business streams are not customer webhook subscription types.
  return loadEventCatalogue().filter((channel) => channel.exposure === "public")
    .flatMap((channel) => channel.messages.map((message) => message.cloudEventType));
}

function resolveMessage(
  name: string,
  message: RawMessage | undefined,
  schemas: Record<string, RawSchema>,
): EventCatalogueMessage {
  const objectPart = message?.payload?.allOf?.find((part) => part.type === "object");
  if (objectPart) {
    const typeProperty = objectPart.properties?.type ?? objectPart.properties?.event_type;
    const cloudEventType = typeof typeProperty?.const === "string" ? typeProperty.const
    : typeProperty?.enum?.join(" | ") ?? typeProperty?.pattern ?? "unknown";
    const dataSchema = resolveSchema(objectPart.properties?.data, schemas);
    return {
      name,
      title: message?.title ?? name,
      cloudEventType,
      fields: extractFields(dataSchema),
    };
  }

  const payloadSchema = resolveSchema(message?.payload, schemas);
  const typeProperty = payloadSchema?.properties?.type ?? payloadSchema?.properties?.event_type;
  const cloudEventType = typeof typeProperty?.const === "string" ? typeProperty.const
    : typeProperty?.enum?.join(" | ") ?? typeProperty?.pattern ?? "unknown";
  return {
    name,
    title: message?.title ?? name,
    cloudEventType,
    fields: extractFields(payloadSchema),
  };
}

function resolveSchema(
  schema: RawSchema | undefined,
  schemas: Record<string, RawSchema>,
): RawSchema | undefined {
  if (schema?.$ref?.startsWith("#/components/schemas/")) {
    const schemaName = schema.$ref.split("/").pop();
    return schemaName ? schemas[schemaName] : undefined;
  }
  if (schema?.$ref && schema.$ref.startsWith("..")) {
    const schemaPath = resolve(dirname(ASYNCAPI_PATH), schema.$ref);
    return JSON.parse(readFileSync(schemaPath, "utf8")) as RawSchema;
  }
  return schema;
}

function extractFields(schema: RawSchema | undefined): EventSchemaField[] {
  if (!schema?.properties) return [];
  const required = schema.required ?? [];
  return Object.entries(schema.properties).map(([name, definition]) => ({
    name,
    type: describeType(definition),
    required: required.includes(name),
    ...(Array.isArray(definition.enum) ? { enumValues: definition.enum } : {}),
  }));
}

function describeType(definition: RawSchema & { format?: string; items?: RawSchema }): string {
  if (definition.type === "array" && definition.items) return `${describeType(definition.items)}[]`;
  const type = Array.isArray(definition.type) ? definition.type.join(" | ") : definition.type;
  if (definition.format) return `${type ?? "string"} (${definition.format})`;
  return type ?? "object";
}

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parse } from "yaml";

const definitions = [
  {
    kind: "openapi",
    path: "contracts/middleware-runtime-current.openapi.json",
    expectedVersion: "3.1.0",
    externalEvidence: true,
  },
  {
    kind: "openapi",
    path: "contracts/openapi/codestra-middleware-client.openapi.json",
    expectedVersion: "3.1.0",
  },
  {
    kind: "openapi",
    path: "contracts/openapi/codestra-public.openapi.yaml",
    expectedVersion: "3.1.0",
  },
  {
    kind: "openapi",
    path: "contracts/openapi/codestra-enterprise.openapi.yaml",
    expectedVersion: "3.1.0",
  },
  {
    kind: "openapi",
    path: "contracts/openapi/codestra-communications.openapi.yaml",
    expectedVersion: "3.1.0",
  },
  {
    kind: "openapi",
    path: "contracts/openapi/codestra-operations-dashboard.openapi.yaml",
    expectedVersion: "3.1.0",
  },
  {
    kind: "openapi",
    path: "contracts/openapi/codestra-restricted-gateway.openapi.yaml",
    expectedVersion: "3.1.0",
  },
  {
    kind: "openapi",
    path: "contracts/openapi/codestra-control-plane.openapi.yaml",
    expectedVersion: "3.1.0",
  },
  {
    kind: "openapi",
    path: "contracts/openapi/codestra-platform.openapi.yaml",
    expectedVersion: "3.1.0",
  },
  {
    kind: "openapi",
    path: "contracts/vendor/marketing-runtime-current.openapi.json",
    expectedVersion: "3.1.0",
    externalEvidence: true,
  },
  {
    kind: "openapi",
    path: "contracts/vendor/ai-runtime-current.openapi.json",
    expectedVersion: "3.1.0",
    externalEvidence: true,
  },
  {
    kind: "asyncapi",
    path: "contracts/asyncapi/codestra-events.asyncapi.yaml",
    expectedVersion: "3.0.0",
  },
];

const failures = [];
const documents = new Map();

for (const definition of definitions) {
  let source;
  try {
    source = await readFile(definition.path, "utf8");
  } catch (error) {
    failures.push(`${definition.path}: cannot read file: ${formatError(error)}`);
    continue;
  }

  if (!source.endsWith("\n")) failures.push(`${definition.path}: missing final newline`);
  for (const forbidden of ["example.com", "changeme", "TODO_SECRET", "Bearer eyJ", "BEGIN PRIVATE KEY"]) {
    if (source.includes(forbidden)) {
      failures.push(`${definition.path}: contains forbidden placeholder or credential material: ${forbidden}`);
    }
  }

  let document;
  try {
    document = parse(source);
  } catch (error) {
    failures.push(`${definition.path}: invalid YAML: ${formatError(error)}`);
    continue;
  }

  if (!isObject(document)) {
    failures.push(`${definition.path}: root document must be an object`);
    continue;
  }

  if (document[definition.kind] !== definition.expectedVersion) {
    failures.push(`${definition.path}: expected ${definition.kind} ${definition.expectedVersion}`);
  }
  documents.set(definition.path, document);
}

const operationIds = new Map();
for (const definition of definitions.filter((entry) => entry.kind === "openapi")) {
  const document = documents.get(definition.path);
  if (!document) continue;
  validateOpenApi(definition.path, document, definition.externalEvidence ? new Map() : operationIds, failures, definition.externalEvidence === true);
}

const asyncApi = documents.get("contracts/asyncapi/codestra-events.asyncapi.yaml");
if (asyncApi) validateAsyncApi("contracts/asyncapi/codestra-events.asyncapi.yaml", asyncApi, failures);

try {
  const contractSource = await readFile("packages/contracts/src/index.ts", "utf8");
  const match = contractSource.match(/CONTRACT_VERSION\s*=\s*"([^"]+)"/u);
  if (!match) {
    failures.push("packages/contracts/src/index.ts: CONTRACT_VERSION was not found");
  } else {
    for (const definition of definitions.filter((entry) => !entry.externalEvidence)) {
      const document = documents.get(definition.path);
      const version = isObject(document?.info) ? document.info.version : undefined;
      if (version !== match[1]) {
        failures.push(`${definition.path}: info.version ${String(version)} does not match CONTRACT_VERSION ${match[1]}`);
      }
    }
  }
} catch (error) {
  failures.push(`packages/contracts/src/index.ts: cannot verify contract version: ${formatError(error)}`);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "codestra-contracts-"));
try {
  for (const definition of definitions) {
    const lintArgs = ["lint", definition.path, "--format=stylish"];
    if (definition.externalEvidence) lintArgs.push("--config", ".redocly.middleware.yaml");
    const lint = runRedocly(lintArgs);
    if (lint.status !== 0) {
      failures.push(`${definition.path}: Redocly semantic lint failed\n${formatProcess(lint)}`);
      continue;
    }

    const output = join(temporaryDirectory, `${basename(definition.path)}.json`);
    const bundle = runRedocly(["bundle", definition.path, "--output", output]);
    if (bundle.status !== 0) {
      failures.push(`${definition.path}: Redocly bundle/reference resolution failed\n${formatProcess(bundle)}`);
      continue;
    }

    try {
      JSON.parse(await readFile(output, "utf8"));
    } catch (error) {
      failures.push(`${definition.path}: bundled document is not valid JSON: ${formatError(error)}`);
    }
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const schemaValidation = spawnSync(
  process.execPath,
  ["scripts/validate-json-schemas.mjs", "contracts/schemas"],
  { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
);
if (schemaValidation.status !== 0) {
  failures.push(`JSON Schema semantic validation failed\n${formatProcess(schemaValidation)}`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("OpenAPI, AsyncAPI, JSON Schema, reference, and governance validation passed.");

function validateOpenApi(path, document, ids, output, externalEvidence = false) {
  if (!isObject(document.info) || typeof document.info.title !== "string" || typeof document.info.version !== "string") {
    output.push(`${path}: info.title and info.version are required`);
  }
  if (!externalEvidence && (!Array.isArray(document.servers) || document.servers.length === 0)) {
    output.push(`${path}: at least one server is required`);
  } else if (Array.isArray(document.servers)) {
    for (const server of document.servers) {
      if (!isObject(server) || typeof server.url !== "string" || !server.url.startsWith("https://")) {
        output.push(`${path}: every server URL must be absolute HTTPS`);
      }
    }
  }
  if (!externalEvidence && (!Array.isArray(document.security) || document.security.length === 0)) {
    output.push(`${path}: root security requirements are required`);
  }
  if (!isObject(document.paths)) {
    output.push(`${path}: paths must be an object`);
    return;
  }

  const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
  for (const [route, pathItem] of Object.entries(document.paths)) {
    if (!isObject(pathItem)) {
      output.push(`${path}: ${route} path item must be an object`);
      continue;
    }
    for (const method of methods) {
      const operation = pathItem[method];
      if (operation === undefined) continue;
      if (!isObject(operation)) {
        output.push(`${path}: ${method.toUpperCase()} ${route} must be an object`);
        continue;
      }
      if (typeof operation.operationId !== "string" || !operation.operationId.trim()) {
        output.push(`${path}: ${method.toUpperCase()} ${route} requires operationId`);
      } else if (ids.has(operation.operationId)) {
        output.push(`${path}: duplicate operationId ${operation.operationId}, first used at ${ids.get(operation.operationId)}`);
      } else {
        ids.set(operation.operationId, `${method.toUpperCase()} ${route}`);
      }
      if (!isObject(operation.responses) || Object.keys(operation.responses).length === 0) {
        output.push(`${path}: ${method.toUpperCase()} ${route} requires at least one response`);
      }
    }
  }
}

function validateAsyncApi(path, document, output) {
  if (!isObject(document.info) || typeof document.info.title !== "string" || typeof document.info.version !== "string") {
    output.push(`${path}: info.title and info.version are required`);
  }
  if (!isObject(document.channels) || Object.keys(document.channels).length === 0) {
    output.push(`${path}: at least one channel is required`);
  }
  if (!isObject(document.operations) || Object.keys(document.operations).length === 0) {
    output.push(`${path}: at least one operation is required`);
    return;
  }
  for (const [name, operation] of Object.entries(document.operations)) {
    if (!isObject(operation)) {
      output.push(`${path}: operation ${name} must be an object`);
      continue;
    }
    if (operation.action !== "send" && operation.action !== "receive") {
      output.push(`${path}: operation ${name} must declare action send or receive`);
    }
    if (!isObject(operation.channel) || typeof operation.channel.$ref !== "string") {
      output.push(`${path}: operation ${name} must reference a channel`);
    }
  }
}

function runRedocly(args) {
  const command = ["pnpm", "exec", "redocly", ...args];
  const executable = process.platform === "win32" ? "cmd.exe" : command[0];
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", ...command] : command.slice(1);
  return spawnSync(executable, commandArgs, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      REDOCLY_TELEMETRY: "off",
      REDOCLY_SUPPRESS_UPDATE_NOTICE: "true",
    },
  });
}

function formatProcess(result) {
  if (result.error) return formatError(result.error);
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `exit status ${String(result.status)}`;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

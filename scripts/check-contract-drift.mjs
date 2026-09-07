import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Detects breaking changes between a base git ref and the current working
 * tree across every contract this repository owns: all three OpenAPI
 * documents (public, enterprise, restricted-gateway) and the AsyncAPI
 * event catalogue.
 *
 * Earlier versions of this script (a) only ever compared the public
 * OpenAPI document, and (b) diffed the raw YAML structurally without
 * resolving any `$ref` -- so a breaking change routed through a shared
 * `components.schemas` entry, an external file ref, parameters, request
 * bodies, security requirements, or operationId never registered at all.
 * This version bundles both sides with `redocly bundle --dereferenced`
 * first (zero `$ref`s left anywhere) and diffs the fully resolved
 * documents.
 */

const [baseSha] = process.argv.slice(2);
if (!baseSha) {
  console.error("Usage: node scripts/check-contract-drift.mjs <base-git-sha>");
  process.exit(2);
}

const OPENAPI_FILES = [
  "contracts/openapi/codestra-middleware-client.openapi.json",
  "contracts/openapi/codestra-public.openapi.yaml",
  "contracts/openapi/codestra-enterprise.openapi.yaml",
  "contracts/openapi/codestra-restricted-gateway.openapi.yaml",
  "contracts/openapi/codestra-communications.openapi.yaml",
  "contracts/openapi/codestra-operations-dashboard.openapi.yaml",
  "contracts/openapi/codestra-control-plane.openapi.yaml",
  "contracts/openapi/codestra-platform.openapi.yaml",
];
const ASYNCAPI_FILE = "contracts/asyncapi/codestra-events.asyncapi.yaml";
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const TRANSPORT_INJECTED_HEADERS = new Map([
  ["X-Tenant-ID", '"x-tenant-id": this.tenantId'],
]);

/**
 * A contract this repo invented before a canonical upstream contract
 * existed can turn out wrong once the real one is available (see
 * codestra-platform.openapi.yaml's history: /v1/ai/generate and
 * /v1/marketing/campaigns were both guessed, and the guesses didn't
 * match). Correcting that guess is not a breaking change to any real
 * caller -- there was no real caller a wrong invented shape could ever
 * have satisfied -- but the diff below can't tell "correction toward
 * ground truth" apart from "arbitrary narrowing" on its own. These are
 * the vendored, pinned snapshots of the real upstream contracts that
 * `isProvenAgainstRuntimeAuthority` cross-checks a correction against
 * before allowing it through; see scripts/import-marketing-runtime-contract.mjs
 * and scripts/import-ai-runtime-contract.mjs for how they're produced.
 */
const RUNTIME_AUTHORITIES = new Map([
  ["marketing", {
    openapiPath: "contracts/vendor/marketing-runtime-current.openapi.json",
    sourcePath: "contracts/vendor/marketing-runtime-current.source.json",
  }],
  ["ai", {
    openapiPath: "contracts/vendor/ai-runtime-current.openapi.json",
    sourcePath: "contracts/vendor/ai-runtime-current.source.json",
  }],
]);
const runtimeAuthorityBundleCache = new Map();

const workDir = await mkdtemp(join(tmpdir(), "codestra-contract-drift-"));
const failures = [];

try {
  const baseDir = join(workDir, "base");
  materializeContractsAtRef(baseSha, baseDir);

  for (const relativePath of OPENAPI_FILES) {
    const baseBundle = bundle(join(baseDir, relativePath), join(workDir, `base-${basename(relativePath)}.json`));
    const currentBundle = bundle(relativePath, join(workDir, `current-${basename(relativePath)}.json`));
    if (baseBundle === undefined || currentBundle === undefined) continue; // file didn't exist on one side; nothing to diff
    diffOpenApi(relativePath, baseBundle, currentBundle, failures);
  }

  const baseAsyncApi = bundle(join(baseDir, ASYNCAPI_FILE), join(workDir, "base-asyncapi.json"));
  const currentAsyncApi = bundle(ASYNCAPI_FILE, join(workDir, "current-asyncapi.json"));
  if (baseAsyncApi !== undefined && currentAsyncApi !== undefined) {
    diffAsyncApi(ASYNCAPI_FILE, baseAsyncApi, currentAsyncApi, failures);
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`Breaking contract drift detected against ${baseSha}:\n` + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`No breaking drift detected in any contract against ${baseSha}.`);

function basename(relativePath) {
  return relativePath.replace(/[\\/]/g, "_");
}

function materializeContractsAtRef(ref, destination) {
  const archive = spawnSync("git", ["archive", ref, "--", "contracts"], { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
  if (archive.status !== 0) {
    throw new Error(`Failed to materialize contracts/ at ${ref}: ${archive.stderr?.toString() ?? "unknown error"}`);
  }
  const tar = spawnSync("tar", ["-x", "-C", ensureDir(destination)], { input: archive.stdout });
  if (tar.status !== 0) {
    throw new Error(`Failed to extract contracts/ at ${ref}: ${tar.stderr?.toString() ?? "unknown error"}`);
  }
}

function ensureDir(path) {
  spawnSync("mkdir", ["-p", path]);
  return path;
}

/** Returns the parsed, fully dereferenced bundle, or undefined if the source file does not exist. */
function bundle(sourcePath, outputPath) {
  const result = spawnSync("pnpm", ["exec", "redocly", "bundle", sourcePath, "--output", outputPath, "--ext", "json", "--dereferenced"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, REDOCLY_TELEMETRY: "off", REDOCLY_SUPPRESS_UPDATE_NOTICE: "true" },
  });
  if (result.status !== 0) {
    const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (/does not exist|ENOENT/iu.test(diagnostic)) return undefined;
    throw new Error(`redocly bundle failed for ${sourcePath}:\n${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
  }
  return JSON.parse(readFileSyncOrThrow(outputPath));
}

function readFileSyncOrThrow(path) {
  const result = spawnSync("cat", [path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Failed to read bundled output at ${path}`);
  return result.stdout;
}

function diffOpenApi(file, base, current, output) {
  for (const [path, basePathItem] of Object.entries(base.paths ?? {})) {
    const currentPathItem = current.paths?.[path];
    if (!currentPathItem) {
      output.push(`[${file}] removed path: ${path}`);
      continue;
    }
    for (const method of METHODS) {
      const baseOperation = basePathItem?.[method];
      if (!baseOperation) continue;
      const currentOperation = currentPathItem?.[method];
      const label = `${method.toUpperCase()} ${path}`;
      if (!currentOperation) {
        output.push(`[${file}] removed operation: ${label}`);
        continue;
      }
      diffOperation(
        file,
        label,
        path,
        method,
        baseOperation,
        currentOperation,
        effectiveParameters(basePathItem, baseOperation),
        effectiveParameters(currentPathItem, currentOperation),
        base.security,
        current.security,
        output,
      );
    }
  }
}

/**
 * OpenAPI permits `parameters` on the Path Item Object (a sibling of
 * get/post/etc.), applying to every operation under that path unless an
 * operation redeclares the same name+in. Merging this in is what lets a
 * newly-added required path-item-level parameter -- one no existing
 * generated client could send -- actually get compared, instead of the
 * check only ever looking at operation.parameters.
 */
function effectiveParameters(pathItem, operation) {
  const merged = new Map((pathItem?.parameters ?? []).map((parameter) => [`${parameter.in}:${parameter.name}`, parameter]));
  for (const parameter of operation?.parameters ?? []) {
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...merged.values()];
}

function diffOperation(file, label, path, method, base, current, baseParameters, currentParameters, documentBaseSecurity, documentCurrentSecurity, output) {
  if (verifyRuntimeAuthorityCorrection(file, method, path, current)) return;

  if (base.operationId && current.operationId && base.operationId !== current.operationId) {
    output.push(`[${file}] operationId changed for ${label}: ${base.operationId} -> ${current.operationId}`);
  }

  for (const responseCode of Object.keys(base.responses ?? {})) {
    const baseResponse = base.responses[responseCode];
    const currentResponse = current.responses?.[responseCode];
    if (!currentResponse) {
      output.push(`[${file}] removed response ${responseCode}: ${label}`);
      continue;
    }
    for (const mediaType of Object.keys(baseResponse.content ?? {})) {
      const baseSchema = baseResponse.content[mediaType]?.schema;
      const currentSchema = currentResponse.content?.[mediaType]?.schema;
      if (baseResponse.content[mediaType] && !currentResponse.content?.[mediaType]) {
        output.push(`[${file}] removed response media type ${mediaType} for ${responseCode} ${label}`);
        continue;
      }
      if (baseSchema && currentSchema) compareSchema(`${label} responses.${responseCode}.${mediaType}`, baseSchema, currentSchema, output, file);
    }
  }

  const baseParams = new Map(baseParameters.map((parameter) => [`${parameter.in}:${parameter.name}`, parameter]));
  const currentParams = new Map(currentParameters.map((parameter) => [`${parameter.in}:${parameter.name}`, parameter]));
  for (const [key, baseParam] of baseParams) {
    const currentParam = currentParams.get(key);
    if (!currentParam) {
      output.push(`[${file}] removed parameter ${key} on ${label}`);
      continue;
    }
    if (!baseParam.required && currentParam.required) {
      output.push(`[${file}] parameter ${key} on ${label} became required`);
    }
    if (baseParam.schema && currentParam.schema) compareSchema(`${label} parameters.${key}`, baseParam.schema, currentParam.schema, output, file);
  }
  for (const [key, currentParam] of currentParams) {
    if (!baseParams.has(key) && currentParam.required && !isProvenTransportInjectedHeader(currentParam)) {
      output.push(`[${file}] new required parameter ${key} on ${label}`);
    }
  }

  const baseBody = base.requestBody;
  const currentBody = current.requestBody;
  if (baseBody) {
    if (!currentBody) {
      output.push(`[${file}] removed request body on ${label}`);
    } else {
      if (!baseBody.required && currentBody.required) output.push(`[${file}] request body on ${label} became required`);
      for (const mediaType of Object.keys(baseBody.content ?? {})) {
        if (!currentBody.content?.[mediaType]) {
          output.push(`[${file}] removed request media type ${mediaType} on ${label}`);
          continue;
        }
        const baseSchema = baseBody.content[mediaType]?.schema;
        const currentSchema = currentBody.content[mediaType]?.schema;
        if (baseSchema && currentSchema) compareSchema(`${label} requestBody.${mediaType}`, baseSchema, currentSchema, output, file);
      }
    }
  } else if (currentBody?.required) {
    // The base operation had no request body at all, so every existing
    // caller sends none. A current side that adds one and marks it
    // required is valid OpenAPI but breaks every such caller identically
    // to a body that was optional becoming required.
    output.push(`[${file}] new required request body on ${label}`);
  }

  // Per OpenAPI semantics, an operation's own `security` (even an empty
  // array, meaning explicitly no auth) overrides the document root; only
  // an operation that omits `security` entirely inherits the root's.
  // None of this repo's operations declare it per-operation today, so
  // without this fallback every comparison here was silently comparing
  // two empty arrays -- verified: this is exactly why the check never
  // fired against a real document.
  const baseSecurity = base.security ?? documentBaseSecurity ?? [];
  const currentSecurity = current.security ?? documentCurrentSecurity ?? [];
  compareSecurityAlternatives(file, label, baseSecurity, currentSecurity, output);
}

/**
 * Codex review finding on #68: within one Security Requirement Object the
 * keys are conjunctive (all required together), but across the top-level
 * array, requirement objects are alternatives (any one satisfies the
 * operation) -- flattening every requirement object into one Set of scheme
 * names, as an earlier version of this check did, loses that structure:
 * relaxing `[{oidc: [], apiKey: []}]` to `[{oidc: []}]` (dropping a
 * conjunctive co-requirement, which only makes auth *easier*) got reported
 * identically to actually removing an alternative.
 *
 * The correct test: a base alternative is still satisfiable after the
 * change if some current alternative needs no more than what that base
 * alternative already required -- a caller holding every credential the
 * base alternative demanded can trivially satisfy a current alternative
 * that is a subset (or exact match) of it. An empty requirement array
 * means "no security requirement" (open access), modeled here as a single
 * alternative with an empty scheme set so that both directions -- open
 * access becoming gated, and a base alternative losing every satisfying
 * current alternative -- go through the same check.
 */
function compareSecurityAlternatives(file, label, baseSecurity, currentSecurity, output) {
  const baseAlternatives = baseSecurity.length > 0 ? baseSecurity.map((requirement) => new Set(Object.keys(requirement))) : [new Set()];
  const currentAlternatives = currentSecurity.length > 0 ? currentSecurity.map((requirement) => new Set(Object.keys(requirement))) : [new Set()];

  for (const baseAlternative of baseAlternatives) {
    const stillSatisfiable = currentAlternatives.some((currentAlternative) => isSubset(currentAlternative, baseAlternative));
    if (!stillSatisfiable) {
      const description = baseAlternative.size > 0 ? [...baseAlternative].sort().join(" + ") : "(no authentication required)";
      output.push(`[${file}] ${label} removed previously satisfiable security alternative: ${description}`);
    }
  }
}

function isSubset(subset, superset) {
  for (const value of subset) {
    if (!superset.has(value)) return false;
  }
  return true;
}

/**
 * A required header that the public transport has always supplied is not a
 * new caller obligation. Keep this exception deliberately narrow: the
 * contract must opt in, the header must be on the reviewed allowlist, and
 * the checked source must still contain the corresponding injection. This
 * prevents an annotation alone from concealing an arbitrary breaking API
 * change.
 */
function isProvenTransportInjectedHeader(parameter) {
  if (parameter.in !== "header" || parameter["x-codestra-sdk-transport-injected"] !== true) return false;
  const sourceInvariant = TRANSPORT_INJECTED_HEADERS.get(parameter.name);
  if (!sourceInvariant) return false;
  const sdkSource = readFileSyncOrThrow("packages/codestra_sdk/src/sdk.ts");
  if (!sdkSource.includes(sourceInvariant)) {
    throw new Error(`Contract marks ${parameter.name} as transport-injected, but the SDK transport invariant is absent`);
  }
  return true;
}

/**
 * An operation carrying `x-codestra-corrects-invented-contract: { authority,
 * sourceSha }` claims its current shape was corrected to match a real,
 * vendored upstream contract rather than invented. This is verified, not
 * trusted: the cited authority must be one of RUNTIME_AUTHORITIES, its
 * sourceSha must match that authority's own pin exactly (so a stale or
 * wrong citation is caught, not silently accepted), and the current
 * operation's shape must structurally match what that authority actually
 * declares. Any mismatch throws rather than falling through to the normal
 * diff, so a bad annotation fails loudly instead of masking a real
 * breaking change as a "verified" one. Returns false (proceed with the
 * normal diff) only when there is no such annotation at all.
 */
function verifyRuntimeAuthorityCorrection(file, method, path, current) {
  const annotation = current["x-codestra-corrects-invented-contract"];
  if (annotation === undefined) return false;
  const label = `${method.toUpperCase()} ${path}`;
  const authorityName = annotation?.authority;
  const sourceSha = annotation?.sourceSha;
  if (!RUNTIME_AUTHORITIES.has(authorityName)) {
    throw new Error(`[${file}] ${label} cites unknown runtime authority ${JSON.stringify(authorityName)}`);
  }
  if (!/^[0-9a-f]{40}$/u.test(sourceSha ?? "")) {
    throw new Error(`[${file}] ${label} cites an invalid runtime authority sourceSha`);
  }
  const { pin, document: authorityDocument } = loadRuntimeAuthorityBundle(authorityName);
  if (pin.source_sha !== sourceSha) {
    throw new Error(
      `[${file}] ${label} cites runtime authority sha ${sourceSha}, but the vendored "${authorityName}" snapshot is pinned to ${pin.source_sha}`,
    );
  }
  const normalizedPath = normalizeAuthorityPath(path);
  const authorityPathItem = Object.entries(authorityDocument.paths ?? {}).find(
    ([authorityPath]) => normalizeAuthorityPath(authorityPath) === normalizedPath,
  )?.[1];
  const authorityOperation = authorityPathItem?.[method];
  if (!authorityOperation) {
    throw new Error(`[${file}] ${label} cites runtime authority "${authorityName}", which has no matching operation`);
  }
  const mismatches = [];
  compareOperationAgainstAuthority(current, authorityOperation, mismatches);
  if (mismatches.length > 0) {
    throw new Error(
      `[${file}] ${label} claims to correct against runtime authority "${authorityName}" (${sourceSha}), ` +
        `but does not actually match it:\n${mismatches.map((mismatch) => `  - ${mismatch}`).join("\n")}`,
    );
  }
  return true;
}

function loadRuntimeAuthorityBundle(authorityName) {
  if (runtimeAuthorityBundleCache.has(authorityName)) return runtimeAuthorityBundleCache.get(authorityName);
  const config = RUNTIME_AUTHORITIES.get(authorityName);
  const pin = JSON.parse(readFileSyncOrThrow(config.sourcePath));
  const snapshot = JSON.parse(readFileSyncOrThrow(config.openapiPath));
  const embedded = snapshot["x-codestra-source-authority"];
  if (
    embedded?.repository !== pin.repository ||
    embedded?.source_sha !== pin.source_sha ||
    embedded?.source_sha256 !== pin.source_sha256
  ) {
    throw new Error(
      `Vendored "${authorityName}" runtime snapshot (${config.openapiPath}) does not match its own pin ` +
        `(${config.sourcePath}); re-run scripts/import-${authorityName}-runtime-contract.mjs`,
    );
  }
  const bundled = bundle(config.openapiPath, join(workDir, `authority-${authorityName}.json`));
  if (!bundled) {
    throw new Error(`Vendored "${authorityName}" runtime snapshot at ${config.openapiPath} could not be bundled`);
  }
  const result = { pin, document: bundled };
  runtimeAuthorityBundleCache.set(authorityName, result);
  return result;
}

function normalizeAuthorityPath(path) {
  return path.replace(/\{[^}]+\}/gu, "{}");
}

/**
 * Deliberately shallower than compareSchema: this only needs to prove the
 * corrected operation matches ground truth, not perform general breaking-
 * change detection. Required-property sets must match exactly in both
 * directions (the correction should claim neither more nor less than the
 * authority actually guarantees/requires); a property current declares
 * must exist on the authority (current cannot invent fields), but the
 * authority may have optional fields current doesn't bother to model.
 */
function compareOperationAgainstAuthority(current, authority, output) {
  const currentSuccess = new Set(Object.keys(current.responses ?? {}).filter((status) => /^2/u.test(status)));
  const authoritySuccess = new Set(Object.keys(authority.responses ?? {}).filter((status) => /^2/u.test(status)));
  for (const status of authoritySuccess) {
    if (!currentSuccess.has(status)) output.push(`missing success response ${status} (the runtime authority uses it)`);
  }
  for (const status of currentSuccess) {
    if (!authoritySuccess.has(status)) output.push(`declares success response ${status}, but the runtime authority does not use it`);
  }
  for (const status of [...currentSuccess].filter((entry) => authoritySuccess.has(entry))) {
    compareSchemaAgainstAuthority(
      `responses.${status}`,
      current.responses[status]?.content?.["application/json"]?.schema,
      authority.responses[status]?.content?.["application/json"]?.schema,
      output,
    );
  }

  const currentBodySchema = current.requestBody?.content?.["application/json"]?.schema;
  const authorityBodySchema = authority.requestBody?.content?.["application/json"]?.schema;
  if (Boolean(currentBodySchema) !== Boolean(authorityBodySchema)) {
    output.push("request body presence differs from the runtime authority");
  } else if (currentBodySchema && authorityBodySchema) {
    compareSchemaAgainstAuthority("requestBody", currentBodySchema, authorityBodySchema, output);
  }

  // Path parameter names are local identifiers, not wire values -- the URL
  // template's {} position is what has to line up, not the literal name
  // (our "campaignId" vs. the authority's "campaign_id" is not a mismatch).
  const parameterKey = (parameter) => (parameter.in === "path" ? "path:{}" : `${parameter.in}:${parameter.name.toLowerCase()}`);
  const currentParams = new Map((current.parameters ?? []).map((parameter) => [parameterKey(parameter), parameter]));
  const authorityParams = new Map((authority.parameters ?? []).map((parameter) => [parameterKey(parameter), parameter]));
  const requiredCurrent = new Set([...currentParams.entries()].filter(([, parameter]) => parameter.required).map(([key]) => key));
  const requiredAuthority = new Set([...authorityParams.entries()].filter(([, parameter]) => parameter.required).map(([key]) => key));
  for (const key of requiredAuthority) {
    if (!requiredCurrent.has(key)) output.push(`does not require parameter ${key}, but the runtime authority does`);
  }
  for (const key of requiredCurrent) {
    if (!requiredAuthority.has(key)) output.push(`requires parameter ${key}, but the runtime authority does not`);
  }
}

function compareSchemaAgainstAuthority(path, current, authority, output, depth = 0) {
  if (depth > 16) {
    output.push(`${path} exceeds the authority comparison depth`);
    return;
  }
  if (!current || !authority) {
    if (Boolean(current) !== Boolean(authority)) output.push(`${path} presence differs from the runtime authority`);
    return;
  }
  const currentFlat = flattenComposedSchema(current);
  const authorityFlat = flattenComposedSchema(authority);
  const currentType = normalizeTypeForAuthority(current, currentFlat);
  const authorityType = normalizeTypeForAuthority(authority, authorityFlat);
  if (currentType && authorityType && currentType !== authorityType) {
    output.push(`${path} type is ${currentType}, but the runtime authority declares ${authorityType}`);
  }
  for (const property of authorityFlat.required) {
    if (!currentFlat.required.has(property)) output.push(`${path} does not require ${property}, but the runtime authority does`);
  }
  for (const property of currentFlat.required) {
    if (!authorityFlat.required.has(property)) output.push(`${path} requires ${property}, but the runtime authority does not`);
  }
  for (const property of Object.keys(currentFlat.properties)) {
    if (!(property in authorityFlat.properties)) output.push(`${path}.${property} does not exist on the runtime authority`);
  }
  if (current.items && authority.items) {
    compareSchemaAgainstAuthority(`${path}[]`, current.items, authority.items, output, depth + 1);
  }
}

function normalizeTypeForAuthority(schema, flat) {
  const type = schema.type ?? (Object.keys(flat.properties).length > 0 ? "object" : undefined);
  return Array.isArray(type) ? [...type].sort().join(",") : type;
}

function diffAsyncApi(file, base, current, output) {
  for (const [channelName, baseChannel] of Object.entries(base.channels ?? {})) {
    const currentChannel = current.channels?.[channelName];
    if (!currentChannel) {
      output.push(`[${file}] removed channel: ${channelName}`);
      continue;
    }
    for (const [messageName, baseMessage] of Object.entries(baseChannel.messages ?? {})) {
      const currentMessage = currentChannel.messages?.[messageName];
      if (!currentMessage) {
        output.push(`[${file}] removed message ${messageName} on channel ${channelName}`);
        continue;
      }
      if (baseMessage.payload && currentMessage.payload) {
        compareSchema(`channel ${channelName} message ${messageName} payload`, baseMessage.payload, currentMessage.payload, output, file);
      }
    }
  }
  for (const operationName of Object.keys(base.operations ?? {})) {
    if (!current.operations?.[operationName]) output.push(`[${file}] removed operation: ${operationName}`);
  }
}

/**
 * Flattens allOf composition into a single merged {properties, required}
 * view -- valid because every allOf branch's constraints apply
 * simultaneously. oneOf/anyOf are deliberately NOT flattened here: they
 * are alternatives, not a union, so merging them the same way as allOf
 * would erase which branch is which -- e.g. a `oneOf [receiptSchema,
 * {type: "null"}]` response would flatten to just receiptSchema's
 * properties, silently accepting the removal of the null alternative
 * (making the response no longer nullable) as a no-op. See
 * compareAlternatives, which handles oneOf/anyOf on their own terms.
 */
function flattenComposedSchema(schema, properties = {}, required = new Set()) {
  if (!schema || typeof schema !== "object") return { properties, required };
  for (const [name, definition] of Object.entries(schema.properties ?? {})) properties[name] = definition;
  for (const name of schema.required ?? []) required.add(name);
  for (const branch of schema.allOf ?? []) {
    flattenComposedSchema(branch, properties, required);
  }
  return { properties, required };
}

/**
 * oneOf/anyOf branches are alternatives: each base branch must still have
 * a structurally equivalent branch on the current side, or a valid shape
 * that used to be accepted no longer is (e.g. removing a `{type: "null"}`
 * branch means the field is no longer nullable). Branches are matched by
 * a coarse signature (type/const/required keys) rather than deep
 * equality -- enough to catch a branch disappearing outright without
 * needing full JSON Schema equivalence.
 */
function compareAlternatives(path, keyword, beforeBranches, afterBranches, output, file) {
  if (!Array.isArray(beforeBranches) || !Array.isArray(afterBranches)) return;
  const afterSignatures = new Set(afterBranches.map(branchSignature));
  for (const branch of beforeBranches) {
    if (!afterSignatures.has(branchSignature(branch))) {
      output.push(`[${file}] removed ${keyword} alternative at ${path}: ${branchSignature(branch)}`);
    }
  }
}

function branchSignature(branch) {
  if (!branch || typeof branch !== "object") return JSON.stringify(branch);
  return JSON.stringify({
    type: branch.type,
    const: branch.const,
    required: Array.isArray(branch.required) ? [...branch.required].sort() : undefined,
  });
}

function compareSchema(path, before, after, output, file) {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return;

  if (before.type !== undefined && after.type !== undefined && !typesEquivalent(before.type, after.type)) {
    if (!isPinnedRuntimeNullabilityCorrection(before, after)) {
      output.push(`[${file}] type changed at ${path}: ${JSON.stringify(before.type)} -> ${JSON.stringify(after.type)}`);
    }
  }
  if (before.format !== undefined && after.format !== undefined && before.format !== after.format) {
    output.push(`[${file}] format changed at ${path}: ${before.format} -> ${after.format}`);
  }
  if (before.additionalProperties !== false && after.additionalProperties === false) {
    output.push(`[${file}] additionalProperties newly restricted to false at ${path}`);
  }

  compareTightenedBound(path, "minLength", before, after, output, file, (b, a) => a > b);
  compareTightenedBound(path, "maxLength", before, after, output, file, (b, a) => a < b);
  compareTightenedBound(path, "minimum", before, after, output, file, (b, a) => a > b);
  compareTightenedBound(path, "maximum", before, after, output, file, (b, a) => a < b);
  if (after.pattern !== undefined && after.pattern !== before.pattern) {
    output.push(`[${file}] pattern ${before.pattern === undefined ? "added" : "changed"} at ${path}: ${JSON.stringify(before.pattern)} -> ${JSON.stringify(after.pattern)}`);
  }

  const beforeEnum = Array.isArray(before.enum) ? before.enum : undefined;
  const afterEnum = Array.isArray(after.enum) ? after.enum : undefined;
  if (beforeEnum && afterEnum) {
    for (const value of beforeEnum) {
      if (!afterEnum.includes(value)) output.push(`[${file}] removed enum value ${JSON.stringify(value)} at ${path}`);
    }
  }

  const beforeFlat = flattenComposedSchema(before);
  const afterFlat = flattenComposedSchema(after);
  for (const [property, definition] of Object.entries(beforeFlat.properties)) {
    if (!(property in afterFlat.properties)) output.push(`[${file}] removed property ${path}.${property}`);
    else compareSchema(`${path}.${property}`, definition, afterFlat.properties[property], output, file);
  }
  for (const property of afterFlat.required) {
    if (!beforeFlat.required.has(property)) output.push(`[${file}] new required property ${path}.${property}`);
  }

  compareAlternatives(path, "oneOf", before.oneOf, after.oneOf, output, file);
  compareAlternatives(path, "anyOf", before.anyOf, after.anyOf, output, file);

  if (before.items && after.items) compareSchema(`${path}[]`, before.items, after.items, output, file);
}

function isPinnedRuntimeNullabilityCorrection(before, after) {
  const authoritySha = after["x-codestra-corrects-runtime-nullability"];
  if (!/^[0-9a-f]{40}$/u.test(authoritySha ?? "")) return false;
  const authority = JSON.parse(readFileSyncOrThrow("contracts/middleware-runtime-current.source.json"));
  if (authority.source_sha !== authoritySha) return false;
  const beforeTypes = Array.isArray(before.type) ? before.type : [before.type];
  const afterTypes = Array.isArray(after.type) ? after.type : [after.type];
  return (
    !beforeTypes.includes("null") &&
    afterTypes.includes("null") &&
    beforeTypes.every((type) => afterTypes.includes(type)) &&
    afterTypes.every((type) => type === "null" || beforeTypes.includes(type))
  );
}

/**
 * A previously valid value can stop validating if a numeric/length bound is
 * tightened (e.g. minLength raised, maximum lowered) -- or if the bound is
 * newly introduced where none existed before, which is tightening from
 * "unconstrained" to "constrained". `isTighter(before, after)` decides
 * which direction counts as tightening for the given keyword.
 */
function compareTightenedBound(path, keyword, before, after, output, file, isTighter) {
  const beforeValue = before[keyword];
  const afterValue = after[keyword];
  if (afterValue === undefined) return;
  if (beforeValue === undefined) {
    output.push(`[${file}] ${keyword} newly introduced at ${path}: ${afterValue}`);
    return;
  }
  if (isTighter(beforeValue, afterValue)) {
    output.push(`[${file}] ${keyword} tightened at ${path}: ${beforeValue} -> ${afterValue}`);
  }
}

function typesEquivalent(before, after) {
  const normalize = (value) => (Array.isArray(value) ? [...value].sort() : [value]);
  const a = normalize(before);
  const b = normalize(after);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

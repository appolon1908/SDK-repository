import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

/**
 * Negative-fixture proof that scripts/check-contract-drift.mjs actually
 * catches breaking changes -- specifically the classes of change that
 * only became detectable once the script started fully dereferencing
 * `$ref` before diffing (see check-contract-drift.mjs's own doc comment).
 * Mirrors test-contract-validator.mjs's pattern: temporarily corrupt a
 * real file, prove the gate rejects it, always restore the original
 * content in a finally block.
 */

const cases = [
  {
    name: "a shared, $ref'd parameter tightened from optional to required",
    file: "contracts/openapi/codestra-public.openapi.yaml",
    corrupt: (text) =>
      text.replace(
        "    CorrelationId:\n      name: X-Correlation-Id\n      in: header\n      required: false",
        "    CorrelationId:\n      name: X-Correlation-Id\n      in: header\n      required: true",
      ),
    expectedSubstring: "became required",
  },
  {
    name: "a new required property on an externally-$ref'd AsyncAPI message payload",
    file: "contracts/schemas/events/social-post-status.schema.json",
    corrupt: (text) => text.replace('"occurredAt"],', '"occurredAt", "newlyRequiredField"],'),
    expectedSubstring: "new required property",
  },
  {
    // Codex review finding on PR #46: flattening oneOf/anyOf branches the
    // same way as allOf silently discarded which alternative was removed.
    name: "the null alternative removed from a oneOf, leaving the response no longer nullable",
    file: "contracts/openapi/codestra-restricted-gateway.openapi.yaml",
    corrupt: (text) =>
      text.replace(
        "        result:\n          oneOf:\n            - $ref: '#/components/schemas/RestrictedGatewayCommandReceipt'\n            - type: 'null'",
        "        result:\n          oneOf:\n            - $ref: '#/components/schemas/RestrictedGatewayCommandReceipt'",
      ),
    expectedSubstring: "removed oneOf alternative",
  },
  {
    // Codex review finding on PR #46: only operation-level `security` was
    // compared, but no operation in any of these contracts declares it --
    // every operation inherits the document root's, so this was always a
    // comparison of two empty arrays until the root was threaded through.
    name: "the document root's inherited security requirement swapped for an incompatible one",
    file: "contracts/openapi/codestra-public.openapi.yaml",
    corrupt: (text) => text.replace("security:\n  - oidc: []", "security:\n  - serviceBearer: []"),
    expectedSubstring: "removed previously satisfiable security alternative",
  },
  {
    // Codex review finding on PR #47: the parameter-diff loop only ever
    // iterated base.parameters, so a brand-new parameter on the current
    // side -- one no existing generated client could possibly send --
    // was invisible to the check whenever it was marked required.
    name: "a brand-new required parameter with no equivalent in the base contract",
    file: "contracts/openapi/codestra-public.openapi.yaml",
    corrupt: (text) =>
      text.replace(
        "        - $ref: '#/components/parameters/CorrelationId'\n        - name: cursor",
        "        - $ref: '#/components/parameters/CorrelationId'\n        - name: newRequiredThing\n          in: query\n          required: true\n          schema: { type: string }\n        - name: cursor",
      ),
    expectedSubstring: "new required parameter",
  },
  {
    name: "an arbitrary required header cannot evade drift detection with a transport marker",
    file: "contracts/openapi/codestra-public.openapi.yaml",
    corrupt: (text) =>
      text.replace(
        "        - $ref: '#/components/parameters/CorrelationId'\n        - name: cursor",
        "        - $ref: '#/components/parameters/CorrelationId'\n        - name: X-Unreviewed-Required\n          in: header\n          required: true\n          x-codestra-sdk-transport-injected: true\n          schema: { type: string }\n        - name: cursor",
      ),
    expectedSubstring: "new required parameter",
  },
  {
    // Codex review finding on PR #48: OpenAPI permits `parameters` on the
    // Path Item Object (a sibling of get/post/etc.), applying to every
    // operation under that path -- diffOperation only ever saw
    // operation-level parameters, so a new required one declared at the
    // path-item level was invisible even though it's valid OpenAPI no
    // existing generated client could satisfy.
    name: "a brand-new required parameter declared at the path-item level, not the operation level",
    file: "contracts/openapi/codestra-public.openapi.yaml",
    corrupt: (text) =>
      text.replace(
        "  /v1/social/posts/{postId}:\n    get:\n      operationId: getSocialPost",
        "  /v1/social/posts/{postId}:\n    parameters:\n      - name: newPathLevelRequired\n        in: query\n        required: true\n        schema: { type: string }\n    get:\n      operationId: getSocialPost",
      ),
    expectedSubstring: "new required parameter",
  },
  {
    // Codex review finding on the main-into-development reconciliation PR
    // (#54): OPENAPI_FILES omitted the communications, operations-dashboard,
    // and control-plane contracts even though validate-contracts.mjs treats
    // all three as canonical -- a breaking change to any of them would have
    // passed this gate silently. Corrupting the communications contract
    // (one of the three) proves it is now actually diffed.
    name: "a new required property on the communications contract, previously omitted from the drift gate entirely",
    file: "contracts/openapi/codestra-communications.openapi.yaml",
    corrupt: (text) => text.replace("required: [channel, to, content]", "required: [channel, to, content, newlyRequiredField]"),
    expectedSubstring: "new required property",
  },
  {
    // Codex review finding on #54: an operation with no requestBody at all
    // has every existing caller sending none. diffOperation only compared
    // requestBody.required when the base side already had a requestBody --
    // a current side that adds one and marks it required broke every such
    // caller identically to an optional body becoming required, but was
    // invisible because the `if (baseBody)` branch never ran.
    name: "a brand-new required request body on an operation that previously had none",
    file: "contracts/openapi/codestra-public.openapi.yaml",
    corrupt: (text) =>
      text.replace(
        "      operationId: getSocialPost\n      summary: Read one tenant-owned social post\n      parameters:",
        "      operationId: getSocialPost\n      summary: Read one tenant-owned social post\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: { type: object }\n      parameters:",
      ),
    expectedSubstring: "new required request body",
  },
  {
    // Codex review finding on #54: compareSchema checked type/format/enum
    // but not tightened scalar bounds -- raising minLength on a shared,
    // $ref'd parameter schema silently passed even though previously valid
    // requests (using the old, shorter minimum) would now be rejected.
    name: "minLength raised on a shared, $ref'd parameter schema",
    file: "contracts/openapi/codestra-public.openapi.yaml",
    corrupt: (text) =>
      text.replace(
        "    CorrelationId:\n      name: X-Correlation-Id\n      in: header\n      required: false\n      schema: { type: string, minLength: 8, maxLength: 128 }",
        "    CorrelationId:\n      name: X-Correlation-Id\n      in: header\n      required: false\n      schema: { type: string, minLength: 9, maxLength: 128 }",
      ),
    expectedSubstring: "minLength tightened",
  },
  {
    // Codex review finding on #54: the top-level `security` array lists
    // alternatives (any one satisfies the requirement), but diffOperation
    // only ever reported schemes newly present on the current side. An
    // operation-level override that replaces the only inherited alternative
    // (oidc, from the document root) with an incompatible one locks out
    // every caller authenticating via oidc, but the previous
    // one-directional check saw nothing to report.
    //
    // (An earlier version of this fixture instead overrode with `security:
    // []` -- weakening to no auth at all. Codex review on #68 correctly
    // flagged that a *conjunctive* removal like that is not what "removed
    // alternative" should mean, and pointed out that dropping to no auth
    // doesn't lock out any caller who already held the old credential, so
    // it isn't actually breaking. Replaced with a real incompatible swap.)
    name: "an operation-level security override that replaces the only inherited alternative with an incompatible one",
    file: "contracts/openapi/codestra-public.openapi.yaml",
    corrupt: (text) =>
      text.replace(
        "      operationId: getSocialPost\n      summary: Read one tenant-owned social post\n      parameters:",
        "      operationId: getSocialPost\n      summary: Read one tenant-owned social post\n      security:\n        - serviceBearer: []\n      parameters:",
      ),
    expectedSubstring: "removed previously satisfiable security alternative",
  },
  {
    // Proves codestra-platform.openapi.yaml (the auth/marketing/ai/crm/
    // workflow contract added to close the previously-uncontracted routes
    // gap) is itself covered by this gate, the same way the communications
    // fixture above proves that file is covered.
    name: "a new required property on the platform contract",
    file: "contracts/openapi/codestra-platform.openapi.yaml",
    corrupt: (text) => text.replace("required: [id, tenantId, status, createdAt, updatedAt]", "required: [id, tenantId, status, createdAt, updatedAt, newlyRequiredField]"),
    expectedSubstring: "new required property",
  },
  {
    name: "a runtime-nullability correction cannot cite an unpinned authority",
    file: "contracts/openapi/codestra-communications.openapi.yaml",
    corrupt: (text) =>
      text.replace(
        "        messageId: { type: string, format: uuid }\n        tenantId: { type: string }",
        "        messageId: { type: string, format: uuid }\n        tenantId:\n          type: [string, 'null']\n          x-codestra-corrects-runtime-nullability: 0000000000000000000000000000000000000000",
      ),
    expectedSubstring: "type changed",
  },
  {
    // Proves the vendored-runtime-authority correction escape hatch (added
    // to fix /v1/ai/generate and /v1/marketing/campaigns, which were
    // invented before the real Codestra-AI/Codestra-Marketing- contracts
    // were available and didn't match them) actually cross-checks the
    // claim instead of trusting the annotation. A citation whose shape
    // doesn't match the pinned authority must still be rejected as
    // breaking drift, not silently waved through.
    name: "a runtime-authority correction that doesn't actually match its cited authority",
    file: "contracts/openapi/codestra-platform.openapi.yaml",
    corrupt: (text) => text.replace("required: [task, input]", "required: [task]"),
    expectedSubstring: "does not actually match it",
  },
  {
    name: "a runtime-authority correction citing a sourceSha other than the one actually vendored",
    file: "contracts/openapi/codestra-platform.openapi.yaml",
    corrupt: (text) =>
      text.replace(
        "authority: ai\n        sourceSha: 7d31ef8de1c15bcc71b61de50917c81e3bcf557d",
        // A run of hex digits is deliberate: an all-numeric 40-char value
        // would parse as a YAML number, not a string, and fail this
        // fixture's own /^[0-9a-f]{40}$/ format check before ever reaching
        // the "is pinned to" comparison this fixture means to exercise.
        "authority: ai\n        sourceSha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    expectedSubstring: "is pinned to",
  },
];

const failures = [];

for (const testCase of cases) {
  const original = await readFile(testCase.file, "utf8");
  const corrupted = testCase.corrupt(original);
  if (corrupted === original) {
    failures.push(`${testCase.name}: fixture's corrupt() did not change the file -- test is broken`);
    continue;
  }
  try {
    await writeFile(testCase.file, corrupted);
    const result = runDrift();
    if (result.status === 0) {
      failures.push(`${testCase.name}: breaking change was incorrectly accepted`);
    } else if (!result.output.includes(testCase.expectedSubstring)) {
      failures.push(`${testCase.name}: rejected, but without the expected finding ("${testCase.expectedSubstring}"). Got:\n${result.output}`);
    } else {
      console.log(`Rejected negative fixture: ${testCase.name}`);
    }
  } finally {
    await writeFile(testCase.file, original);
  }
}

// And the positive control: the real, unmodified working tree against its
// own HEAD must be clean. If this fails, either a real breaking change is
// unmerged or the two cases above failed to restore their file.
const clean = runDrift();
if (clean.status !== 0) {
  failures.push(`unmodified working tree against HEAD was rejected (should be clean):\n${clean.output}`);
} else {
  console.log("Confirmed the unmodified working tree is clean against HEAD.");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Contract drift detector negative fixtures passed.");

function runDrift() {
  const result = spawnSync(process.execPath, ["scripts/check-contract-drift.mjs", "HEAD"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return { status: result.status, output: [result.stdout, result.stderr].filter(Boolean).join("\n") };
}

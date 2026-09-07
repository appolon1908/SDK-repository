import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "codestra-workflow-policy-"));
const validator = new URL("./validate-workflow-policy.mjs", import.meta.url);

async function evaluate(name, workflow, expectedFragment) {
  await writeFile(join(directory, `${name}.yml`), workflow, "utf8");
  const result = spawnSync(process.execPath, [validator.pathname], {
    encoding: "utf8",
    env: { ...process.env, WORKFLOW_DIRECTORY: directory },
  });
  await rm(join(directory, `${name}.yml`));
  if (expectedFragment === null ? result.status !== 0 :
      result.status === 0 || !result.stderr.includes(expectedFragment)) {
    throw new Error(`${name} did not fail closed: ${result.stdout}${result.stderr}`);
  }
}

async function evaluateLocalAction(name, actionManifest, expectedFragment) {
  const actionDirectory = join(directory, ".github", "actions", name);
  await mkdir(actionDirectory, { recursive: true });
  await writeFile(join(actionDirectory, "action.yml"), actionManifest, "utf8");
  const workflow = "on: [pull_request]\npermissions: {contents: read}\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n" +
    `      - uses: ./.github/actions/${name}\n`;
  await writeFile(join(directory, `${name}.yml`), workflow, "utf8");
  const result = spawnSync(process.execPath, [validator.pathname], {
    encoding: "utf8",
    cwd: directory,
    env: { ...process.env, WORKFLOW_DIRECTORY: directory },
  });
  await rm(join(directory, `${name}.yml`));
  await rm(join(directory, ".github"), { recursive: true, force: true });
  if (expectedFragment === null ? result.status !== 0 :
      result.status === 0 || !result.stderr.includes(expectedFragment)) {
    throw new Error(`${name} did not fail closed: ${result.stdout}${result.stderr}`);
  }
}

try {
  const prefix = "on: [pull_request]\npermissions: {contents: read}\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n";
  await evaluate("mutable-action", `${prefix}      - uses: actions/checkout@v4\n        with: {persist-credentials: false}\n`, "full commit SHA");
  await evaluate("write-permission", "on: [pull_request]\npermissions: {contents: read}\njobs:\n  test:\n    permissions: {contents: write}\n    runs-on: ubuntu-24.04\n    steps: []\n", "contents: write");
  await evaluate("write-all-permission", "on: [pull_request]\npermissions: {contents: read}\njobs:\n  test:\n    permissions: write-all\n    runs-on: ubuntu-24.04\n    steps: []\n", "write-all");
  const reusablePrefix = "on: [pull_request]\npermissions: {contents: read}\njobs:\n  test:\n    permissions: read-all\n    uses: ";
  await evaluate("mutable-reusable-workflow", `${reusablePrefix}owner/repo/.github/workflows/build.yml@main\n`, "full commit SHA");
  await evaluate("tagged-reusable-workflow", `${reusablePrefix}owner/repo/.github/workflows/build.yml@v1\n`, "full commit SHA");
  await evaluate("short-reusable-workflow-sha", `${reusablePrefix}owner/repo/.github/workflows/build.yml@1234567\n`, "full commit SHA");
  await evaluate("pinned-reusable-workflow", `${reusablePrefix}owner/repo/.github/workflows/build.yml@${"a".repeat(40)}\n`, null);
  await evaluate("local-reusable-workflow", `${reusablePrefix}./.github/workflows/build.yml\n`, null);
  await evaluate("source-push", `${prefix}      - run: git push origin HEAD\n`, "source or publication mutation");
  await evaluate("source-push-with-global-option", `${prefix}      - run: git -C . push origin HEAD\n`, "source or publication mutation");
  await evaluate(
    "mutable-container-image",
    "on: [pull_request]\npermissions: {contents: read}\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    container: node:latest\n    steps: []\n",
    "immutable digest",
  );
  await evaluate(
    "pinned-container-image",
    `on: [pull_request]\npermissions: {contents: read}\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    container: node@sha256:${"a".repeat(64)}\n    steps: []\n`,
    null,
  );
  await evaluate(
    "mutable-service-image",
    "on: [pull_request]\npermissions: {contents: read}\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    services:\n      redis:\n        image: redis:latest\n    steps: []\n",
    "immutable digest",
  );
  await evaluateLocalAction(
    "mutable-nested-dependency",
    "runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v4\n",
    "full commit SHA",
  );
  await evaluateLocalAction(
    "pinned-nested-dependency",
    `runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@${"a".repeat(40)}\n`,
    null,
  );
  await evaluateLocalAction(
    "nested-source-push",
    `runs:\n  using: composite\n  steps:\n    - run: git push origin HEAD\n      shell: bash\n`,
    "source or publication mutation",
  );
  console.log("Workflow policy positive and negative fixtures passed.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

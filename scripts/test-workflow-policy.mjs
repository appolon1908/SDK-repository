import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  if (result.status === 0 || !result.stderr.includes(expectedFragment)) {
    throw new Error(`${name} did not fail closed: ${result.stdout}${result.stderr}`);
  }
}

try {
  const prefix = "on: [pull_request]\npermissions: {contents: read}\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n";
  await evaluate("mutable-action", `${prefix}      - uses: actions/checkout@v4\n        with: {persist-credentials: false}\n`, "full commit SHA");
  await evaluate("write-permission", "on: [pull_request]\npermissions: {contents: read}\njobs:\n  test:\n    permissions: {contents: write}\n    runs-on: ubuntu-24.04\n    steps: []\n", "contents: write");
  await evaluate("source-push", `${prefix}      - run: git push origin HEAD\n`, "source or publication mutation");
  console.log("Workflow policy negative fixtures passed.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

import { readdir, readFile } from "node:fs/promises";
import { parse } from "yaml";

const directory = process.env.WORKFLOW_DIRECTORY ?? ".github/workflows";
const files = (await readdir(directory)).filter((name) => /\.ya?ml$/u.test(name));
const failures = [];

for (const file of files) {
  const path = `${directory}/${file}`;
  const document = parse(await readFile(path, "utf8"));
  const triggers = document.on;
  const triggerNames = typeof triggers === "string"
    ? [triggers]
    : Array.isArray(triggers)
      ? triggers
      : Object.keys(triggers ?? {});
  if (triggerNames.includes("pull_request_target")) failures.push(`${path}: pull_request_target is forbidden`);
  const isPullRequest = triggerNames.includes("pull_request");
  const permissions = document.permissions ?? {};
  if (permissions === "write-all") failures.push(`${path}: write-all permissions are forbidden`);
  if (typeof permissions === "object") {
    for (const [scope, level] of Object.entries(permissions)) {
      if (level === "write") failures.push(`${path}: top-level ${scope}: write is forbidden`);
    }
  }

  for (const [jobName, job] of Object.entries(document.jobs ?? {})) {
    const runner = JSON.stringify(job["runs-on"] ?? "");
    if (isPullRequest && runner.includes("self-hosted")) {
      failures.push(`${path}:${jobName}: pull request jobs must use GitHub-hosted runners`);
    }
    if (isPullRequest && job.environment !== undefined) {
      failures.push(`${path}:${jobName}: pull request jobs must not use environments`);
    }
    if (isPullRequest && JSON.stringify(job).includes("secrets.")) {
      failures.push(`${path}:${jobName}: pull request jobs must not consume secrets`);
    }
    const jobPermissions = job.permissions ?? {};
    if (isPullRequest && typeof jobPermissions === "object") {
      for (const [scope, level] of Object.entries(jobPermissions)) {
        if (level === "write") failures.push(`${path}:${jobName}: pull request ${scope}: write is forbidden`);
      }
    }
    for (const step of job.steps ?? []) {
      if (typeof step.uses === "string" && !step.uses.startsWith("./") &&
          !/@[0-9a-f]{40}$/u.test(step.uses)) {
        failures.push(`${path}:${jobName}: third-party action must use a full commit SHA: ${step.uses}`);
      }
      if (typeof step.uses === "string" && step.uses.startsWith("actions/checkout@")) {
        if (step.with?.["persist-credentials"] !== false) {
          failures.push(`${path}:${jobName}: checkout must set persist-credentials: false`);
        }
      }
      if (isPullRequest && typeof step.run === "string" &&
          /(^|[;&|\n]\s*)(git\s+push|gh\s+(pr|release)\s+|npm\s+publish|pnpm\s+publish)(\s|$)/u.test(step.run)) {
        failures.push(`${path}:${jobName}: pull request workflow contains a source or publication mutation`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Validated workflow policy for ${files.length} workflow(s).`);

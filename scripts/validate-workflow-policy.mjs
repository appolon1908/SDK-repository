import { readdir, readFile } from "node:fs/promises";
import { parse } from "yaml";

const directory = process.env.WORKFLOW_DIRECTORY ?? ".github/workflows";
const files = (await readdir(directory)).filter((name) => /\.ya?ml$/u.test(name));
const failures = [];

const SHA_PIN = /@[0-9a-f]{40}$/u;
const IMMUTABLE_DIGEST = /@sha256:[0-9a-f]{64}$/u;
const MUTATION_PATTERN =
  /(^|[;&|\n]\s*)(git(?:\s+-{1,2}[\w-]+(?:[= ]\S+)?)*\s+push|gh\s+(pr|release)\s+|npm\s+publish|pnpm\s+publish)(\s|$)/u;

function isImmutableContainerImage(image) {
  return typeof image === "string" && IMMUTABLE_DIGEST.test(image);
}

function containerImageOf(container) {
  if (typeof container === "string") return container;
  if (container && typeof container === "object") return container.image;
  return undefined;
}

async function validateLocalAction(actionPath, path, jobName, isPullRequest, visited = new Set()) {
  if (visited.has(actionPath)) return;
  visited.add(actionPath);

  let manifestPath = `${actionPath}/action.yml`;
  let manifestText;
  try {
    manifestText = await readFile(manifestPath, "utf8");
  } catch {
    manifestPath = `${actionPath}/action.yaml`;
    try {
      manifestText = await readFile(manifestPath, "utf8");
    } catch {
      failures.push(`${path}:${jobName}: local action manifest not found: ${actionPath}/action.yml`);
      return;
    }
  }

  const manifest = parse(manifestText);
  const using = manifest.runs?.using;
  if (using === "composite") {
    for (const step of manifest.runs.steps ?? []) {
      if (typeof step.uses === "string") {
        if (step.uses.startsWith("./")) {
          await validateLocalAction(step.uses, path, jobName, isPullRequest, visited);
        } else if (!SHA_PIN.test(step.uses)) {
          failures.push(`${manifestPath}: third-party action must use a full commit SHA: ${step.uses}`);
        }
      }
      if (isPullRequest && typeof step.run === "string" && MUTATION_PATTERN.test(step.run)) {
        failures.push(`${manifestPath}: local composite action contains a source or publication mutation`);
      }
    }
  } else if (using === "docker" && typeof manifest.runs.image === "string" &&
      manifest.runs.image.startsWith("docker://") && !isImmutableContainerImage(manifest.runs.image)) {
    failures.push(`${manifestPath}: docker action image must pin an immutable digest: ${manifest.runs.image}`);
  }
}

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
    if (isPullRequest && jobPermissions === "write-all") {
      failures.push(`${path}:${jobName}: pull request write-all permissions are forbidden`);
    }
    if (isPullRequest && typeof jobPermissions === "object") {
      for (const [scope, level] of Object.entries(jobPermissions)) {
        if (level === "write") failures.push(`${path}:${jobName}: pull request ${scope}: write is forbidden`);
      }
    }
    if (typeof job.uses === "string" && !job.uses.startsWith("./") &&
        !SHA_PIN.test(job.uses)) {
      failures.push(`${path}:${jobName}: reusable workflow must use a full commit SHA: ${job.uses}`);
    }

    const jobContainerImage = containerImageOf(job.container);
    if (jobContainerImage !== undefined && !isImmutableContainerImage(jobContainerImage)) {
      failures.push(`${path}:${jobName}: job container must pin an immutable digest: ${jobContainerImage}`);
    }
    for (const [serviceName, service] of Object.entries(job.services ?? {})) {
      const serviceImage = containerImageOf(service);
      if (serviceImage !== undefined && !isImmutableContainerImage(serviceImage)) {
        failures.push(`${path}:${jobName}:${serviceName}: service container must pin an immutable digest: ${serviceImage}`);
      }
    }

    for (const step of job.steps ?? []) {
      if (typeof step.uses === "string" && !step.uses.startsWith("./") &&
          !SHA_PIN.test(step.uses)) {
        failures.push(`${path}:${jobName}: third-party action must use a full commit SHA: ${step.uses}`);
      }
      if (typeof step.uses === "string" && step.uses.startsWith("./")) {
        await validateLocalAction(step.uses, path, jobName, isPullRequest);
      }
      if (typeof step.uses === "string" && step.uses.startsWith("actions/checkout@")) {
        if (step.with?.["persist-credentials"] !== false) {
          failures.push(`${path}:${jobName}: checkout must set persist-credentials: false`);
        }
      }
      if (isPullRequest && typeof step.run === "string" && MUTATION_PATTERN.test(step.run)) {
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

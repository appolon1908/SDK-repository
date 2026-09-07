import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [sourcePath] = process.argv.slice(2);
if (!sourcePath) {
  console.error("Usage: node scripts/import-marketing-runtime-contract.mjs <path-inside-marketing-checkout>");
  process.exit(2);
}

const authorityPath = process.env.MARKETING_RUNTIME_AUTHORITY ?? "contracts/vendor/marketing-runtime-current.source.json";
const outputPath = process.env.MARKETING_RUNTIME_CONTRACT ?? "contracts/vendor/marketing-runtime-current.openapi.json";
const authority = JSON.parse(await readFile(authorityPath, "utf8"));
const sourceRepository = git(["-C", dirname(sourcePath), "rev-parse", "--show-toplevel"]);
const sourceRevision = git(["-C", sourceRepository, "rev-parse", "HEAD"]);
const sourceRemote = git(["-C", sourceRepository, "remote", "get-url", "origin"])
  .replace(/\.git$/u, "")
  .replace(/^git@github\.com:/u, "https://github.com/");
if (sourceRevision !== authority.source_sha) {
  throw new Error(`Source checkout is ${sourceRevision}; expected ${authority.source_sha}.`);
}
if (sourceRemote.toLowerCase() !== authority.repository.toLowerCase()) {
  throw new Error(`Source checkout repository is ${sourceRemote}; expected ${authority.repository}.`);
}
const configuredSource = resolve(sourceRepository, authority.source_path);
if (!configuredSource.startsWith(`${resolve(sourceRepository)}/`)) {
  throw new Error("Configured Marketing source path escapes the source repository.");
}
const raw = git(["-C", sourceRepository, "show", `${authority.source_sha}:${authority.source_path}`]);
const document = JSON.parse(raw);

if (document.info?.title !== "Codestra Marketing API") throw new Error("Unexpected Marketing contract identity.");

const canonicalBytes = `${JSON.stringify(document, null, 2)}\n`;
const sourceSha256 = createHash("sha256").update(canonicalBytes).digest("hex");
if (sourceSha256 !== authority.source_sha256) {
  throw new Error(`Pinned Marketing blob digest is ${sourceSha256}; expected ${authority.source_sha256}.`);
}
document["x-codestra-source-authority"] = {
  repository: authority.repository,
  source_sha: authority.source_sha,
  source_path: authority.source_path,
  source_sha256: sourceSha256,
};

const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const operationCount = Object.values(document.paths ?? {}).reduce(
  (count, item) => count + Object.keys(item).filter((key) => methods.has(key)).length,
  0,
);

await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Imported ${operationCount} Marketing operations from ${authority.source_sha}.`);

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

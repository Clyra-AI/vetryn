import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const defaultRoot = path.resolve(import.meta.dirname, "..");
const schemaRef = "product/plans/schemas/semantic-risk-report-v0.2.schema.json";
const legacySchemaRef = "product/plans/schemas/semantic-risk-report-v0.1.schema.json";
const profileRef = ".factory/profile.yaml";
const timestampAjv = new Ajv2020({ strict: false });
addFormats(timestampAjv);
const validateRfc3339Timestamp = timestampAjv.compile({ type: "string", format: "date-time" });

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseRfc3339Timestamp(value, label) {
  assert(validateRfc3339Timestamp(value), `${label} must be an RFC 3339 timestamp`);
  return Date.parse(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function repoPath(root, relativePath, label) {
  assert(typeof relativePath === "string" && relativePath.length > 0, `${label} is required`);
  assert(!path.isAbsolute(relativePath), `${label} must be repository-relative`);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  assert(
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative),
    `${label} escapes the repository`,
  );
  return resolved;
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalRepoPath(root, relativePath, label) {
  const target = repoPath(root, relativePath, label);
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(target)]);
  assert(
    isWithinRoot(canonicalRoot, canonicalTarget),
    `${label} escapes the repository via symlink`,
  );
  return canonicalTarget;
}

function runGit(root, arguments_, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", root, ...arguments_], { encoding: "utf8" });
  if (!allowFailure && result.status !== 0)
    fail(`git ${arguments_.join(" ")} failed: ${result.stderr.trim()}`);
  return result;
}

async function readJson(root, relativePath, label = relativePath) {
  try {
    return JSON.parse(await readFile(await canonicalRepoPath(root, relativePath, label), "utf8"));
  } catch (error) {
    fail(
      `${label} is missing or invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseRepoRef(root, ref, label) {
  assert(typeof ref === "string" && ref.length > 0, `${label} is required`);
  assert(!ref.includes("#"), `${label} must identify one repository file`);
  const relativePath = ref;
  repoPath(root, relativePath, label);
  return relativePath;
}

function readBlobAtCommit(root, commit, ref, label) {
  const relativePath = parseRepoRef(root, ref, label);
  const result = spawnSync("git", ["-C", root, "show", `${commit}:${relativePath}`]);
  assert(result.status === 0, `${label} is unavailable at candidate ${commit}`);
  return result.stdout;
}

function readJsonAtCommit(root, commit, ref, label) {
  const bytes = readBlobAtCommit(root, commit, ref, label);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label} is not valid JSON at candidate ${commit}`);
  }
  return { value: document, bytes };
}

async function writeJsonAtomic(root, relativePath, value) {
  const target = repoPath(root, relativePath, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const [canonicalRoot, canonicalParent] = await Promise.all([
    realpath(root),
    realpath(path.dirname(target)),
  ]);
  assert(
    isWithinRoot(canonicalRoot, canonicalParent),
    `${relativePath} escapes the repository via symlink`,
  );
  const safeTarget = path.join(canonicalParent, path.basename(target));
  const temporary = `${safeTarget}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, safeTarget);
}

function semanticContent(report) {
  const content = { ...report };
  delete content.baseline_evidence;
  return content;
}

function validateReportSchema(schema, legacySchema, report, label) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(
    legacySchema,
    "https://clyra.ai/factory/schemas/artifacts/semantic-risk-report-v0.1.schema.json",
  );
  const validate = ajv.compile(schema);
  assert(
    validate(report),
    `${label} does not match the pinned semantic-risk schema: ${(validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ")}`,
  );
}

export function semanticRiskRefs(taskId) {
  return {
    reportRef: `.factory/artifacts/task-runs/${taskId}/semantic-risk-report.json`,
    integrityMarkerRef: `.factory/artifacts/task-runs/${taskId}/semantic-risk-integrity-marker.json`,
  };
}

export async function validateSemanticRiskEvidence({ root = defaultRoot, packet }) {
  if (packet.risk_class === "low") return;
  const { reportRef, integrityMarkerRef } = semanticRiskRefs(packet.task_id);
  assert(
    packet.semantic_risk_report_ref === reportRef,
    "semantic-risk report target is not canonical",
  );
  assert(
    packet.semantic_risk_integrity_marker_ref === integrityMarkerRef,
    "semantic-risk integrity marker target is not canonical",
  );

  const candidateCommit = packet.currentState.candidate?.commit;
  assert(candidateCommit, "semantic-risk evidence requires a bound candidate");
  const schema = await readJson(root, schemaRef);
  const legacySchema = await readJson(root, legacySchemaRef);
  const { value: report } = readJsonAtCommit(
    root,
    candidateCommit,
    reportRef,
    "semantic-risk report",
  );
  const { value: marker, bytes: markerBytes } = readJsonAtCommit(
    root,
    candidateCommit,
    integrityMarkerRef,
    "semantic-risk integrity marker",
  );
  validateReportSchema(schema, legacySchema, report, reportRef);
  assert(
    report.task_id === packet.task_id,
    "semantic-risk report task_id does not match the packet",
  );
  assert(
    report.work_item_id === packet.task_id,
    "semantic-risk report work_item_id does not match the packet",
  );
  assert(
    report.risk_class === packet.risk_class,
    "semantic-risk report risk_class does not match the packet",
  );
  assert(
    report.profile_ref === profileRef,
    "semantic-risk report must bind the portable Factory profile",
  );
  assert(
    report.review_convergence.implementation_design_pass === "pass" &&
      report.review_convergence.decision === "proceed",
    "semantic-risk report blocks implementation",
  );
  assert(
    !(report.external_effect_preflight?.actions ?? []).some(
      (action) => action.disposition === "authorized",
    ),
    "repo-native semantic-risk evidence cannot authorize external actions",
  );
  assert(
    report.baseline_evidence.work_proof_marker_ref === integrityMarkerRef,
    "semantic-risk report cites a different integrity marker",
  );
  assert(
    report.baseline_evidence.work_proof_marker_sha256 === sha256(markerBytes),
    "semantic-risk report integrity marker digest is stale",
  );

  const expectedMarkerKeys = [
    "artifact_type",
    "authorized_task_bindings",
    "command",
    "execution_status",
    "exit_code",
    "finished_at",
    "git_sha",
    "schema_version",
    "started_at",
  ];
  assert(
    canonicalJson(Object.keys(marker).toSorted()) === canonicalJson(expectedMarkerKeys.toSorted()),
    "integrity marker contains unsupported or redundant fields",
  );

  assert(
    marker.artifact_type === "semantic_risk_integrity_marker",
    "integrity marker type is invalid",
  );
  assert(marker.schema_version === "0.2", "integrity marker schema version is invalid");
  assert(
    marker.command === `pnpm --silent semantic-risk:design -- ${packet.task_id}`,
    "integrity marker command is invalid",
  );
  assert(
    marker.execution_status === "pass" && marker.exit_code === 0,
    "semantic-risk design command did not pass",
  );
  assert(
    marker.git_sha === report.source_revision,
    "semantic-risk source revision differs from the integrity marker",
  );
  const startedAt = parseRfc3339Timestamp(marker.started_at, "integrity marker started_at");
  const finishedAt = parseRfc3339Timestamp(marker.finished_at, "integrity marker finished_at");
  const createdAt = Date.parse(report.created_at);
  assert(
    startedAt <= finishedAt && finishedAt <= createdAt,
    "integrity marker timestamps must satisfy started_at <= finished_at <= report created_at",
  );
  const expectedBinding = {
    task_id: packet.task_id,
    profile_ref: profileRef,
    semantic_risk_report_ref: reportRef,
    source_revision: report.source_revision,
    semantic_content_sha256: sha256(canonicalJson(semanticContent(report))),
    observed_changed_paths: [reportRef],
  };
  assert(
    canonicalJson(marker.authorized_task_bindings) === canonicalJson([expectedBinding]),
    "integrity marker does not bind the exact semantic-risk content and source",
  );
  assert(
    runGit(root, ["merge-base", "--is-ancestor", report.source_revision, candidateCommit], {
      allowFailure: true,
    }).status === 0,
    "semantic-risk source revision is not an ancestor of the candidate",
  );
}

function parseArguments(arguments_) {
  const [command, taskId, ...rest] = arguments_;
  assert(command === "design", "usage: semantic-risk.mjs design TASK-ID [--input PATH]");
  assert(/^(?:M0|V1)-\d{2}$/u.test(taskId ?? ""), "a valid task ID is required");
  let inputRef = `.factory/tmp/task-runs/${taskId}/semantic-risk-report.draft.json`;
  if (rest.length > 0) {
    assert(rest.length === 2 && rest[0] === "--input", "only --input PATH is supported");
    inputRef = rest[1];
  }
  return { taskId, inputRef };
}

async function design(root, taskId, inputRef) {
  const taskScript = path.join(import.meta.dirname, "task.mjs");
  const compiled = spawnSync(process.execPath, [taskScript, "compile", taskId], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, VETRYN_PLAN_REPO_ROOT: root },
  });
  assert(compiled.status === 0, `task compilation failed: ${compiled.stderr.trim()}`);
  const packet = JSON.parse(compiled.stdout);
  assert(packet.risk_class !== "low", `${taskId} does not require semantic-risk evidence`);
  const { reportRef, integrityMarkerRef } = semanticRiskRefs(taskId);
  assert(packet.semantic_risk_report_ref === reportRef, "compiled report target is not canonical");
  assert(
    packet.semantic_risk_integrity_marker_ref === integrityMarkerRef,
    "compiled marker target is not canonical",
  );

  const statusLines = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"])
    .stdout.split("\n")
    .filter(Boolean);
  const normalizedInput = path.relative(root, repoPath(root, inputRef, "draft input"));
  const allowedChanges = new Set([normalizedInput, reportRef, integrityMarkerRef]);
  const unexpected = statusLines.filter((line) => !allowedChanges.has(line.slice(3)));
  assert(
    unexpected.length === 0,
    `semantic-risk design requires a clean candidate snapshot; unexpected changes: ${unexpected.join(", ")}`,
  );
  const sourceRevision = runGit(root, ["rev-parse", "HEAD"]).stdout.trim();
  const draft = await readJson(root, inputRef, "semantic-risk draft");
  for (const generatedField of ["baseline_evidence", "created_at", "source_revision"])
    assert(
      !(generatedField in draft),
      `semantic-risk draft must omit generated field ${generatedField}`,
    );
  const startedAt = new Date().toISOString();
  const createdAt = new Date(Date.now() + 1).toISOString();
  const report = {
    ...draft,
    artifact_type: "semantic_risk_report",
    schema_version: "0.2",
    task_id: taskId,
    work_item_id: taskId,
    risk_class: packet.risk_class,
    profile_ref: profileRef,
    source_revision: sourceRevision,
    phase: "implementation_design",
    created_at: createdAt,
  };
  const semanticContentDigest = sha256(canonicalJson(semanticContent(report)));
  const marker = {
    artifact_type: "semantic_risk_integrity_marker",
    schema_version: "0.2",
    command: `pnpm --silent semantic-risk:design -- ${taskId}`,
    git_sha: sourceRevision,
    exit_code: 0,
    execution_status: "pass",
    started_at: startedAt,
    finished_at: createdAt,
    authorized_task_bindings: [
      {
        task_id: taskId,
        profile_ref: profileRef,
        semantic_risk_report_ref: reportRef,
        source_revision: sourceRevision,
        semantic_content_sha256: semanticContentDigest,
        observed_changed_paths: [reportRef],
      },
    ],
  };
  const markerBytes = Buffer.from(`${JSON.stringify(marker, null, 2)}\n`);
  report.baseline_evidence = {
    work_proof_marker_ref: integrityMarkerRef,
    work_proof_marker_sha256: sha256(markerBytes),
  };
  const schema = await readJson(root, schemaRef);
  const legacySchema = await readJson(root, legacySchemaRef);
  validateReportSchema(schema, legacySchema, report, reportRef);
  assert(
    report.review_convergence.implementation_design_pass === "pass" &&
      report.review_convergence.decision === "proceed",
    "semantic-risk draft does not authorize implementation",
  );
  assert(
    !(report.external_effect_preflight?.actions ?? []).some(
      (action) => action.disposition === "authorized",
    ),
    "repo-native semantic-risk design cannot authorize external actions",
  );
  await writeJsonAtomic(root, integrityMarkerRef, marker);
  await writeJsonAtomic(root, reportRef, report);
  process.stdout.write(
    `${JSON.stringify({ status: "pass", taskId, sourceRevision, reportRef, integrityMarkerRef }, null, 2)}\n`,
  );
}

async function main() {
  const root = path.resolve(process.env.VETRYN_PLAN_REPO_ROOT ?? defaultRoot);
  const { taskId, inputRef } = parseArguments(
    process.argv.slice(2).filter((argument) => argument !== "--"),
  );
  await design(root, taskId, inputRef);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });

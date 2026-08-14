import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const shaPattern = /^[0-9a-f]{40}$/u;
const taskPattern = /^(?:M0|V1)-[0-9]{2}$/u;
const planRoot = "product/plans/oss-v1";
const lifecycleNames = new Set([
  "work_proof_marker",
  "validation_report",
  "review_report",
  "trust_review_report",
  "github_review_evidence",
  "ship_packet",
  "pr_lifecycle_report",
  "post_merge_report",
  "canonical_promotion",
]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function git(root, arguments_, { binary = false } = {}) {
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", "-C", root, ...arguments_], {
    encoding: binary ? "buffer" : "utf8",
    env: {
      ...process.env,
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  assert(result.status === 0, result.stderr?.toString().trim() || `git ${arguments_[0]} failed`);
  return result.stdout;
}

function jsonAt(root, commit, relativePath) {
  const contents = git(root, ["show", `${commit}:${relativePath}`]);
  try {
    return JSON.parse(contents);
  } catch {
    fail(`${relativePath} is not valid JSON at ${commit}`);
  }
}

function changedFiles(root, productCandidate, deliveryHead) {
  const output = git(
    root,
    ["diff", "--name-status", "--no-renames", "-z", productCandidate, deliveryHead],
    { binary: true },
  );
  const fields = output.toString("utf8").split("\0").filter(Boolean);
  assert(fields.length % 2 === 0, "promotion-tail diff is malformed");
  return Array.from({ length: fields.length / 2 }, (_, index) => ({
    status: fields[index * 2],
    path: fields[index * 2 + 1],
  }));
}

function lifecycleArtifactName(relativePath, taskId, productCandidate) {
  const prefix = `${planRoot}/evidence/lifecycle/${taskId}/${productCandidate}/`;
  if (!relativePath.startsWith(prefix) || !relativePath.endsWith(".json")) return null;
  const name = relativePath.slice(prefix.length, -".json".length);
  return lifecycleNames.has(name) ? name : null;
}

function flatEvidencePath(relativePath) {
  return new RegExp(`^${planRoot}/evidence/ev-[^/]+\\.json$`, "u").test(relativePath);
}

function assertLedgerTail(candidate, promoted, taskId) {
  assert(
    Array.isArray(candidate.items) && Array.isArray(promoted.items),
    "ledger items are required",
  );
  const candidateHeader = { ...candidate, items: undefined };
  const promotedHeader = { ...promoted, items: undefined };
  assert(
    JSON.stringify(candidateHeader) === JSON.stringify(promotedHeader),
    "ledger metadata changed",
  );
  assert(candidate.items.length === promoted.items.length, "ledger membership changed");
  for (const [index, before] of candidate.items.entries()) {
    const after = promoted.items[index];
    assert(before.id === after?.id, "ledger items were reordered or replaced");
    if (before.taskId !== taskId) {
      assert(
        JSON.stringify(before) === JSON.stringify(after),
        `ledger item ${before.id} belongs to another task`,
      );
      continue;
    }
    const beforePolicy = { ...before, status: undefined, evidenceRefs: undefined };
    const afterPolicy = { ...after, status: undefined, evidenceRefs: undefined };
    assert(
      JSON.stringify(beforePolicy) === JSON.stringify(afterPolicy),
      `ledger policy changed for ${before.id}`,
    );
  }
}

function taskIdentity(document) {
  return new Set(
    [document.taskId, document.task_id, document.work_item_id].filter(
      (value) => typeof value === "string",
    ),
  );
}

function candidateIdentity(document) {
  const commits = new Set();
  for (const value of [
    document.candidateCommit,
    document.candidate_commit,
    document.commit,
    document.git_sha,
  ]) {
    if (value === undefined) continue;
    assert(
      typeof value === "string" && shaPattern.test(value),
      "lifecycle artifact has an invalid candidate identity",
    );
    commits.add(value);
  }
  return commits;
}

function assertLifecycleArtifact(name, document, taskId, candidate) {
  if (name === "work_proof_marker") {
    const bindings = document.authorized_task_bindings;
    const commits = new Set();
    if (document.git_sha !== undefined) {
      assert(
        typeof document.git_sha === "string" && shaPattern.test(document.git_sha),
        "work_proof_marker has an invalid git_sha",
      );
      commits.add(document.git_sha);
    }
    if (bindings !== undefined) {
      assert(Array.isArray(bindings), "work_proof_marker bindings are invalid");
      for (const binding of bindings) {
        assert(
          binding &&
            typeof binding.task_id === "string" &&
            typeof binding.source_revision === "string" &&
            shaPattern.test(binding.source_revision),
          "work_proof_marker binding is invalid",
        );
        commits.add(binding.source_revision);
      }
    }
    assert(
      commits.size === 1 && commits.has(candidate),
      "work_proof_marker is not candidate-bound",
    );
    assert(
      Array.isArray(bindings) &&
        bindings.some(
          (binding) => binding.task_id === taskId && binding.source_revision === candidate,
        ),
      "work_proof_marker is not task-bound",
    );
    return;
  }
  const tasks = taskIdentity(document);
  assert(tasks.size === 1 && tasks.has(taskId), `${name} is not task-bound`);
  const commits = candidateIdentity(document);
  assert(commits.size === 1 && commits.has(candidate), `${name} is not candidate-bound`);
  if (name === "validation_report") {
    assert(document.result === "pass", "validation_report is not passing");
    assert(
      Array.isArray(document.checks) &&
        document.checks.every((check) => ["pass", "skipped"].includes(check.status)),
      "validation_report contains a failed check",
    );
  }
  if (name === "review_report")
    assert(document.verdict === "approved", "review_report is not approved");
  if (name === "trust_review_report") {
    assert(document.verdict === "pass", "trust_review_report is not passing");
    assert(
      Array.isArray(document.unresolvedFindings) && document.unresolvedFindings.length === 0,
      "trust_review_report has unresolved findings",
    );
  }
  if (name === "canonical_promotion")
    assert(
      document.artifactType === "canonical_promotion" && document.decision === "accepted",
      "canonical_promotion is not accepted",
    );
}

function assertPromotionState(state, task, taskId, productCandidate) {
  assert(state.taskId === taskId, "promotion state is for another task");
  assert(state.state === "accepted", "promotion state is not accepted");
  assert(state.candidate?.commit === productCandidate, "promotion state changed the candidate");
  assert(
    Array.isArray(state.blockers) && state.blockers.length === 0,
    "promotion state has blockers",
  );
  assert(
    Array.isArray(state.criteria) && state.criteria.length > 0,
    "promotion state has no criteria",
  );
  assert(
    state.criteria.every(
      (criterion) =>
        criterion.status === "pass" &&
        Array.isArray(criterion.evidenceRefs) &&
        criterion.evidenceRefs.length > 0,
    ),
    "promotion state has incomplete criteria",
  );
  const expectedIds = [...task.acceptanceItemIds].sort();
  assert(
    JSON.stringify(state.criteria.map((criterion) => criterion.criterionId).sort()) ===
      JSON.stringify(expectedIds),
    "promotion state criteria differ from the task",
  );
}

function assertPromotedLedger(ledger, state, taskId) {
  const items = ledger.items.filter((item) => item.taskId === taskId);
  assert(items.length === state.criteria.length, "promotion ledger is incomplete");
  const criteria = new Map(state.criteria.map((criterion) => [criterion.criterionId, criterion]));
  for (const item of items) {
    const criterion = criteria.get(item.id);
    assert(criterion, `promotion ledger contains undeclared item ${item.id}`);
    assert(item.status === "accepted", `promotion ledger item ${item.id} is not accepted`);
    assert(
      JSON.stringify(item.evidenceRefs) === JSON.stringify(criterion.evidenceRefs),
      `promotion ledger evidence differs for ${item.id}`,
    );
  }
}

function assertProgress(progress, taskId, criteriaCount) {
  const task = progress.tasks?.find((entry) => entry.taskId === taskId);
  assert(task, "generated progress omits the promoted task");
  assert(task.state === "accepted", "generated progress does not mark the task accepted");
  assert(
    task.acceptedCriteria === criteriaCount && task.totalCriteria === criteriaCount,
    "generated progress criterion counts are inconsistent",
  );
}

export function checkPromotionTail({ root, taskId, productCandidate, deliveryHead }) {
  assert(taskPattern.test(taskId), "invalid task ID");
  assert(
    shaPattern.test(productCandidate) && shaPattern.test(deliveryHead),
    "full commit SHAs are required",
  );
  const resolvedCandidate = git(root, ["rev-parse", `${productCandidate}^{commit}`]).trim();
  const resolvedHead = git(root, ["rev-parse", `${deliveryHead}^{commit}`]).trim();
  assert(
    resolvedCandidate === productCandidate && resolvedHead === deliveryHead,
    "commit identity changed",
  );
  const parents = git(root, ["rev-list", "--parents", "-n", "1", deliveryHead]).trim().split(" ");
  assert(
    parents.length === 2 && parents[1] === productCandidate,
    "DeliveryHead must be one promotion-only commit",
  );

  const plan = jsonAt(root, productCandidate, `${planRoot}/plan.json`);
  const task = plan.tasks?.find((entry) => entry.id === taskId);
  assert(task, `unknown task ${taskId} at ProductCandidate`);
  const requiredLifecycle = new Set([
    "validation_report",
    "canonical_promotion",
    ...(task.risk?.level === "high" ? ["review_report"] : []),
    ...(task.requiredGates?.includes("QG-TRUST-REVIEW") ? ["trust_review_report"] : []),
  ]);
  const statePath = `${planRoot}/state/${taskId}.json`;
  const ledgerPath = `${planRoot}/acceptance-ledger.json`;
  const progressPath = `${planRoot}/progress.json`;
  const requiredPaths = new Set([statePath, ledgerPath, progressPath]);
  const files = changedFiles(root, productCandidate, deliveryHead);
  const addedFlatEvidence = new Map();
  const addedLifecycle = new Map();

  for (const file of files) {
    const lifecycleName = lifecycleArtifactName(file.path, taskId, productCandidate);
    const allowed = requiredPaths.has(file.path) || flatEvidencePath(file.path) || lifecycleName;
    assert(allowed, `promotion tail changes forbidden path ${file.path}`);
    if (flatEvidencePath(file.path) || lifecycleName)
      assert(file.status === "A", `promotion tail mutates prior evidence ${file.path}`);
    if (flatEvidencePath(file.path))
      addedFlatEvidence.set(file.path, jsonAt(root, deliveryHead, file.path));
    if (lifecycleName) addedLifecycle.set(lifecycleName, jsonAt(root, deliveryHead, file.path));
  }
  for (const requiredPath of requiredPaths)
    assert(
      files.some((file) => file.path === requiredPath),
      `promotion tail is missing ${requiredPath}`,
    );
  for (const name of requiredLifecycle)
    assert(addedLifecycle.has(name), `promotion tail is missing ${name}`);

  const candidateLedger = jsonAt(root, productCandidate, ledgerPath);
  const promotedLedger = jsonAt(root, deliveryHead, ledgerPath);
  assertLedgerTail(candidateLedger, promotedLedger, taskId);
  const state = jsonAt(root, deliveryHead, statePath);
  assertPromotionState(state, task, taskId, productCandidate);
  assertPromotedLedger(promotedLedger, state, taskId);
  assertProgress(jsonAt(root, deliveryHead, progressPath), taskId, state.criteria.length);

  const referencedEvidence = new Set(state.criteria.flatMap((criterion) => criterion.evidenceRefs));
  for (const [relativePath, document] of addedFlatEvidence) {
    assert(
      document.taskId === taskId && relativePath === `${planRoot}/evidence/${document.id}.json`,
      `promotion tail adds evidence outside ${taskId}`,
    );
    assert(document.commit === productCandidate, `${document.id} is not candidate-bound`);
    assert(
      document.result?.status === "pass" &&
        document.result.checks?.every((check) => check.status === "pass"),
      `${document.id} is not passing`,
    );
    assert(referencedEvidence.has(document.id), `${document.id} is not cited by task criteria`);
  }
  for (const evidenceId of referencedEvidence)
    assert(
      addedFlatEvidence.has(`${planRoot}/evidence/${evidenceId}.json`),
      `criterion evidence ${evidenceId} was not added by this promotion`,
    );
  for (const [name, document] of addedLifecycle)
    assertLifecycleArtifact(name, document, taskId, productCandidate);

  return {
    status: "pass",
    task_id: taskId,
    product_candidate: productCandidate,
    delivery_head: deliveryHead,
    changed_paths: files.map((file) => file.path).sort(),
  };
}

function main() {
  const [command, taskId, productCandidate, deliveryHead] = process.argv.slice(2);
  assert(
    command === "check" && taskId && productCandidate && deliveryHead,
    "usage: node scripts/promotion-tail.mjs check TASK-ID PRODUCT-CANDIDATE DELIVERY-HEAD",
  );
  const root = process.env.VETRYN_PROMOTION_REPO_ROOT
    ? path.resolve(process.env.VETRYN_PROMOTION_REPO_ROOT)
    : git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  process.stdout.write(
    `${JSON.stringify(checkPromotionTail({ root, taskId, productCandidate, deliveryHead }))}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

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

function collectLifecycleRefCandidates(value, taskId, commits) {
  if (typeof value === "string") {
    const match = value.match(
      new RegExp(
        `^${planRoot}/evidence/lifecycle/((?:M0|V1)-[0-9]{2})/(unbound|[0-9a-f]{40})(?:/|$)`,
        "u",
      ),
    );
    if (match) {
      assert(match[1] === taskId, "lifecycle artifact references another task");
      commits.add(match[2]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectLifecycleRefCandidates(entry, taskId, commits);
    return;
  }
  if (value && typeof value === "object")
    for (const entry of Object.values(value)) collectLifecycleRefCandidates(entry, taskId, commits);
}

function candidateIdentity(document, taskId) {
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
  collectLifecycleRefCandidates(document, taskId, commits);
  return commits;
}

function assertLifecycleArtifact(name, document, taskId, candidate) {
  if (name === "work_proof_marker") {
    const bindings = document.authorized_task_bindings;
    const tasks = taskIdentity(document);
    assert(
      tasks.size === 0 || (tasks.size === 1 && tasks.has(taskId)),
      "work_proof_marker is not task-bound",
    );
    const commits = candidateIdentity(document, taskId);
    if (bindings !== undefined) {
      assert(Array.isArray(bindings), "work_proof_marker bindings are invalid");
      for (const binding of bindings) {
        assert(
          binding &&
            binding.task_id === taskId &&
            typeof binding.source_revision === "string" &&
            shaPattern.test(binding.source_revision),
          "work_proof_marker binding is not task-bound",
        );
        commits.add(binding.source_revision);
      }
    }
    assert(
      commits.size === 1 && commits.has(candidate),
      "work_proof_marker is not candidate-bound",
    );
    return;
  }
  const tasks = taskIdentity(document);
  assert(tasks.size === 1 && tasks.has(taskId), `${name} is not task-bound`);
  const commits = candidateIdentity(document, taskId);
  assert(commits.size === 1 && commits.has(candidate), `${name} is not candidate-bound`);
  if (name === "validation_report") {
    assert(document.result === "pass", "validation_report is not passing");
    assert(
      Array.isArray(document.checks) &&
        document.checks.every((check) => ["pass", "skipped"].includes(check.status)),
      "validation_report contains a failed check",
    );
  }
  if (name === "review_report") {
    assert(document.verdict === "approved", "review_report is not approved");
    const acceptedRisks = Array.isArray(document.findings)
      ? document.findings.filter((finding) => finding?.status === "accepted_risk")
      : [];
    assert(
      Array.isArray(document.findings) &&
        document.findings.every(
          (finding) =>
            ["P0", "P1", "P2", "P3"].includes(finding?.severity) &&
            (finding.status === "resolved" ||
              (finding.status === "accepted_risk" && ["P2", "P3"].includes(finding.severity))),
        ),
      "review_report has unresolved findings",
    );
    assert(
      acceptedRisks.length <= 1 &&
        (acceptedRisks.length === 0 ||
          (acceptedRisks[0].severity === "P2" &&
            document.approval_effect?.approvals_granted?.includes(
              "maintainer_classified_standalone_p2_delivery_debt",
            ))),
      "review_report has unclassified delivery debt",
    );
    assert(
      Array.isArray(document.required_fixes) && document.required_fixes.length === 0,
      "review_report has required fixes",
    );
    assert(
      document.approval_effect?.blocks_promotion === false &&
        document.approval_effect.promotion_decision !== "blocked",
      "review_report blocks promotion",
    );
  }
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

function countBy(values) {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((item) => item === value).length]),
  );
}

function assertProgress(candidateProgress, progress, plan, ledger, taskId, criteriaCount) {
  assert(
    Array.isArray(candidateProgress.tasks) && Array.isArray(progress.tasks),
    "generated progress task rows are required",
  );
  assert(
    candidateProgress.tasks.length === progress.tasks.length,
    "generated progress task membership changed",
  );
  for (const [index, before] of candidateProgress.tasks.entries()) {
    const after = progress.tasks[index];
    assert(before.taskId === after?.taskId, "generated progress tasks were reordered or replaced");
    if (before.taskId !== taskId)
      assert(
        JSON.stringify(before) === JSON.stringify(after),
        `generated progress changed another task ${before.taskId}`,
      );
  }
  assert(
    JSON.stringify(Object.keys(progress).sort()) ===
      JSON.stringify(Object.keys(candidateProgress).sort()),
    "generated progress shape changed",
  );
  assert(progress.$schema === candidateProgress.$schema, "generated progress schema changed");
  assert(
    progress.schemaVersion === candidateProgress.schemaVersion,
    "generated progress version changed",
  );
  assert(progress.planId === plan.planId, "generated progress plan ID changed");
  assert(
    JSON.stringify(progress.taskCounts) ===
      JSON.stringify(countBy(progress.tasks.map((entry) => entry.state))),
    "generated progress task counts are inconsistent",
  );
  assert(
    JSON.stringify(progress.acceptanceCounts) ===
      JSON.stringify(countBy(ledger.items.map((item) => item.status))),
    "generated progress acceptance counts are inconsistent",
  );
  const stateByTask = new Map(progress.tasks.map((entry) => [entry.taskId, entry.state]));
  const acceptedTasks = new Set(
    progress.tasks.filter((entry) => entry.state === "accepted").map((entry) => entry.taskId),
  );
  const expectedNext = plan.tasks
    .filter((entry) => ["planned", "ready"].includes(stateByTask.get(entry.id)))
    .filter((entry) =>
      (entry.dependsOn ?? [])
        .filter((dependency) => ["hard", "contract", "field"].includes(dependency.kind))
        .every((dependency) => acceptedTasks.has(dependency.taskId)),
    )
    .map((entry) => entry.id);
  assert(
    JSON.stringify(progress.nextLegalTasks) === JSON.stringify(expectedNext),
    "generated progress next-legal tasks are inconsistent",
  );
  assert(
    JSON.stringify(progress.blockedTasks) ===
      JSON.stringify(
        progress.tasks.filter((entry) => entry.state === "blocked").map((entry) => entry.taskId),
      ),
    "generated progress blocked tasks are inconsistent",
  );
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
    "work_proof_marker",
    "validation_report",
    "canonical_promotion",
    ...(task.risk?.level === "high" ? ["review_report"] : []),
    ...(task.requiredGates?.includes("QG-TRUST-REVIEW") ? ["trust_review_report"] : []),
  ]);
  const statePath = `${planRoot}/state/${taskId}.json`;
  const ledgerPath = `${planRoot}/acceptance-ledger.json`;
  const progressPath = `${planRoot}/progress.json`;
  const allowedCanonicalPaths = new Set([statePath, ledgerPath, progressPath]);
  const requiredPaths = new Set([statePath, ledgerPath]);
  const files = changedFiles(root, productCandidate, deliveryHead);
  const addedFlatEvidence = new Map();
  const addedLifecycle = new Map();

  for (const file of files) {
    const lifecycleName = lifecycleArtifactName(file.path, taskId, productCandidate);
    const allowed =
      allowedCanonicalPaths.has(file.path) || flatEvidencePath(file.path) || lifecycleName;
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
  assertProgress(
    jsonAt(root, productCandidate, progressPath),
    jsonAt(root, deliveryHead, progressPath),
    plan,
    promotedLedger,
    taskId,
    state.criteria.length,
  );

  const referencedEvidence = new Set([
    ...state.criteria.flatMap((criterion) => criterion.evidenceRefs),
    ...state.gates.flatMap((gate) => gate.evidenceRefs),
  ]);
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
    assert(
      referencedEvidence.has(document.id),
      `${document.id} is not cited by task criteria or gates`,
    );
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

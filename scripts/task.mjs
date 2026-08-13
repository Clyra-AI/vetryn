import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { semanticRiskRefs, validateSemanticRiskEvidence } from "./semantic-risk.mjs";

const root = path.resolve(
  process.env.VETRYN_PLAN_REPO_ROOT ?? path.resolve(import.meta.dirname, ".."),
);
const planScript = path.resolve(import.meta.dirname, "plan.mjs");

const sourcePaths = {
  plan: "product/plans/oss-v1/plan.json",
  ledger: "product/plans/oss-v1/acceptance-ledger.json",
  progress: "product/plans/oss-v1/progress.json",
  factoryProfile: ".factory/profile.yaml",
  semanticRiskLegacySchema: "product/plans/schemas/semantic-risk-report-v0.1.schema.json",
  semanticRiskSchema: "product/plans/schemas/semantic-risk-report-v0.2.schema.json",
};

const workerEvidenceRequired = ["work_proof_marker", "command_evidence", "acceptance_results"];
const canonicalFactorySource = {
  repository: "https://github.com/Clyra-AI/factory",
  commit: "e34a383eb5243a47d1779763226ebadeecd64858",
  profile_path: "profiles/vetryn.yaml",
  profile_sha256: "9839833f777c42348a2feef1af880278d7b7846ba070b6ba2255cddc4fee15ec",
  implementation_risk_sha256: "8e0b07fcdaad805a4a232c823ba5b1ca2f29cbf4bd4d28121a8ab753c81c601d",
  semantic_risk_legacy_schema: "schemas/artifacts/semantic-risk-report-v0.1.schema.json",
  semantic_risk_legacy_schema_sha256:
    "6dc9198a8a522118127ac497393f857449803e6533f1ede82b03355640b75dfa",
  portable_semantic_risk_legacy_schema:
    "product/plans/schemas/semantic-risk-report-v0.1.schema.json",
  semantic_risk_schema: "schemas/artifacts/semantic-risk-report-v0.2.schema.json",
  semantic_risk_schema_sha256: "b24c5028566b7da75df74a45d0efe48387c112b438048148a2f9e5bf47c3b3ee",
  portable_semantic_risk_schema: "product/plans/schemas/semantic-risk-report-v0.2.schema.json",
};
const baseFactorySkills = ["task-executor", "validation-gate"];
const baseLifecycleEvidenceRequired = [
  "validation_report",
  "github_review_evidence",
  "ship_packet",
  "pr_lifecycle_report",
  "post_merge_report",
  "canonical_promotion",
];

function factorySkillsForTask(task) {
  return [
    ...baseFactorySkills,
    ...(task.risk.level === "high" ? ["code-review"] : []),
    "commit-push",
  ];
}

function semanticRiskReportRefForTask(task) {
  if (task.risk.level === "low") return null;
  return semanticRiskRefs(task.id).reportRef;
}

function semanticRiskIntegrityMarkerRefForTask(task) {
  if (task.risk.level === "low") return null;
  return semanticRiskRefs(task.id).integrityMarkerRef;
}

function allowedPathsForTask(task) {
  const semanticRiskReportRef = semanticRiskReportRefForTask(task);
  const semanticRiskIntegrityMarkerRef = semanticRiskIntegrityMarkerRefForTask(task);
  return semanticRiskReportRef
    ? [...task.scope.allowedPaths, semanticRiskReportRef, semanticRiskIntegrityMarkerRef]
    : task.scope.allowedPaths;
}

function lifecycleGatesForTask(task, trustReviewRequired) {
  return {
    local_validation_required: true,
    ci_required: true,
    code_review_required: task.risk.level === "high",
    trust_review_required: trustReviewRequired,
    codex_review_required: false,
    commit_push_required: true,
    post_merge_monitor_required: true,
    pr_lifecycle_report_required: true,
    skip_policy: "approved_exception_required",
  };
}

function taskView(task) {
  return {
    id: task.id,
    title: task.title,
    objective: task.objective,
    risk: task.risk,
    dependsOn: task.dependsOn,
    scope: task.scope,
    semanticInvariants: task.semanticInvariants,
    deliverables: task.deliverables,
    requiredTestLevels: task.requiredTestLevels,
    capabilities: task.capabilities,
    stopConditions: task.stopConditions,
  };
}

function acceptanceResultRequirementsForItems(items) {
  return items.map((item) => {
    const manualReview = new Set(["review", "inspection"]).has(item.verification.method);
    return {
      acceptance_item_id: item.id,
      allowed_statuses: ["implemented", "partial", "missing", "blocked"],
      evidence_mode: manualReview ? "manual_review" : "automated",
      closure_evidence: manualReview ? "acceptance_evidence_record" : "validation_ref",
      evidence_required: workerEvidenceRequired,
      worker_evidence_required: workerEvidenceRequired,
      lifecycle_evidence_required: manualReview
        ? ["github_review_evidence", "canonical_promotion"]
        : ["validation_report", "canonical_promotion"],
    };
  });
}

function acceptancePolicyView(item) {
  const policy = { ...item };
  delete policy.status;
  delete policy.evidenceRefs;
  return policy;
}

function planSourceMetadataView(plan) {
  return {
    planId: plan.planId,
    baseline: {
      repository: plan.baseline.repository,
      commit: plan.baseline.commit,
    },
    productContract: plan.productContract,
  };
}

function assertAcceptancePromotionTails(packetItems, canonicalItems) {
  const canonicalById = new Map(canonicalItems.map((item) => [item.id, item]));
  for (const item of packetItems) {
    const canonical = canonicalById.get(item.id);
    assert(canonical, `acceptance item ${item.id} is not canonical`);
    const packetTail = { status: item.status, evidenceRefs: item.evidenceRefs };
    const canonicalTail = {
      status: canonical.status,
      evidenceRefs: canonical.evidenceRefs,
    };
    const exactCurrentTail = isDeepStrictEqual(packetTail, canonicalTail);
    const frozenPrePromotionTail =
      canonical.status === "accepted" &&
      item.status === "planned" &&
      Array.isArray(item.evidenceRefs) &&
      item.evidenceRefs.length === 0;
    assert(
      exactCurrentTail || frozenPrePromotionTail,
      `acceptance item ${item.id} has an invalid promotion tail`,
    );
  }
}

function scopeExclusionsForTask(task) {
  return [
    ...task.scope.forbiddenPaths.map((pattern) => `Do not change ${pattern}.`),
    "Do not change paths outside allowed_paths.",
    "Do not accept, promote, merge, or edit generated progress from the executor role.",
  ];
}

function stopConditionsForTask(task, highRiskTask, trustReviewRequired) {
  return [
    ...task.stopConditions,
    "A changed path is outside allowed_paths or matches forbidden_paths.",
    "A required validation command fails.",
    "The compiled packet or its source digests drift before handoff.",
    "A lifecycle artifact is used while its ref is unbound or does not contain the exact candidate commit.",
    ...(task.risk.level !== "low"
      ? [
          "Implementation proceeds without a schema-valid semantic_risk_report and content-bound integrity marker at their exact packet refs, or either target is outside allowed_paths.",
        ]
      : []),
    ...(highRiskTask
      ? [
          "The candidate reaches promotion or push without a candidate-bound passing review_report.",
          "Product or contract-bearing candidate changes occur after local structured review without invalidating and rerunning that review.",
        ]
      : []),
    ...(trustReviewRequired
      ? [
          "The candidate reaches promotion or push without a candidate-bound passing trust_review_report from vetryn-trust-review.",
        ]
      : []),
  ];
}

function assertSame(actual, expected, field) {
  assert(isDeepStrictEqual(actual, expected), `${field} does not match canonical plan`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function lifecycleEvidenceForTask(task, trustReviewRequired) {
  return [
    ...baseLifecycleEvidenceRequired.slice(0, 1),
    ...(task.risk.level === "high" ? ["review_report"] : []),
    ...(trustReviewRequired ? ["trust_review_report"] : []),
    ...baseLifecycleEvidenceRequired.slice(1),
  ];
}

function lifecycleEvidenceRefsForTask(taskId, candidateCommit, requiredEvidence) {
  return Object.fromEntries(
    requiredEvidence.map((artifact) => [
      artifact,
      `product/plans/oss-v1/evidence/lifecycle/${taskId}/${candidateCommit ?? "unbound"}/${artifact}.json`,
    ]),
  );
}

function publishableDocumentationRefs(task) {
  const packageNames = [
    ...new Set(
      task.deliverables
        .map((deliverable) => deliverable.match(/^packages\/([^/]+)\/\*\*$/)?.[1])
        .filter(Boolean),
    ),
  ];
  const refs = packageNames.map((packageName) => ({
    path: `packages/${packageName}/README.md`,
    reason: `Document the ${packageName} package's public contract for this task.`,
  }));

  if (task.scope.allowedPaths.includes("examples/openrouter-typescript/**"))
    refs.push({
      path: "examples/openrouter-typescript/README.md",
      reason:
        "Keep the golden repository commands aligned with this task's public package surface.",
    });

  return refs;
}

function deliveryIntentForTask(task, productContract) {
  if (task.deliveryIntent !== undefined) {
    return {
      changelog_intent: {
        impact: task.deliveryIntent.changelog.impact,
        section: task.deliveryIntent.changelog.section,
        draft_entry: task.deliveryIntent.changelog.draftEntry,
        semver_marker: task.deliveryIntent.changelog.semverMarker,
      },
      versioning_impact: task.deliveryIntent.versioningImpact,
      migration_impact: task.deliveryIntent.migrationImpact,
      docs_sync_refs: task.deliveryIntent.docsSyncRefs,
    };
  }

  const planningContractTask = task.deliverables.includes("product/plans/**");
  const publishablePackageTask = task.scope.allowedPaths.includes(".changeset/**");
  return {
    changelog_intent: {
      impact: planningContractTask || publishablePackageTask ? "required" : "not_required",
      section: planningContractTask || publishablePackageTask ? "Added" : "Unreleased",
      draft_entry: planningContractTask
        ? "Made compiled Vetryn task packets runner-ready for Factory task-executor."
        : publishablePackageTask
          ? "Add a Changeset for every new or changed public package and CLI surface in this task."
          : "No changelog edit is authorized unless the task scope explicitly includes CHANGELOG.md.",
      semver_marker: publishablePackageTask ? "minor" : "none",
    },
    versioning_impact: publishablePackageTask
      ? "Record a minor Changeset for each new or changed publishable package; publication remains a separate release operation."
      : "No package version change or release is authorized by this task packet.",
    migration_impact: planningContractTask
      ? "Packet consumers must accept the additive runner-ready fields; existing Vetryn packet fields remain available."
      : "No migration work is authorized by this task packet.",
    docs_sync_refs: planningContractTask
      ? [
          {
            path: "docs/implementation/oss-v1-execution.md",
            reason: "Document the runner-ready packet and executor/lifecycle evidence split.",
          },
          {
            path: "docs/adr/0003-bind-task-execution-and-review-evidence.md",
            reason: "Record the additive public task-packet contract decision.",
          },
          {
            path: "docs/adr/0010-require-local-and-domain-review-evidence.md",
            reason:
              "Record the local and domain review security boundary and compatibility impact.",
          },
          {
            path: "product/plans/oss-v1/README.md",
            reason: "Keep plan consumer instructions aligned with compiled packet behavior.",
          },
          {
            path: ".factory/README.md",
            reason:
              "Keep the portable Factory adapter description aligned with the packet surface.",
          },
        ]
      : publishablePackageTask
        ? publishableDocumentationRefs(task)
        : [
            {
              path: productContract,
              reason:
                "Product-facing documentation changes require explicit task scope and contract alignment.",
            },
          ],
  };
}

function assertLifecycleEvidenceBindings(packet) {
  const expectedCandidate = packet.currentState.candidate?.commit ?? "unbound";
  const requiredArtifacts = [...packet.lifecycle_evidence_required].sort();
  const referencedArtifacts = Object.keys(packet.lifecycle_evidence_refs).sort();
  assert(
    JSON.stringify(referencedArtifacts) === JSON.stringify(requiredArtifacts),
    "lifecycle evidence refs do not correspond one-to-one with lifecycle_evidence_required",
  );
  for (const artifact of requiredArtifacts) {
    const expectedRef = `product/plans/oss-v1/evidence/lifecycle/${packet.task_id}/${expectedCandidate}/${artifact}.json`;
    assert(
      packet.lifecycle_evidence_refs[artifact] === expectedRef,
      `lifecycle evidence ref ${artifact} must equal ${expectedRef}`,
    );
  }
}

const runtimePins = {
  language: "typescript",
  toolchain_version: "node-22 / pnpm-10.23.0 / typescript-6.0.3",
  module_or_package_path: "github.com/Clyra-AI/vetryn",
  dependency_policy:
    "Frozen pnpm lockfile; minimal Apache-2.0-compatible dependencies; runtime additions require justification and dependency review.",
  distribution_target: "npm_cli_packages_and_composite_github_action",
  provider_policy:
    "Offline deterministic CI; provider access requires explicit task capability, scoped credentials, an allowlist, and human approval.",
  artifact_namespace: "product/plans/oss-v1/evidence",
  live_work_policy:
    "No ambient secrets or paid APIs; field evaluation is manual or explicitly scheduled and never a pull-request merge gate.",
};

const factoryCompatibility = {
  factory_contract_version: "1.0",
  profile_ref: ".factory/profile.yaml",
  skill_vocabulary_version: "2026-08-13",
  skill_inventory_ref: "docs/agent-map.md#current-skill-routing",
  generated_by: "vetryn-task-compiler",
  canonical_factory_source: canonicalFactorySource,
  deprecated_worker_policy: "block_active_aliases",
  deprecated_worker_aliases: [
    {
      deprecated: "ship-pr",
      replacement: "commit-push",
      status: "deprecated",
      migration_behavior: "Block active task packets until required_worker_chain uses commit-push.",
    },
  ],
};

const maintainerDeliveryPermissions = {
  allowsProviderAccess: false,
  mode: "factory-lifecycle-only",
  requiresExplicitMaintainerAuthorization: true,
};

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function digest(relativePath) {
  const contents = await readFile(path.join(root, relativePath));
  return createHash("sha256").update(contents).digest("hex");
}

function textDigest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function validatePortableFactoryProfile() {
  const profile = await readFile(path.join(root, sourcePaths.factoryProfile), "utf8");
  assert(
    (await digest(sourcePaths.semanticRiskLegacySchema)) ===
      canonicalFactorySource.semantic_risk_legacy_schema_sha256,
    "portable semantic-risk legacy schema does not match the pinned canonical Factory schema",
  );
  assert(
    (await digest(sourcePaths.semanticRiskSchema)) ===
      canonicalFactorySource.semantic_risk_schema_sha256,
    "portable semantic-risk schema does not match the pinned canonical Factory schema",
  );
  const riskBlock = profile.match(
    /^implementation_risk:\n.*?(?=^[A-Za-z_][A-Za-z0-9_]*:|(?![\s\S]))/msu,
  )?.[0];
  assert(riskBlock, "portable Factory profile is missing implementation_risk");
  assert(
    textDigest(`${riskBlock.trimEnd()}\n`) === canonicalFactorySource.implementation_risk_sha256,
    "portable Factory implementation_risk does not match the pinned canonical policy",
  );
  assert(
    new RegExp(
      `^canonical_factory_profile:\\s+${escapeRegExp(canonicalFactorySource.profile_path)}$`,
      "mu",
    ).test(profile),
    "portable Factory profile does not pin canonical profile_path",
  );
  const sourceBlock = profile.match(
    /^canonical_factory_source:\n.*?(?=^[A-Za-z_][A-Za-z0-9_]*:|(?![\s\S]))/msu,
  )?.[0];
  assert(sourceBlock, "portable Factory profile is missing canonical_factory_source");
  for (const [field, value] of Object.entries(canonicalFactorySource).filter(
    ([field]) => field !== "profile_path",
  )) {
    assert(
      new RegExp(`^\\s{2}${escapeRegExp(field)}:\\s+${escapeRegExp(value)}$`, "mu").test(
        sourceBlock,
      ),
      `portable Factory profile does not pin canonical ${field}`,
    );
  }
}

function readAtCommit(commit, relativePath) {
  const result = spawnSync("git", ["-C", root, "show", `${commit}:${relativePath}`], {
    encoding: null,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert(
    result.status === 0 && Buffer.isBuffer(result.stdout),
    `cannot read frozen candidate input ${relativePath} at ${commit}`,
  );
  return result.stdout;
}

function digestAtCommit(commit, relativePath) {
  return createHash("sha256").update(readAtCommit(commit, relativePath)).digest("hex");
}

function readJsonAtCommit(commit, relativePath) {
  try {
    return JSON.parse(readAtCommit(commit, relativePath).toString("utf8"));
  } catch {
    fail(`cannot parse frozen candidate input ${relativePath} at ${commit}`);
  }
}

function validateCanonicalPlan() {
  const result = spawnSync(process.execPath, [planScript, "check"], {
    encoding: "utf8",
    env: { ...process.env, VETRYN_PLAN_REPO_ROOT: root },
  });
  assert(
    result.status === 0,
    `canonical plan is invalid: ${(result.stderr || result.stdout).trim()}`,
  );
}

async function loadPlanContext() {
  validateCanonicalPlan();
  const [plan, ledger, progress] = await Promise.all([
    readJson(sourcePaths.plan),
    readJson(sourcePaths.ledger),
    readJson(sourcePaths.progress),
  ]);
  return { plan, ledger, progress };
}

async function next() {
  const { progress } = await loadPlanContext();
  const activeStates = new Set([
    "in_progress",
    "verification_pending",
    "review_pending",
    "changes_requested",
  ]);
  const activeTasks = progress.tasks
    .filter((task) => activeStates.has(task.state))
    .map((task) => ({ taskId: task.taskId, state: task.state }));
  process.stdout.write(
    `${JSON.stringify(
      {
        planId: progress.planId,
        activeTasks,
        nextLegalTasks: progress.nextLegalTasks,
        blockedTasks: progress.blockedTasks,
      },
      null,
      2,
    )}\n`,
  );
}

async function compile(taskId) {
  assert(taskId, "usage: node scripts/task.mjs compile <task-id>");
  const { plan, ledger, progress } = await loadPlanContext();
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  assert(task, `unknown task ${taskId}`);
  const statePath = `product/plans/oss-v1/state/${taskId}.json`;
  const state = await readJson(statePath);
  const runnableStates = new Set([
    "ready",
    "in_progress",
    "verification_pending",
    "review_pending",
    "changes_requested",
  ]);
  const isNextLegal = progress.nextLegalTasks.includes(taskId);
  assert(
    runnableStates.has(state.state) || (state.state === "planned" && isNextLegal),
    `${taskId} is ${state.state} and is not legal to compile for execution`,
  );

  const gateById = new Map(plan.gateCatalog.map((gate) => [gate.id, gate]));
  const acceptanceItems = ledger.items.filter((item) => item.taskId === taskId);
  const gates = task.requiredGates.map((gateId) => gateById.get(gateId));
  const validationCommands = [
    ...new Set([
      ...gates.filter((gate) => gate.kind === "command").map((gate) => gate.command),
      `pnpm --silent task:compile -- ${taskId}`,
    ]),
  ];
  const acceptanceResultRequirements = acceptanceResultRequirementsForItems(acceptanceItems);
  const deliveryIntent = deliveryIntentForTask(task, plan.productContract);
  const highRiskTask = task.risk.level === "high";
  const trustReviewRequired = task.requiredGates.includes("QG-TRUST-REVIEW");
  await validatePortableFactoryProfile();
  const factorySkills = factorySkillsForTask(task);
  const lifecycleEvidenceRequired = lifecycleEvidenceForTask(task, trustReviewRequired);
  const sourceFiles = [
    plan.productContract,
    sourcePaths.plan,
    "pnpm-lock.yaml",
    sourcePaths.factoryProfile,
    sourcePaths.semanticRiskLegacySchema,
    sourcePaths.semanticRiskSchema,
  ];
  const sourceDigests = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        state.candidate?.commit ? digestAtCommit(state.candidate.commit, file) : await digest(file),
      ]),
    ),
  );
  const packet = {
    $schema: "https://vetryn.dev/schemas/planning/task-packet-v1.json",
    schemaVersion: "1.1.0",
    packetId: `${plan.planId}:${taskId}:r${state.revision}`,
    task_id: task.id,
    objective: task.objective,
    risk_class: task.risk.level,
    worker_type: "task-executor",
    allowed_paths: allowedPathsForTask(task),
    forbidden_paths: task.scope.forbiddenPaths,
    scope_exclusions: scopeExclusionsForTask(task),
    acceptance_checks: acceptanceItems.map((item) => item.statement),
    validation_commands: validationCommands,
    baseline_commands: ["pnpm format:check", "pnpm plan:check"],
    red_first_commands: ["pnpm test"],
    final_validation_commands: ["pnpm check"],
    required_worker_chain: factorySkills,
    required_domain_review_chain: trustReviewRequired ? ["vetryn-trust-review"] : [],
    lifecycle_gates: lifecycleGatesForTask(task, trustReviewRequired),
    evidence_required: workerEvidenceRequired,
    worker_evidence_required: workerEvidenceRequired,
    lifecycle_evidence_required: lifecycleEvidenceRequired,
    lifecycle_evidence_refs: lifecycleEvidenceRefsForTask(
      task.id,
      state.candidate?.commit,
      lifecycleEvidenceRequired,
    ),
    packet_validation_command: "node scripts/task.mjs validate {packet_path}",
    stop_conditions: stopConditionsForTask(task, highRiskTask, trustReviewRequired),
    retry_budget: {
      max_attempts: task.maxAttempts,
      current_attempt: state.attempt,
      remaining_attempts: Math.max(task.maxAttempts - state.attempt, 0),
    },
    runtime_pins: runtimePins,
    alignment_gate_ref: "docs/implementation/oss-v1-execution.md#agent-roles-and-handoff",
    plan_drift_policy_ref: "WORKFLOW.md#select-and-compile-work",
    factory_compatibility: factoryCompatibility,
    ...(semanticRiskReportRefForTask(task)
      ? {
          semantic_risk_report_ref: semanticRiskReportRefForTask(task),
          semantic_risk_integrity_marker_ref: semanticRiskIntegrityMarkerRefForTask(task),
        }
      : {}),
    acceptance_ledger_ref: sourcePaths.ledger,
    acceptance_item_ids: task.acceptanceItemIds,
    acceptance_result_requirements: acceptanceResultRequirements,
    ci_lane_refs: [
      {
        source_ref: ".factory/profile.yaml#/ci_lanes",
        rule: "Run the active task gates locally and require the repository's latest-head CI lanes before shipping.",
        command_refs: validationCommands,
      },
    ],
    test_matrix_refs: [
      {
        source_ref: ".factory/profile.yaml#/test_matrix",
        rule: `Preserve the declared ${task.requiredTestLevels.join(", ")} test levels for this task.`,
        command_refs: validationCommands,
      },
    ],
    coverage_policy_refs: {
      required: false,
      source_ref: ".factory/profile.yaml#/coverage_policy",
      policy:
        "Numeric coverage is advisory until V1-01; behavior and contract changes still require focused deterministic tests.",
      command_refs: ["pnpm test:coverage", "pnpm check"],
    },
    security_scanner_gates: {
      required: true,
      source_ref: ".factory/profile.yaml#/security_scanning",
      policy:
        "CodeQL must settle for schema, contract, evidence, workflow, or release-sensitive changes.",
      command_refs: ["GitHub Actions CodeQL analyze (javascript-typescript)"],
    },
    engineering_policy_refs: [
      {
        source_ref: ".factory/profile.yaml#/engineering_policies/docs_parity",
        rule: "Keep public commands, schemas, compiler output, documentation, and changelog aligned.",
      },
      {
        source_ref: ".factory/profile.yaml#/engineering_policies/provenance_evidence",
        rule: "Keep executor evidence distinct from lifecycle-owned review, shipping, and post-merge evidence.",
      },
    ],
    architecture_guidance_refs: [
      {
        source_ref: "docs/architecture.md#trust-boundaries",
        rule: "Preserve repository-owned evidence, explicit authority, and fail-closed boundaries.",
      },
      {
        source_ref: ".factory/profile.yaml#/architecture_policies",
        rule: "Apply the repository ADR, TDD, reliability, and failure-semantics policies.",
      },
    ],
    ...deliveryIntent,
    source: {
      repository: plan.baseline.repository,
      baselineCommit: plan.baseline.commit,
      productContract: plan.productContract,
      productContractDigest: sourceDigests[plan.productContract],
      planPath: sourcePaths.plan,
      ledgerPath: sourcePaths.ledger,
      statePath,
      digests: sourceDigests,
    },
    task: taskView(task),
    currentState: {
      state: state.state,
      attempt: state.attempt,
      maxAttempts: task.maxAttempts,
      candidate: state.candidate,
    },
    acceptanceItems,
    gates,
    requiredReviews: task.requiredReviews,
    execution: {
      implementSkill: "vetryn-implement-task",
      verifySkill: "vetryn-verify-task",
      promoteSkill: "vetryn-promote-task",
      factorySkills,
      executorMayAccept: false,
      verifierMustDifferFromExecutor: false,
      maintainerApprovalRequired: true,
      progressIsGenerated: true,
      deliveryPermissions: maintainerDeliveryPermissions,
    },
  };

  await validatePacket(packet, { requireBoundCandidate: false });
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
}

async function validatePacket(packet, { requireBoundCandidate }) {
  validateCanonicalPlan();
  await validatePortableFactoryProfile();
  const schema = await readJson("product/plans/schemas/task-packet.schema.json");
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert(
    validate(packet),
    `compiled task packet is invalid: ${(validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ")}`,
  );
  assert(packet.task_id === packet.task.id, "task_id does not match task.id");
  const [plan, ledger] = await Promise.all([
    readJson(sourcePaths.plan),
    readJson(sourcePaths.ledger),
  ]);
  const canonicalTask = plan.tasks.find((task) => task.id === packet.task_id);
  assert(canonicalTask, `canonical plan does not contain task ${packet.task_id}`);
  assert(
    new RegExp(`^${escapeRegExp(plan.planId)}:${escapeRegExp(packet.task_id)}:r\\d+$`, "u").test(
      packet.packetId,
    ),
    "packetId does not match canonical plan and task",
  );
  const canonicalGates = canonicalTask.requiredGates.map((gateId) =>
    plan.gateCatalog.find((gate) => gate.id === gateId),
  );
  assert(
    canonicalGates.every(Boolean),
    `canonical task ${packet.task_id} references an unknown gate`,
  );
  const canonicalAcceptanceItems = ledger.items.filter((item) => item.taskId === packet.task_id);
  const canonicalTrustReview = canonicalTask.requiredGates.includes("QG-TRUST-REVIEW");
  const canonicalFactorySkills = factorySkillsForTask(canonicalTask);
  const canonicalLifecycleEvidence = lifecycleEvidenceForTask(canonicalTask, canonicalTrustReview);
  const canonicalValidationCommands = [
    ...new Set([
      ...canonicalGates.filter((gate) => gate.kind === "command").map((gate) => gate.command),
      `pnpm --silent task:compile -- ${packet.task_id}`,
    ]),
  ];
  assertSame(packet.task, taskView(canonicalTask), "task");
  assertSame(packet.objective, canonicalTask.objective, "objective");
  assertSame(packet.risk_class, canonicalTask.risk.level, "risk_class");
  assertSame(packet.allowed_paths, allowedPathsForTask(canonicalTask), "allowed_paths");
  assertSame(
    packet.semantic_risk_report_ref,
    semanticRiskReportRefForTask(canonicalTask) ?? undefined,
    "semantic_risk_report_ref",
  );
  assertSame(
    packet.semantic_risk_integrity_marker_ref,
    semanticRiskIntegrityMarkerRefForTask(canonicalTask) ?? undefined,
    "semantic_risk_integrity_marker_ref",
  );
  assertSame(packet.forbidden_paths, canonicalTask.scope.forbiddenPaths, "forbidden_paths");
  assertSame(packet.validation_commands, canonicalValidationCommands, "validation_commands");
  assertSame(packet.acceptance_item_ids, canonicalTask.acceptanceItemIds, "acceptance_item_ids");
  assertSame(
    packet.acceptance_checks,
    canonicalAcceptanceItems.map((item) => item.statement),
    "acceptance_checks",
  );
  assertSame(packet.gates, canonicalGates, "gates");
  assertSame(packet.requiredReviews, canonicalTask.requiredReviews, "requiredReviews");
  assertSame(packet.required_worker_chain, canonicalFactorySkills, "required_worker_chain");
  assertSame(packet.execution.factorySkills, canonicalFactorySkills, "execution.factorySkills");
  assertSame(
    packet.required_domain_review_chain,
    canonicalTrustReview ? ["vetryn-trust-review"] : [],
    "required_domain_review_chain",
  );
  assertSame(
    packet.lifecycle_gates,
    lifecycleGatesForTask(canonicalTask, canonicalTrustReview),
    "lifecycle_gates",
  );
  assertSame(
    packet.lifecycle_evidence_required,
    canonicalLifecycleEvidence,
    "lifecycle_evidence_required",
  );
  assertSame(packet.evidence_required, workerEvidenceRequired, "evidence_required");
  assertSame(packet.worker_evidence_required, workerEvidenceRequired, "worker_evidence_required");
  assertSame(
    packet.acceptance_result_requirements,
    acceptanceResultRequirementsForItems(canonicalAcceptanceItems),
    "acceptance_result_requirements",
  );
  assertSame(packet.scope_exclusions, scopeExclusionsForTask(canonicalTask), "scope_exclusions");
  assertSame(
    packet.baseline_commands,
    ["pnpm format:check", "pnpm plan:check"],
    "baseline_commands",
  );
  assertSame(packet.red_first_commands, ["pnpm test"], "red_first_commands");
  assertSame(packet.final_validation_commands, ["pnpm check"], "final_validation_commands");
  assertSame(
    packet.stop_conditions,
    stopConditionsForTask(canonicalTask, canonicalTask.risk.level === "high", canonicalTrustReview),
    "stop_conditions",
  );
  assertSame(packet.runtime_pins, runtimePins, "runtime_pins");
  assertSame(packet.factory_compatibility, factoryCompatibility, "factory_compatibility");
  assertSame(packet.acceptance_ledger_ref, sourcePaths.ledger, "acceptance_ledger_ref");
  assertAcceptancePromotionTails(packet.acceptanceItems, canonicalAcceptanceItems);
  assertSame(
    packet.acceptanceItems.map(acceptancePolicyView),
    canonicalAcceptanceItems.map(acceptancePolicyView),
    "acceptanceItems policy",
  );
  assertSame(
    packet.alignment_gate_ref,
    "docs/implementation/oss-v1-execution.md#agent-roles-and-handoff",
    "alignment_gate_ref",
  );
  assertSame(
    packet.plan_drift_policy_ref,
    "WORKFLOW.md#select-and-compile-work",
    "plan_drift_policy_ref",
  );
  assertSame(
    packet.ci_lane_refs,
    [
      {
        source_ref: ".factory/profile.yaml#/ci_lanes",
        rule: "Run the active task gates locally and require the repository's latest-head CI lanes before shipping.",
        command_refs: canonicalValidationCommands,
      },
    ],
    "ci_lane_refs",
  );
  assertSame(
    packet.test_matrix_refs,
    [
      {
        source_ref: ".factory/profile.yaml#/test_matrix",
        rule: `Preserve the declared ${canonicalTask.requiredTestLevels.join(", ")} test levels for this task.`,
        command_refs: canonicalValidationCommands,
      },
    ],
    "test_matrix_refs",
  );
  assertSame(
    packet.coverage_policy_refs,
    {
      required: false,
      source_ref: ".factory/profile.yaml#/coverage_policy",
      policy:
        "Numeric coverage is advisory until V1-01; behavior and contract changes still require focused deterministic tests.",
      command_refs: ["pnpm test:coverage", "pnpm check"],
    },
    "coverage_policy_refs",
  );
  assertSame(
    packet.security_scanner_gates,
    {
      required: true,
      source_ref: ".factory/profile.yaml#/security_scanning",
      policy:
        "CodeQL must settle for schema, contract, evidence, workflow, or release-sensitive changes.",
      command_refs: ["GitHub Actions CodeQL analyze (javascript-typescript)"],
    },
    "security_scanner_gates",
  );
  assertSame(
    packet.engineering_policy_refs,
    [
      {
        source_ref: ".factory/profile.yaml#/engineering_policies/docs_parity",
        rule: "Keep public commands, schemas, compiler output, documentation, and changelog aligned.",
      },
      {
        source_ref: ".factory/profile.yaml#/engineering_policies/provenance_evidence",
        rule: "Keep executor evidence distinct from lifecycle-owned review, shipping, and post-merge evidence.",
      },
    ],
    "engineering_policy_refs",
  );
  assertSame(
    packet.architecture_guidance_refs,
    [
      {
        source_ref: "docs/architecture.md#trust-boundaries",
        rule: "Preserve repository-owned evidence, explicit authority, and fail-closed boundaries.",
      },
      {
        source_ref: ".factory/profile.yaml#/architecture_policies",
        rule: "Apply the repository ADR, TDD, reliability, and failure-semantics policies.",
      },
    ],
    "architecture_guidance_refs",
  );
  const expectedDeliveryIntent = deliveryIntentForTask(canonicalTask, plan.productContract);
  assertSame(packet.changelog_intent, expectedDeliveryIntent.changelog_intent, "changelog_intent");
  assertSame(
    packet.versioning_impact,
    expectedDeliveryIntent.versioning_impact,
    "versioning_impact",
  );
  assertSame(packet.migration_impact, expectedDeliveryIntent.migration_impact, "migration_impact");
  assertSame(packet.docs_sync_refs, expectedDeliveryIntent.docs_sync_refs, "docs_sync_refs");
  assertSame(
    packet.execution,
    {
      implementSkill: "vetryn-implement-task",
      verifySkill: "vetryn-verify-task",
      promoteSkill: "vetryn-promote-task",
      factorySkills: canonicalFactorySkills,
      executorMayAccept: false,
      verifierMustDifferFromExecutor: false,
      maintainerApprovalRequired: true,
      progressIsGenerated: true,
      deliveryPermissions: maintainerDeliveryPermissions,
    },
    "execution",
  );
  const expectedStatePath = `product/plans/oss-v1/state/${packet.task_id}.json`;
  assertSame(packet.source.repository, plan.baseline.repository, "source.repository");
  assertSame(packet.source.baselineCommit, plan.baseline.commit, "source.baselineCommit");
  assertSame(packet.source.productContract, plan.productContract, "source.productContract");
  assertSame(packet.source.planPath, sourcePaths.plan, "source.planPath");
  assertSame(packet.source.ledgerPath, sourcePaths.ledger, "source.ledgerPath");
  assert(
    packet.source.statePath === expectedStatePath,
    `source.statePath must equal ${expectedStatePath}`,
  );
  const canonicalState = await readJson(expectedStatePath);
  assert(canonicalState.taskId === packet.task_id, "canonical state task does not match task_id");
  assert(
    !new Set(["blocked", "failed", "superseded"]).has(canonicalState.state) &&
      canonicalState.blockers.length === 0,
    "canonical task state is halted",
  );
  assertSame(packet.currentState.attempt, canonicalState.attempt, "currentState.attempt");
  assertSame(
    packet.currentState.maxAttempts,
    canonicalTask.maxAttempts,
    "currentState.maxAttempts",
  );
  assertSame(
    packet.retry_budget,
    {
      max_attempts: canonicalTask.maxAttempts,
      current_attempt: canonicalState.attempt,
      remaining_attempts: Math.max(canonicalTask.maxAttempts - canonicalState.attempt, 0),
    },
    "retry_budget",
  );
  assert(
    isDeepStrictEqual(canonicalState.candidate, packet.currentState.candidate),
    "currentState.candidate does not match canonical task state",
  );
  if (canonicalState.candidate?.commit) {
    const candidatePlan = readJsonAtCommit(canonicalState.candidate.commit, sourcePaths.plan);
    assertSame(
      planSourceMetadataView(candidatePlan),
      planSourceMetadataView(plan),
      "canonical plan source metadata has drifted from candidate",
    );
    const candidateTasks = candidatePlan.tasks.filter((task) => task.id === packet.task_id);
    assert(
      candidateTasks.length === 1,
      "frozen candidate plan does not contain one canonical task",
    );
    assertSame(
      candidateTasks[0],
      canonicalTask,
      "canonical task policy has drifted from candidate",
    );
    const candidateGates = candidateTasks[0].requiredGates.map((gateId) =>
      candidatePlan.gateCatalog.find((gate) => gate.id === gateId),
    );
    assert(
      candidateGates.every(Boolean),
      `frozen candidate task ${packet.task_id} references an unknown gate`,
    );
    assertSame(candidateGates, canonicalGates, "canonical gate policy has drifted from candidate");
    const candidateLedger = readJsonAtCommit(canonicalState.candidate.commit, sourcePaths.ledger);
    const candidateAcceptanceItems = candidateLedger.items.filter(
      (item) => item.taskId === packet.task_id,
    );
    assertSame(
      candidateAcceptanceItems.map(acceptancePolicyView),
      canonicalAcceptanceItems.map(acceptancePolicyView),
      "canonical acceptance policy has drifted from candidate",
    );
  }
  const expectedSourceFiles = [
    plan.productContract,
    sourcePaths.plan,
    "pnpm-lock.yaml",
    sourcePaths.factoryProfile,
    sourcePaths.semanticRiskLegacySchema,
    sourcePaths.semanticRiskSchema,
  ];
  assertSame(
    Object.keys(packet.source.digests).toSorted(),
    expectedSourceFiles.toSorted(),
    "source.digests keys",
  );
  assertSame(
    packet.source.productContractDigest,
    packet.source.digests[plan.productContract],
    "source.productContractDigest",
  );
  for (const sourceFile of expectedSourceFiles) {
    if (packet.currentState.candidate?.commit)
      assert(
        packet.source.digests[sourceFile] ===
          digestAtCommit(packet.currentState.candidate.commit, sourceFile),
        `source digest is not bound to candidate for ${sourceFile}`,
      );
    if (sourceFile !== sourcePaths.plan)
      assert(
        packet.source.digests[sourceFile] === (await digest(sourceFile)),
        `source digest is stale for ${sourceFile}`,
      );
  }
  if (requireBoundCandidate) {
    assert(packet.currentState.candidate?.commit, "lifecycle preflight requires a bound candidate");
    await validateSemanticRiskEvidence({ root, packet });
  }
  assertLifecycleEvidenceBindings(packet);
}

async function validatePacketFile(relativePath) {
  assert(relativePath, "usage: node scripts/task.mjs validate <packet-path>");
  assert(
    !path.isAbsolute(relativePath) && !relativePath.split(/[\\/]/u).includes(".."),
    "packet path must stay within the repository",
  );
  await validatePacket(await readJson(relativePath), { requireBoundCandidate: true });
  process.stdout.write(`task packet ${relativePath} is valid\n`);
}

async function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const command = args[0] ?? "next";
  if (command === "next") return next();
  if (command === "compile") return compile(args[1]);
  if (command === "validate") return validatePacketFile(args[1]);
  fail("usage: node scripts/task.mjs [next|compile <task-id>|validate <packet-path>]");
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

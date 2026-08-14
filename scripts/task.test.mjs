import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const taskScript = path.join(repositoryRoot, "scripts/task.mjs");
const planScript = path.join(repositoryRoot, "scripts/plan.mjs");
const temporaryRoots = [];
const v1TaskId = "V1-00";
const downstreamV1TaskIds = [
  "M0-09",
  "M0-10",
  "M0-11",
  "M0-12",
  "M0-13",
  "M0-14",
  "V1-05",
  "V1-06",
  "V1-07",
  "V1-08",
  "V1-09",
  "V1-10",
];
const fixtureTaskIds = [
  v1TaskId,
  "M0-01",
  "M0-02",
  "M0-03",
  "M0-04",
  "M0-05",
  "M0-06",
  "M0-07",
  "M0-08",
  "V1-01",
  "V1-02",
  "V1-03",
  "V1-04",
  ...downstreamV1TaskIds,
];
const v1FixtureRevision = 5;

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vetryn-task-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "docs"));
  await cp(path.join(repositoryRoot, "docs/oss-v1.md"), path.join(root, "docs/oss-v1.md"));
  await cp(path.join(repositoryRoot, "product"), path.join(root, "product"), { recursive: true });
  await cp(
    path.join(repositoryRoot, "examples/openrouter-typescript/fixtures"),
    path.join(root, "examples/openrouter-typescript/fixtures"),
    { recursive: true },
  );
  await cp(path.join(repositoryRoot, "pnpm-lock.yaml"), path.join(root, "pnpm-lock.yaml"));
  await mkdir(path.join(root, ".factory"));
  await cp(
    path.join(repositoryRoot, ".factory/profile.yaml"),
    path.join(root, ".factory/profile.yaml"),
  );
  await normalizeV1Fixture(root);
  return root;
}

async function readFixtureJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function writeFixtureJson(root, relativePath, document) {
  await writeFile(path.join(root, relativePath), `${JSON.stringify(document, null, 2)}\n`);
}

function runTask(root, ...args) {
  return spawnSync(process.execPath, [taskScript, ...args], {
    encoding: "utf8",
    env: { ...process.env, VETRYN_PLAN_REPO_ROOT: root },
  });
}

function runPlan(root, command) {
  return spawnSync(process.execPath, [planScript, command], {
    encoding: "utf8",
    env: { ...process.env, VETRYN_PLAN_REPO_ROOT: root },
  });
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

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function writeSemanticRiskEvidence(root, packet, sourceRevision) {
  const timestamp = "2026-08-10T00:00:00.000Z";
  const report = {
    artifact_type: "semantic_risk_report",
    schema_version: "0.2",
    task_id: packet.task_id,
    work_item_id: packet.task_id,
    risk_class: packet.risk_class,
    profile_ref: ".factory/profile.yaml",
    source_revision: sourceRevision,
    phase: "implementation_design",
    artifact_lifecycle_matrix: [
      {
        artifact: "semantic-risk fixture",
        producer_or_authority: "test fixture",
        mutable_owner: "test fixture",
        states: ["generated", "persisted"],
        freshness: "candidate-bound fixture",
        integrity: "SHA-256 binding",
        authenticity: "deterministic test runner",
        actionable_states: [],
        transitions_and_recovery: ["Reject stale or tampered fixture evidence."],
      },
    ],
    authorization_boundary_trace: [
      "input_validation",
      "reuse_or_persistence",
      "plan_authorization",
      "workspace_mutation",
      "command_execution",
      "remote_effect",
      "external_status",
    ].map((stage) => ({
      stage,
      authority: "test packet",
      input: "deterministic fixture",
      decision: "not_applicable",
      denied_behavior: "fail closed",
    })),
    normative_adversarial_matrix: [
      {
        invariant: "Evidence remains candidate-bound.",
        positive: "Exact fixture passes.",
        missing: "Missing evidence fails.",
        stale: "Stale source fails.",
        contradictory: "Contradictory evidence fails.",
        tampered: "Digest mismatch fails.",
        transition_or_recovery: "Regenerate from a clean baseline.",
        concurrency: "Independent fixture roots do not collide.",
      },
    ],
    review_convergence: {
      implementation_design_pass: "pass",
      same_subsystem_p1_rounds_seen: 0,
      decision: "proceed",
    },
    residual_risks: [],
    created_at: timestamp,
  };
  if (packet.risk_class === "high") {
    report.external_effect_preflight = {
      actions: [
        "agent_runner",
        "model",
        "repository_command",
        "package_registry",
        "provider_sandbox",
        "github",
        "provider_status",
      ].map((action) => ({
        action,
        disposition: "not_applicable",
        authority_ref: null,
        invalid_authority_effect: { calls: 0, spend_usd: 0, writes: 0 },
      })),
    };
    report.persistence_threat_matrix = [
      "integrity",
      "authenticity",
      "freshness",
      "completeness",
      "ordering",
      "anti_rollback",
    ].map((threat) => ({
      threat,
      attack_cases: [`Reject ${threat} violation.`],
      expected_disposition: "reject",
    }));
  }
  const contentDigest = sha256(canonicalJson(report));
  const marker = {
    artifact_type: "semantic_risk_integrity_marker",
    schema_version: "0.2",
    command: `pnpm --silent semantic-risk:design -- ${packet.task_id}`,
    git_sha: sourceRevision,
    exit_code: 0,
    execution_status: "pass",
    started_at: timestamp,
    finished_at: timestamp,
    authorized_task_bindings: [
      {
        task_id: packet.task_id,
        profile_ref: ".factory/profile.yaml",
        semantic_risk_report_ref: packet.semantic_risk_report_ref,
        source_revision: sourceRevision,
        semantic_content_sha256: contentDigest,
        observed_changed_paths: [packet.semantic_risk_report_ref],
      },
    ],
  };
  const markerBytes = `${JSON.stringify(marker, null, 2)}\n`;
  report.baseline_evidence = {
    work_proof_marker_ref: packet.semantic_risk_integrity_marker_ref,
    work_proof_marker_sha256: sha256(markerBytes),
  };
  await mkdir(path.dirname(path.join(root, packet.semantic_risk_report_ref)), { recursive: true });
  await writeFile(path.join(root, packet.semantic_risk_integrity_marker_ref), markerBytes);
  await writeFixtureJson(root, packet.semantic_risk_report_ref, report);
}

function createGitCandidate(root) {
  for (const arguments_ of [
    ["init", "--quiet"],
    ["config", "user.name", "Vetryn test fixture"],
    ["config", "user.email", "fixture@vetryn.invalid"],
    ["add", ".factory", "docs", "product", "pnpm-lock.yaml"],
    ["commit", "--quiet", "-m", "fixture candidate"],
  ]) {
    const result = spawnSync("git", ["-C", root, ...arguments_], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  }
  const result = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function commitGitChanges(root, message, ...paths) {
  for (const arguments_ of [
    ["add", ...paths],
    ["commit", "--quiet", "-m", message],
  ]) {
    const result = spawnSync("git", ["-C", root, ...arguments_], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  }
  const result = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function normalizeV1Fixture(root) {
  const statePath = "product/plans/oss-v1/state/V1-00.json";
  const state = await readFixtureJson(root, statePath);
  Object.assign(state, {
    revision: v1FixtureRevision,
    state: "in_progress",
    attempt: 1,
    candidate: null,
    criteria: state.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: state.gates.map((gate) => ({ ...gate, status: "pending", evidenceRefs: [] })),
    reviews: state.reviews.map((review) => ({
      ...review,
      status: "pending",
      evidenceRefs: [],
    })),
    blockers: [],
    history: [
      {
        from: null,
        to: "in_progress",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Deterministic V1-00 task-compiler fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, statePath, state);

  const processStatePath = "product/plans/oss-v1/state/M0-01.json";
  const processState = await readFixtureJson(root, processStatePath);
  Object.assign(processState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: processState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: processState.gates.map((gate) => ({ ...gate, status: "pending", evidenceRefs: [] })),
    reviews: processState.reviews.map((review) => ({
      ...review,
      status: "pending",
      evidenceRefs: [],
    })),
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset the dependent M0-01 process task with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, processStatePath, processState);

  const goldenScenarioSkillStatePath = "product/plans/oss-v1/state/M0-02.json";
  const goldenScenarioSkillState = await readFixtureJson(root, goldenScenarioSkillStatePath);
  Object.assign(goldenScenarioSkillState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: goldenScenarioSkillState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: goldenScenarioSkillState.gates.map((gate) => ({
      ...gate,
      status: "pending",
      evidenceRefs: [],
    })),
    reviews: goldenScenarioSkillState.reviews.map((review) => ({
      ...review,
      status: "pending",
      evidenceRefs: [],
    })),
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset the golden-scenario process task with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, goldenScenarioSkillStatePath, goldenScenarioSkillState);

  const reauthorizationStatePath = "product/plans/oss-v1/state/M0-03.json";
  const reauthorizationState = await readFixtureJson(root, reauthorizationStatePath);
  Object.assign(reauthorizationState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: reauthorizationState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: reauthorizationState.gates.map((gate) => ({
      ...gate,
      status: "pending",
      evidenceRefs: [],
    })),
    reviews: reauthorizationState.reviews.map((review) => ({
      ...review,
      status: "pending",
      evidenceRefs: [],
    })),
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset the reauthorization process task with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, reauthorizationStatePath, reauthorizationState);

  const postReviewAuthorizationStatePath = "product/plans/oss-v1/state/M0-04.json";
  const postReviewAuthorizationState = await readFixtureJson(
    root,
    postReviewAuthorizationStatePath,
  );
  Object.assign(postReviewAuthorizationState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: postReviewAuthorizationState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: postReviewAuthorizationState.gates.map((gate) => ({
      ...gate,
      status: "pending",
      evidenceRefs: [],
    })),
    reviews: postReviewAuthorizationState.reviews.map((review) => ({
      ...review,
      status: "pending",
      evidenceRefs: [],
    })),
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset the post-review authorization process task with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, postReviewAuthorizationStatePath, postReviewAuthorizationState);

  const scannerCorrectionAuthorizationStatePath = "product/plans/oss-v1/state/M0-05.json";
  const scannerCorrectionAuthorizationState = await readFixtureJson(
    root,
    scannerCorrectionAuthorizationStatePath,
  );
  Object.assign(scannerCorrectionAuthorizationState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: scannerCorrectionAuthorizationState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: scannerCorrectionAuthorizationState.gates.map((gate) => ({
      ...gate,
      status: "pending",
      evidenceRefs: [],
    })),
    reviews: scannerCorrectionAuthorizationState.reviews.map((review) => ({
      ...review,
      status: "pending",
      evidenceRefs: [],
    })),
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset the V1-03 correction authorization task with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(
    root,
    scannerCorrectionAuthorizationStatePath,
    scannerCorrectionAuthorizationState,
  );

  const localReviewAuthorizationStatePath = "product/plans/oss-v1/state/M0-06.json";
  const localReviewAuthorizationState = await readFixtureJson(
    root,
    localReviewAuthorizationStatePath,
  );
  Object.assign(localReviewAuthorizationState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: localReviewAuthorizationState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: localReviewAuthorizationState.gates.map((gate) => ({
      ...gate,
      status: "pending",
      evidenceRefs: [],
    })),
    reviews: [],
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset local-review process policy with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, localReviewAuthorizationStatePath, localReviewAuthorizationState);

  const packageScopeStatePath = "product/plans/oss-v1/state/M0-07.json";
  const packageScopeState = await readFixtureJson(root, packageScopeStatePath);
  Object.assign(packageScopeState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: packageScopeState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: packageScopeState.gates.map((gate) => ({
      ...gate,
      status: "pending",
      evidenceRefs: [],
    })),
    reviews: [],
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset the V1-05 package-scope process task with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, packageScopeStatePath, packageScopeState);

  const goldenRepositoryStatePath = "product/plans/oss-v1/state/V1-02.json";
  const goldenRepositoryState = await readFixtureJson(root, goldenRepositoryStatePath);
  Object.assign(goldenRepositoryState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: goldenRepositoryState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: goldenRepositoryState.gates.map((gate) => ({
      ...gate,
      status: "pending",
      evidenceRefs: [],
    })),
    reviews: goldenRepositoryState.reviews.map((review) => ({
      ...review,
      status: "pending",
      evidenceRefs: [],
    })),
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset the golden-repository task with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, goldenRepositoryStatePath, goldenRepositoryState);

  const scannerStatePath = "product/plans/oss-v1/state/V1-03.json";
  const scannerState = await readFixtureJson(root, scannerStatePath);
  Object.assign(scannerState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: scannerState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: scannerState.gates.map((gate) => ({ ...gate, status: "pending", evidenceRefs: [] })),
    reviews: scannerState.reviews.map((review) => ({
      ...review,
      status: "pending",
      evidenceRefs: [],
    })),
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset scanner lifecycle data with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, scannerStatePath, scannerState);

  const manifestStatePath = "product/plans/oss-v1/state/V1-04.json";
  const manifestState = await readFixtureJson(root, manifestStatePath);
  Object.assign(manifestState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: manifestState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: manifestState.gates.map((gate) => ({ ...gate, status: "pending", evidenceRefs: [] })),
    reviews: manifestState.reviews.map((review) => ({
      ...review,
      status: "pending",
      evidenceRefs: [],
    })),
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset the manifest task with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, manifestStatePath, manifestState);

  for (const taskId of downstreamV1TaskIds) {
    const statePath = `product/plans/oss-v1/state/${taskId}.json`;
    const state = await readFixtureJson(root, statePath);
    Object.assign(state, {
      revision: 0,
      state: "planned",
      attempt: 0,
      candidate: null,
      criteria: state.criteria.map((criterion) => ({
        ...criterion,
        status: "pending",
        evidenceRefs: [],
      })),
      gates: state.gates.map((gate) => ({ ...gate, status: "pending", evidenceRefs: [] })),
      reviews: state.reviews.map((review) => ({
        ...review,
        status: "pending",
        evidenceRefs: [],
      })),
      blockers: [],
      history: [
        {
          from: null,
          to: "planned",
          at: "2026-08-10T00:00:00Z",
          actor: "task-test-fixture",
          reason: `Reset ${taskId} lifecycle data with the V1-00 fixture baseline.`,
        },
      ],
    });
    await writeFixtureJson(root, statePath, state);
  }

  const fixtureScopeStatePath = "product/plans/oss-v1/state/M0-08.json";
  const fixtureScopeState = await readFixtureJson(root, fixtureScopeStatePath);
  Object.assign(fixtureScopeState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: fixtureScopeState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: fixtureScopeState.gates.map((gate) => ({
      ...gate,
      status: "pending",
      evidenceRefs: [],
    })),
    reviews: [],
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-11T21:35:00Z",
        actor: "task-test-fixture",
        reason: "Reset M0-08 with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, fixtureScopeStatePath, fixtureScopeState);

  const dependentStatePath = "product/plans/oss-v1/state/V1-01.json";
  const dependentState = await readFixtureJson(root, dependentStatePath);
  Object.assign(dependentState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: dependentState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: dependentState.gates.map((gate) => ({ ...gate, status: "pending", evidenceRefs: [] })),
    reviews: dependentState.reviews.map((review) => ({
      ...review,
      status: "pending",
      evidenceRefs: [],
    })),
    blockers: [],
    history: [
      {
        from: null,
        to: "planned",
        at: "2026-08-10T00:00:00Z",
        actor: "task-test-fixture",
        reason: "Reset dependent V1-01 lifecycle data with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, dependentStatePath, dependentState);

  const ledgerPath = "product/plans/oss-v1/acceptance-ledger.json";
  const ledger = await readFixtureJson(root, ledgerPath);
  ledger.items = ledger.items.map((item) =>
    fixtureTaskIds.includes(item.taskId) ? { ...item, status: "planned", evidenceRefs: [] } : item,
  );
  await writeFixtureJson(root, ledgerPath, ledger);

  const evidenceDirectory = path.join(root, "product/plans/oss-v1/evidence");
  for (const filename of await readdir(evidenceDirectory)) {
    if (!filename.endsWith(".json")) continue;
    const evidencePath = path.join(evidenceDirectory, filename);
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    if (fixtureTaskIds.includes(evidence.taskId)) await rm(evidencePath);
  }

  const writeResult = runPlan(root, "write");
  if (writeResult.status !== 0)
    throw new Error(`could not normalize V1-00 task fixture: ${writeResult.stderr}`);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("task packet compiler", () => {
  it("compiles narrow continuation as a bounded high-risk process packet", async () => {
    const root = await createFixture();
    const planPath = "product/plans/oss-v1/plan.json";
    const plan = await readFixtureJson(root, planPath);
    plan.tasks.find((task) => task.id === "M0-11").dependsOn = [];
    await writeFixtureJson(root, planPath, plan);

    const statePath = "product/plans/oss-v1/state/M0-11.json";
    const state = await readFixtureJson(root, statePath);
    Object.assign(state, {
      state: "in_progress",
      attempt: 1,
      history: [
        ...state.history,
        {
          from: "planned",
          to: "in_progress",
          at: "2026-08-13T17:32:17Z",
          actor: "task-test-fixture",
          reason: "Exercise the portable continuation packet.",
        },
      ],
    });
    await writeFixtureJson(root, statePath, state);
    const writeResult = runPlan(root, "write");
    expect(writeResult.status, writeResult.stderr).toBe(0);

    const result = runTask(root, "compile", "M0-11");
    expect(result.status, result.stderr).toBe(0);
    const packet = JSON.parse(result.stdout);
    expect(packet).toMatchObject({
      task_id: "M0-11",
      risk_class: "high",
      required_worker_chain: ["task-executor", "validation-gate", "code-review", "commit-push"],
      required_domain_review_chain: [],
      lifecycle_gates: {
        code_review_required: true,
        trust_review_required: false,
      },
      currentState: { state: "in_progress", candidate: null },
    });
    expect(packet.allowed_paths).toContain(".agents/skills/vetryn-continue-next/**");
    expect(packet.task.capabilities).toEqual({
      network: false,
      credentials: false,
      provider: false,
      githubWrite: false,
    });
  });

  it("isolates task fixtures from promoted canonical V1-00 lifecycle data", async () => {
    const root = await createFixture();
    const evidenceId = "ev-v1-promoted-review-fixture";
    const evidencePath = `product/plans/oss-v1/evidence/${evidenceId}.json`;
    await writeFixtureJson(root, evidencePath, {
      id: evidenceId,
      taskId: v1TaskId,
      type: "review",
    });

    const statePath = "product/plans/oss-v1/state/V1-00.json";
    const state = await readFixtureJson(root, statePath);
    state.revision = 99;
    state.state = "accepted";
    state.candidate = {
      baseCommit: "b".repeat(40),
      commit: "a".repeat(40),
      executor: "implementation-agent",
    };
    state.criteria = state.criteria.map((criterion) => ({
      ...criterion,
      status: "pass",
      evidenceRefs: [evidenceId],
    }));
    state.gates = state.gates.map((gate) => ({
      ...gate,
      status: "pass",
      evidenceRefs: [evidenceId],
    }));
    state.reviews = state.reviews.map((review) => ({
      ...review,
      status: "approved",
      evidenceRefs: [evidenceId],
    }));
    await writeFixtureJson(root, statePath, state);

    const ledgerPath = "product/plans/oss-v1/acceptance-ledger.json";
    const ledger = await readFixtureJson(root, ledgerPath);
    ledger.items = ledger.items.map((item) =>
      item.taskId === v1TaskId ? { ...item, status: "accepted", evidenceRefs: [evidenceId] } : item,
    );
    await writeFixtureJson(root, ledgerPath, ledger);

    const progressPath = "product/plans/oss-v1/progress.json";
    const progress = await readFixtureJson(root, progressPath);
    const taskProgress = progress.tasks.find((task) => task.taskId === v1TaskId);
    taskProgress.state = "accepted";
    taskProgress.acceptedCriteria = taskProgress.totalCriteria;
    progress.nextLegalTasks = ["V1-01", "V1-02"];
    await writeFixtureJson(root, progressPath, progress);

    await normalizeV1Fixture(root);

    await expect(readFile(path.join(root, evidencePath), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const nextResult = runTask(root, "next");
    expect(nextResult.status, nextResult.stderr).toBe(0);
    expect(JSON.parse(nextResult.stdout)).toEqual({
      planId: "oss-v1",
      activeTasks: [{ taskId: v1TaskId, state: "in_progress" }],
      nextLegalTasks: [],
      blockedTasks: [],
    });
    const compileResult = runTask(root, "compile", v1TaskId);
    expect(compileResult.status, compileResult.stderr).toBe(0);
    expect(JSON.parse(compileResult.stdout)).toMatchObject({
      packetId: "oss-v1:V1-00:r5",
      currentState: { state: "in_progress", candidate: null },
    });
  }, 10_000);

  it("reports active and next legal work from generated progress", async () => {
    const root = await createFixture();
    const result = runTask(root, "next");

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      planId: "oss-v1",
      activeTasks: [{ taskId: "V1-00", state: "in_progress" }],
      nextLegalTasks: [],
      blockedTasks: [],
    });
  });

  it("compiles a deterministic single-maintainer packet for an active task", async () => {
    const root = await createFixture();
    const first = runTask(root, "compile", "V1-00");
    const second = runTask(root, "compile", "V1-00");

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    const packet = JSON.parse(first.stdout);
    expect(packet).toMatchObject({
      packetId: "oss-v1:V1-00:r5",
      source: { productContract: "docs/oss-v1.md" },
      task: { id: "V1-00" },
      currentState: { state: "in_progress", attempt: 1, maxAttempts: 2 },
      task_id: "V1-00",
      risk_class: "medium",
      worker_type: "task-executor",
      semantic_risk_report_ref: ".factory/artifacts/task-runs/V1-00/semantic-risk-report.json",
      semantic_risk_integrity_marker_ref:
        ".factory/artifacts/task-runs/V1-00/semantic-risk-integrity-marker.json",
      retry_budget: { max_attempts: 2, current_attempt: 1, remaining_attempts: 1 },
      execution: {
        executorMayAccept: false,
        verifierMustDifferFromExecutor: false,
        maintainerApprovalRequired: true,
        progressIsGenerated: true,
      },
      factory_compatibility: {
        factory_contract_version: "1.0",
        canonical_factory_source: {
          repository: "https://github.com/Clyra-AI/factory",
          profile_path: "profiles/vetryn.yaml",
        },
      },
    });
    expect(packet.source.productContractDigest).toBe(
      packet.source.digests[packet.source.productContract],
    );
    expect(Object.keys(packet.source.digests)).toEqual([
      "docs/oss-v1.md",
      "product/plans/oss-v1/plan.json",
      "pnpm-lock.yaml",
      ".factory/profile.yaml",
      "product/plans/schemas/semantic-risk-report-v0.1.schema.json",
      "product/plans/schemas/semantic-risk-report-v0.2.schema.json",
    ]);
    expect(packet.allowed_paths).toContain(packet.semantic_risk_report_ref);
    expect(packet.allowed_paths).toContain(packet.semantic_risk_integrity_marker_ref);
    expect(packet.allowed_paths).toContain("vitest.config.ts");
    expect(packet.required_worker_chain).toEqual(packet.execution.factorySkills);
    expect(packet.required_worker_chain).toEqual([
      "task-executor",
      "validation-gate",
      "commit-push",
    ]);
    expect(packet.required_worker_chain).not.toContain("ship-pr");
    expect(packet.required_domain_review_chain).toEqual(["vetryn-trust-review"]);
    expect(packet.worker_evidence_required).toEqual(packet.evidence_required);
    expect(packet.lifecycle_evidence_required).toEqual([
      "validation_report",
      "trust_review_report",
      "github_review_evidence",
      "ship_packet",
      "pr_lifecycle_report",
      "post_merge_report",
      "canonical_promotion",
    ]);
    expect(packet.lifecycle_evidence_required).not.toContain("scope_closure_report");
    expect(Object.keys(packet.lifecycle_evidence_refs)).toEqual(packet.lifecycle_evidence_required);
    expect(packet.lifecycle_evidence_refs.trust_review_report).toBe(
      "product/plans/oss-v1/evidence/lifecycle/V1-00/unbound/trust_review_report.json",
    );
    expect(
      Object.values(packet.lifecycle_evidence_refs).every((artifactRef) =>
        artifactRef.includes(`/V1-00/`),
      ),
    ).toBe(true);
    expect(packet.lifecycle_gates).toMatchObject({
      code_review_required: false,
      trust_review_required: true,
      codex_review_required: false,
      post_merge_monitor_required: true,
      pr_lifecycle_report_required: true,
    });
    expect(packet.acceptance_result_requirements[0].lifecycle_evidence_required).toEqual([
      "github_review_evidence",
      "canonical_promotion",
    ]);
    expect(packet.acceptance_result_requirements[1].lifecycle_evidence_required).toEqual([
      "validation_report",
      "canonical_promotion",
    ]);
    expect(
      packet.acceptance_result_requirements.every(
        (item) => !item.lifecycle_evidence_required.includes("scope_closure_report"),
      ),
    ).toBe(true);
    expect(packet.changelog_intent.semver_marker).toBe("none");
    expect(packet.acceptance_result_requirements.map((item) => item.acceptance_item_id)).toEqual([
      "PLAN-001",
      "PLAN-002",
      "PLAN-003",
      "PLAN-004",
    ]);
    await writeFixtureJson(root, "unbound-packet.json", packet);
    const unboundValidation = runTask(root, "validate", "unbound-packet.json");
    expect(unboundValidation.status).toBe(1);
    expect(unboundValidation.stderr).toContain("lifecycle preflight requires a bound candidate");

    const factoryProfilePath = path.join(root, ".factory/profile.yaml");
    const factoryProfile = await readFile(factoryProfilePath, "utf8");
    await writeFile(
      factoryProfilePath,
      factoryProfile.replace("    - destructive_behavior", "    - non_destructive_behavior"),
    );
    const downgradedProfileCompile = runTask(root, "compile", "V1-00");
    expect(downgradedProfileCompile.status).toBe(1);
    expect(downgradedProfileCompile.stderr).toContain(
      "portable Factory implementation_risk does not match the pinned canonical policy",
    );
    await writeFile(
      factoryProfilePath,
      factoryProfile.replace(/^ {2}commit: [0-9a-f]{40}$/mu, "  revision: omitted"),
    );
    const missingSourcePinCompile = runTask(root, "compile", "V1-00");
    expect(missingSourcePinCompile.status).toBe(1);
    expect(missingSourcePinCompile.stderr).toContain(
      "portable Factory profile does not pin canonical commit",
    );
    for (const portableSchemaField of [
      "portable_semantic_risk_legacy_schema",
      "portable_semantic_risk_schema",
    ]) {
      await writeFile(
        factoryProfilePath,
        factoryProfile.replace(
          new RegExp(`^  ${portableSchemaField}: .*$`, "mu"),
          `  ${portableSchemaField}: redirected/schema.json`,
        ),
      );
      const redirectedSchemaCompile = runTask(root, "compile", "V1-00");
      expect(redirectedSchemaCompile.status).toBe(1);
      expect(redirectedSchemaCompile.stderr).toContain(
        `portable Factory profile does not pin canonical ${portableSchemaField}`,
      );
    }
    await writeFile(
      factoryProfilePath,
      `${factoryProfile}\nimplementation_risk:\n  enabled: false\n`,
    );
    const duplicateRiskBlockCompile = runTask(root, "compile", "V1-00");
    expect(duplicateRiskBlockCompile.status).toBe(1);
    expect(duplicateRiskBlockCompile.stderr).toContain("portable Factory profile is invalid YAML");

    await writeFile(
      factoryProfilePath,
      `${factoryProfile}\ncanonical_factory_profile: redirected/profile.yaml\n`,
    );
    const duplicateProfilePinCompile = runTask(root, "compile", "V1-00");
    expect(duplicateProfilePinCompile.status).toBe(1);
    expect(duplicateProfilePinCompile.stderr).toContain("portable Factory profile is invalid YAML");
  }, 15_000);

  it("requires frozen-candidate structured review evidence for high-risk tasks", async () => {
    const root = await createFixture();
    const planPath = "product/plans/oss-v1/plan.json";
    const plan = await readFixtureJson(root, planPath);
    plan.tasks.find((task) => task.id === v1TaskId).risk.level = "high";
    await writeFixtureJson(root, planPath, plan);

    const result = runTask(root, "compile", v1TaskId);

    expect(result.status, result.stderr).toBe(0);
    const packet = JSON.parse(result.stdout);
    expect(packet.required_worker_chain).toEqual([
      "task-executor",
      "validation-gate",
      "code-review",
      "commit-push",
    ]);
    expect(packet.execution.factorySkills).toEqual(packet.required_worker_chain);
    expect(packet.lifecycle_gates).toMatchObject({
      code_review_required: true,
      codex_review_required: false,
    });
    expect(packet.lifecycle_evidence_required).toContain("review_report");
    expect(packet.lifecycle_evidence_refs.review_report).toBe(
      "product/plans/oss-v1/evidence/lifecycle/V1-00/unbound/review_report.json",
    );
    expect(packet.stop_conditions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("semantic_risk_report"),
        expect.stringContaining("review_report"),
        expect.stringContaining("candidate changes"),
      ]),
    );

    const schema = await readFixtureJson(root, "product/plans/schemas/task-packet.schema.json");
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const unsafe = globalThis.structuredClone(packet);
    delete unsafe.semantic_risk_report_ref;
    unsafe.required_worker_chain = unsafe.required_worker_chain.filter(
      (worker) => worker !== "code-review",
    );
    unsafe.execution.factorySkills = unsafe.execution.factorySkills.filter(
      (worker) => worker !== "code-review",
    );
    unsafe.lifecycle_gates.code_review_required = false;
    unsafe.lifecycle_evidence_required = unsafe.lifecycle_evidence_required.filter(
      (item) => item !== "review_report",
    );
    delete unsafe.lifecycle_evidence_refs.review_report;

    expect(validate(unsafe)).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instancePath: "/required_worker_chain", keyword: "const" }),
        expect.objectContaining({ instancePath: "", keyword: "required" }),
        expect.objectContaining({
          instancePath: "/lifecycle_gates/code_review_required",
          keyword: "const",
        }),
        expect.objectContaining({
          instancePath: "/lifecycle_evidence_required",
          keyword: "contains",
        }),
        expect.objectContaining({
          instancePath: "/lifecycle_evidence_refs",
          keyword: "required",
        }),
      ]),
    );
  });

  it("compiles the actual V1-05 package and release scope for clean installs", async () => {
    const root = await createFixture();
    const planPath = "product/plans/oss-v1/plan.json";
    const plan = await readFixtureJson(root, planPath);
    await writeFile(path.join(root, "docs/candidate-contract.md"), "Candidate contract.\n");
    const task = plan.tasks.find((candidate) => candidate.id === "V1-05");
    task.dependsOn = [];
    await writeFixtureJson(root, planPath, plan);
    expect(runPlan(root, "write").status).toBe(0);

    const originalTask = globalThis.structuredClone(task);
    task.deliverables = ["packages/typescript/**", "packages/cli/**"];
    task.scope.allowedPaths = task.scope.allowedPaths.map((allowedPath) =>
      allowedPath === "packages/openrouter/**" ? "packages/typescript/**" : allowedPath,
    );
    task.scope.forbiddenPaths = ["packages/openrouter/**", "action.yml"];
    await writeFixtureJson(root, planPath, plan);
    expect(runPlan(root, "write").status).toBe(0);
    const alternateResult = runTask(root, "compile", "V1-05");
    expect(alternateResult.status, alternateResult.stderr).toBe(0);
    expect(
      JSON.parse(alternateResult.stdout).docs_sync_refs.map(({ path: docPath }) => docPath),
    ).toEqual([
      "packages/typescript/README.md",
      "packages/cli/README.md",
      "examples/openrouter-typescript/README.md",
    ]);

    plan.tasks[plan.tasks.findIndex((candidate) => candidate.id === "V1-05")] = originalTask;
    await writeFixtureJson(root, planPath, plan);
    expect(runPlan(root, "write").status).toBe(0);
    const sourceRevision = createGitCandidate(root);

    const preflightResult = runTask(root, "compile", "V1-05");
    expect(preflightResult.status, preflightResult.stderr).toBe(0);
    const preflightPacket = JSON.parse(preflightResult.stdout);
    await writeSemanticRiskEvidence(root, preflightPacket, sourceRevision);
    const candidateCommit = commitGitChanges(
      root,
      "commit semantic-risk evidence",
      ".factory/artifacts",
    );

    const statePath = "product/plans/oss-v1/state/V1-05.json";
    const state = await readFixtureJson(root, statePath);
    Object.assign(state, {
      revision: 2,
      state: "verification_pending",
      attempt: 1,
      candidate: {
        baseCommit: "2222222222222222222222222222222222222222",
        commit: candidateCommit,
        executor: "task-test-fixture",
      },
      history: [
        ...state.history,
        {
          from: "planned",
          to: "in_progress",
          at: "2026-08-10T01:00:00Z",
          actor: "task-test-fixture",
          reason: "Exercise the actual V1-05 executable packet.",
        },
        {
          from: "in_progress",
          to: "verification_pending",
          at: "2026-08-10T01:01:00Z",
          actor: "task-test-fixture",
          reason: "Bind lifecycle refs to the frozen fixture candidate.",
        },
      ],
    });
    await writeFixtureJson(root, statePath, state);
    const writeResult = runPlan(root, "write");
    expect(writeResult.status, writeResult.stderr).toBe(0);

    const result = runTask(root, "compile", "V1-05");
    expect(result.status, result.stderr).toBe(0);
    const packet = JSON.parse(result.stdout);
    expect(packet.allowed_paths).toEqual(
      expect.arrayContaining([
        ".changeset/**",
        "knip.json",
        "package.json",
        "pnpm-lock.yaml",
        "vitest.config.ts",
        ".factory/artifacts/task-runs/V1-05/semantic-risk-report.json",
        ".factory/artifacts/task-runs/V1-05/semantic-risk-integrity-marker.json",
      ]),
    );
    expect(packet.semantic_risk_report_ref).toBe(
      ".factory/artifacts/task-runs/V1-05/semantic-risk-report.json",
    );
    expect(packet.changelog_intent).toMatchObject({
      impact: "required",
      semver_marker: "minor",
    });
    expect(packet.versioning_impact).toContain("minor Changeset");
    expect(packet.docs_sync_refs.map(({ path: docPath }) => docPath)).toEqual([
      "packages/openrouter/README.md",
      "packages/cli/README.md",
      "examples/openrouter-typescript/README.md",
    ]);
    expect(packet.lifecycle_evidence_refs.review_report).toBe(
      `product/plans/oss-v1/evidence/lifecycle/V1-05/${candidateCommit}/review_report.json`,
    );
    expect(Object.keys(packet.lifecycle_evidence_refs)).toEqual(packet.lifecycle_evidence_required);
    expect(packet.packet_validation_command).toBe("node scripts/task.mjs validate {packet_path}");
    await writeFixtureJson(root, "candidate-packet.json", packet);
    const validCandidate = runTask(root, "validate", "candidate-packet.json");
    expect(validCandidate.status, validCandidate.stderr).toBe(0);

    const semanticReport = await readFile(path.join(root, packet.semantic_risk_report_ref), "utf8");
    await writeFile(
      path.join(root, packet.semantic_risk_report_ref),
      semanticReport.replace(sourceRevision, "f".repeat(40)),
    );
    const workingTreeTamper = runTask(root, "validate", "candidate-packet.json");
    expect(workingTreeTamper.status, workingTreeTamper.stderr).toBe(0);
    await writeFile(path.join(root, packet.semantic_risk_report_ref), semanticReport);

    const factoryProfilePath = path.join(root, ".factory/profile.yaml");
    const factoryProfile = await readFile(factoryProfilePath, "utf8");
    await writeFile(factoryProfilePath, `${factoryProfile}\n# unreviewed policy drift\n`);
    const staleProfileValidation = runTask(root, "validate", "candidate-packet.json");
    expect(staleProfileValidation.status).toBe(1);
    expect(staleProfileValidation.stderr).toContain(
      "source digest is stale for .factory/profile.yaml",
    );
    await writeFile(factoryProfilePath, factoryProfile);
    expect(runTask(root, "validate", "candidate-packet.json").status).toBe(0);

    const legacySchemaPath = path.join(
      root,
      "product/plans/schemas/semantic-risk-report-v0.1.schema.json",
    );
    const legacySchema = await readFile(legacySchemaPath, "utf8");
    await writeFile(legacySchemaPath, `${legacySchema}\n`);
    const staleLegacySchemaValidation = runTask(root, "validate", "candidate-packet.json");
    expect(staleLegacySchemaValidation.status).toBe(1);
    expect(staleLegacySchemaValidation.stderr).toContain(
      "portable semantic-risk legacy schema does not match the pinned canonical Factory schema",
    );
    await writeFile(legacySchemaPath, legacySchema);
    expect(runTask(root, "validate", "candidate-packet.json").status).toBe(0);

    const rewrittenPacketId = globalThis.structuredClone(packet);
    rewrittenPacketId.packetId = "other-plan:V1-06:r999";
    await writeFixtureJson(root, "rewritten-packet-id.json", rewrittenPacketId);
    const rewrittenPacketIdValidation = runTask(root, "validate", "rewritten-packet-id.json");
    expect(rewrittenPacketIdValidation.status).toBe(1);
    expect(rewrittenPacketIdValidation.stderr).toContain(
      "packetId does not match canonical plan and task",
    );

    const reorderedPacket = globalThis.structuredClone(packet);
    reorderedPacket.lifecycle_gates = Object.fromEntries(
      Object.entries(reorderedPacket.lifecycle_gates).reverse(),
    );
    reorderedPacket.task.risk = Object.fromEntries(
      Object.entries(reorderedPacket.task.risk).reverse(),
    );
    reorderedPacket.source.digests = Object.fromEntries(
      Object.entries(reorderedPacket.source.digests).reverse(),
    );
    await writeFixtureJson(root, "reordered-packet.json", reorderedPacket);
    const reorderedValidation = runTask(root, "validate", "reordered-packet.json");
    expect(reorderedValidation.status, reorderedValidation.stderr).toBe(0);

    const unrelatedPlan = await readFixtureJson(root, planPath);
    unrelatedPlan.tasks.find((candidate) => candidate.id === "V1-06").objective +=
      " Unrelated planning clarification.";
    await writeFixtureJson(root, planPath, unrelatedPlan);
    expect(runTask(root, "validate", "candidate-packet.json").status).toBe(0);
    expect(runTask(root, "compile", "V1-05").status).toBe(0);

    const relevantPlan = globalThis.structuredClone(unrelatedPlan);
    relevantPlan.tasks.find((candidate) => candidate.id === "V1-05").objective +=
      " Unreviewed task-policy change.";
    await writeFixtureJson(root, planPath, relevantPlan);
    const relevantPlanValidation = runTask(root, "validate", "candidate-packet.json");
    expect(relevantPlanValidation.status).toBe(1);
    expect(relevantPlanValidation.stderr).toContain("task does not match canonical plan");
    const relevantPlanCompile = runTask(root, "compile", "V1-05");
    expect(relevantPlanCompile.status).toBe(1);
    expect(relevantPlanCompile.stderr).toContain(
      "canonical task policy has drifted from candidate",
    );
    await writeFixtureJson(root, planPath, plan);

    const metadataPlan = globalThis.structuredClone(plan);
    metadataPlan.baseline.repository = "https://github.com/Clyra-AI/other-repository";
    await writeFixtureJson(root, planPath, metadataPlan);
    const repositoryMetadataCompile = runTask(root, "compile", "V1-05");
    expect(repositoryMetadataCompile.status).toBe(1);
    expect(repositoryMetadataCompile.stderr).toContain(
      "canonical plan source metadata has drifted from candidate",
    );

    metadataPlan.baseline.repository = plan.baseline.repository;
    metadataPlan.baseline.commit = "3".repeat(40);
    await writeFixtureJson(root, planPath, metadataPlan);
    const baselineMetadataCompile = runTask(root, "compile", "V1-05");
    expect(baselineMetadataCompile.status).toBe(1);
    expect(baselineMetadataCompile.stderr).toContain(
      "canonical plan source metadata has drifted from candidate",
    );

    metadataPlan.baseline.commit = plan.baseline.commit;
    metadataPlan.productContract = "docs/candidate-contract.md";
    await writeFixtureJson(root, planPath, metadataPlan);
    const contractMetadataCompile = runTask(root, "compile", "V1-05");
    expect(contractMetadataCompile.status).toBe(1);
    expect(contractMetadataCompile.stderr).toContain(
      "canonical plan source metadata has drifted from candidate",
    );
    await writeFixtureJson(root, planPath, plan);

    const ledgerPath = "product/plans/oss-v1/acceptance-ledger.json";
    const canonicalLedger = await readFixtureJson(root, ledgerPath);
    const unrelatedLedger = globalThis.structuredClone(canonicalLedger);
    unrelatedLedger.items.find((item) => item.taskId === "V1-06").statement +=
      " Unrelated acceptance clarification.";
    await writeFixtureJson(root, ledgerPath, unrelatedLedger);
    expect(runTask(root, "validate", "candidate-packet.json").status).toBe(0);
    expect(runTask(root, "compile", "V1-05").status).toBe(0);

    const relevantLedger = globalThis.structuredClone(unrelatedLedger);
    relevantLedger.items.find((item) => item.taskId === "V1-05").waivable = true;
    await writeFixtureJson(root, ledgerPath, relevantLedger);
    const relevantLedgerCompile = runTask(root, "compile", "V1-05");
    expect(relevantLedgerCompile.status).toBe(1);
    expect(relevantLedgerCompile.stderr).toContain(
      "canonical acceptance policy has drifted from candidate",
    );
    await writeFixtureJson(root, ledgerPath, canonicalLedger);

    const productContractPath = path.join(root, "docs/oss-v1.md");
    const productContract = await readFile(productContractPath, "utf8");
    await writeFile(productContractPath, `${productContract}\nCandidate-external drift.\n`);
    const driftedCandidateCompile = runTask(root, "compile", "V1-05");
    expect(driftedCandidateCompile.status).toBe(1);
    expect(driftedCandidateCompile.stderr).toContain("source digest is stale for docs/oss-v1.md");
    await writeFile(productContractPath, productContract);

    const canonicalPlan = await readFixtureJson(root, planPath);
    const malformedPlan = globalThis.structuredClone(canonicalPlan);
    malformedPlan.tasks.push(globalThis.structuredClone(malformedPlan.tasks[0]));
    await writeFixtureJson(root, planPath, malformedPlan);
    const malformedCanonicalValidation = runTask(root, "validate", "candidate-packet.json");
    expect(malformedCanonicalValidation.status).toBe(1);
    expect(malformedCanonicalValidation.stderr).toContain("canonical plan is invalid");
    await writeFixtureJson(root, planPath, canonicalPlan);

    state.state = "review_pending";
    state.history.push({
      from: "verification_pending",
      to: "review_pending",
      at: "2026-08-10T01:02:00Z",
      actor: "task-test-fixture",
      reason: "Prove lifecycle-only state movement preserves the frozen candidate packet.",
    });
    await writeFixtureJson(root, statePath, state);
    expect(runPlan(root, "write").status).toBe(0);
    expect(runTask(root, "validate", "candidate-packet.json").status).toBe(0);

    state.state = "blocked";
    state.blockers = [{ id: "BLOCK-001", summary: "Fixture lifecycle halt." }];
    state.history.push({
      from: "review_pending",
      to: "blocked",
      at: "2026-08-10T01:03:00Z",
      actor: "task-test-fixture",
      reason: "Prove canonical lifecycle halts invalidate stored packet preflight.",
    });
    await writeFixtureJson(root, statePath, state);
    expect(runPlan(root, "write").status).toBe(0);
    const haltedValidation = runTask(root, "validate", "candidate-packet.json");
    expect(haltedValidation.status).toBe(1);
    expect(haltedValidation.stderr).toContain("canonical task state is halted");

    state.state = "review_pending";
    state.blockers = [];
    state.history.push({
      from: "blocked",
      to: "review_pending",
      at: "2026-08-10T01:04:00Z",
      actor: "task-test-fixture",
      reason: "Restore the fixture after the halted-state assertion.",
    });
    await writeFixtureJson(root, statePath, state);
    expect(runPlan(root, "write").status).toBe(0);

    const blockedLedger = globalThis.structuredClone(canonicalLedger);
    const blockedAcceptance = blockedLedger.items.find((item) => item.taskId === "V1-05");
    blockedAcceptance.status = "blocked";
    blockedAcceptance.evidenceRefs = [];
    await writeFixtureJson(root, ledgerPath, blockedLedger);
    expect(runPlan(root, "write").status).toBe(0);
    const blockedAcceptanceValidation = runTask(root, "validate", "candidate-packet.json");
    expect(blockedAcceptanceValidation.status).toBe(1);
    expect(blockedAcceptanceValidation.stderr).toContain("has an invalid promotion tail");
    await writeFixtureJson(root, ledgerPath, canonicalLedger);
    expect(runPlan(root, "write").status).toBe(0);

    const invalidBindings = [
      packet.lifecycle_evidence_refs.review_report.replace("/V1-05/", "/V1-06/"),
      packet.lifecycle_evidence_refs.review_report.replace(
        `/${candidateCommit}/`,
        "/3333333333333333333333333333333333333333/",
      ),
      packet.lifecycle_evidence_refs.review_report.replace(`/${candidateCommit}/`, "/unbound/"),
      packet.lifecycle_evidence_refs.review_report.replace(
        "/review_report.json",
        "/validation_report.json",
      ),
    ];
    for (const [index, invalidRef] of invalidBindings.entries()) {
      const invalidPacket = globalThis.structuredClone(packet);
      invalidPacket.lifecycle_evidence_refs.review_report = invalidRef;
      const packetPath = `invalid-candidate-packet-${index}.json`;
      await writeFixtureJson(root, packetPath, invalidPacket);
      const validation = runTask(root, "validate", packetPath);
      expect(validation.status).toBe(1);
      expect(validation.stderr).toContain("lifecycle evidence ref review_report must equal");
    }

    const forgedCandidatePacket = globalThis.structuredClone(packet);
    forgedCandidatePacket.currentState.candidate.commit =
      "3333333333333333333333333333333333333333";
    forgedCandidatePacket.lifecycle_evidence_refs = Object.fromEntries(
      Object.entries(forgedCandidatePacket.lifecycle_evidence_refs).map(
        ([artifact, artifactRef]) => [
          artifact,
          artifactRef.replace(`/${candidateCommit}/`, "/3333333333333333333333333333333333333333/"),
        ],
      ),
    );
    await writeFixtureJson(root, "forged-candidate-packet.json", forgedCandidatePacket);
    const forgedCandidateValidation = runTask(root, "validate", "forged-candidate-packet.json");
    expect(forgedCandidateValidation.status).toBe(1);
    expect(forgedCandidateValidation.stderr).toContain(
      "currentState.candidate does not match canonical task state",
    );

    const downgradedPolicyPacket = globalThis.structuredClone(packet);
    downgradedPolicyPacket.risk_class = "medium";
    downgradedPolicyPacket.required_worker_chain =
      downgradedPolicyPacket.required_worker_chain.filter((worker) => worker !== "code-review");
    downgradedPolicyPacket.execution.factorySkills =
      downgradedPolicyPacket.execution.factorySkills.filter((worker) => worker !== "code-review");
    downgradedPolicyPacket.lifecycle_gates.code_review_required = false;
    downgradedPolicyPacket.lifecycle_evidence_required =
      downgradedPolicyPacket.lifecycle_evidence_required.filter(
        (artifact) => artifact !== "review_report",
      );
    delete downgradedPolicyPacket.lifecycle_evidence_refs.review_report;
    await writeFixtureJson(root, "downgraded-policy-packet.json", downgradedPolicyPacket);
    const downgradedPolicyValidation = runTask(root, "validate", "downgraded-policy-packet.json");
    expect(downgradedPolicyValidation.status).toBe(1);
    expect(downgradedPolicyValidation.stderr).toContain("risk_class does not match canonical plan");

    const downgradedExecutorEvidence = globalThis.structuredClone(packet);
    downgradedExecutorEvidence.evidence_required = ["arbitrary_evidence"];
    downgradedExecutorEvidence.worker_evidence_required = ["arbitrary_evidence"];
    await writeFixtureJson(root, "downgraded-executor-evidence.json", downgradedExecutorEvidence);
    const downgradedExecutorValidation = runTask(
      root,
      "validate",
      "downgraded-executor-evidence.json",
    );
    expect(downgradedExecutorValidation.status).toBe(1);
    expect(downgradedExecutorValidation.stderr).toContain(
      "evidence_required does not match canonical plan",
    );

    const downgradedClosure = globalThis.structuredClone(packet);
    downgradedClosure.acceptance_result_requirements[0].evidence_mode = "manual_review";
    downgradedClosure.acceptance_result_requirements[0].closure_evidence =
      "acceptance_evidence_record";
    await writeFixtureJson(root, "downgraded-closure.json", downgradedClosure);
    const downgradedClosureValidation = runTask(root, "validate", "downgraded-closure.json");
    expect(downgradedClosureValidation.status).toBe(1);
    expect(downgradedClosureValidation.stderr).toContain(
      "acceptance_result_requirements does not match canonical plan",
    );

    const rewrittenAcceptance = globalThis.structuredClone(packet);
    rewrittenAcceptance.acceptanceItems[0].waivable = true;
    rewrittenAcceptance.acceptanceItems[0].verification.gateId = "QG-PLAN-CHECK";
    await writeFixtureJson(root, "rewritten-acceptance.json", rewrittenAcceptance);
    const rewrittenAcceptanceValidation = runTask(root, "validate", "rewritten-acceptance.json");
    expect(rewrittenAcceptanceValidation.status).toBe(1);
    expect(rewrittenAcceptanceValidation.stderr).toContain(
      "acceptanceItems policy does not match canonical plan",
    );

    const fabricatedAcceptanceTail = globalThis.structuredClone(packet);
    fabricatedAcceptanceTail.acceptanceItems[0].status = "accepted";
    fabricatedAcceptanceTail.acceptanceItems[0].evidenceRefs = ["ev-fabricated"];
    await writeFixtureJson(root, "fabricated-acceptance-tail.json", fabricatedAcceptanceTail);
    const fabricatedAcceptanceValidation = runTask(
      root,
      "validate",
      "fabricated-acceptance-tail.json",
    );
    expect(fabricatedAcceptanceValidation.status).toBe(1);
    expect(fabricatedAcceptanceValidation.stderr).toContain("has an invalid promotion tail");

    const forgedMutableDigest = globalThis.structuredClone(packet);
    forgedMutableDigest.source.digests["product/plans/oss-v1/acceptance-ledger.json"] = "0".repeat(
      64,
    );
    await writeFixtureJson(root, "forged-mutable-digest.json", forgedMutableDigest);
    const forgedMutableDigestValidation = runTask(root, "validate", "forged-mutable-digest.json");
    expect(forgedMutableDigestValidation.status).toBe(1);
    expect(forgedMutableDigestValidation.stderr).toContain(
      "source.digests keys does not match canonical plan",
    );

    const disabledScanner = globalThis.structuredClone(packet);
    disabledScanner.security_scanner_gates.required = false;
    disabledScanner.security_scanner_gates.command_refs = ["echo skipped"];
    await writeFixtureJson(root, "disabled-scanner.json", disabledScanner);
    const disabledScannerValidation = runTask(root, "validate", "disabled-scanner.json");
    expect(disabledScannerValidation.status).toBe(1);
    expect(disabledScannerValidation.stderr).toContain(
      "security_scanner_gates does not match canonical plan",
    );

    const omittedReleaseIntent = globalThis.structuredClone(packet);
    omittedReleaseIntent.changelog_intent.impact = "not_required";
    omittedReleaseIntent.changelog_intent.section = "Unreleased";
    omittedReleaseIntent.changelog_intent.semver_marker = "none";
    omittedReleaseIntent.docs_sync_refs = [
      {
        path: "docs/oss-v1.md",
        reason: "Unrelated documentation replacement.",
      },
    ];
    await writeFixtureJson(root, "omitted-release-intent.json", omittedReleaseIntent);
    const omittedReleaseValidation = runTask(root, "validate", "omitted-release-intent.json");
    expect(omittedReleaseValidation.status).toBe(1);
    expect(omittedReleaseValidation.stderr).toContain(
      "changelog_intent does not match canonical plan",
    );

    const stalePlanPacket = globalThis.structuredClone(packet);
    stalePlanPacket.source.digests["product/plans/oss-v1/plan.json"] = "0".repeat(64);
    await writeFixtureJson(root, "stale-plan-packet.json", stalePlanPacket);
    const stalePlanValidation = runTask(root, "validate", "stale-plan-packet.json");
    expect(stalePlanValidation.status).toBe(1);
    expect(stalePlanValidation.stderr).toContain(
      "source digest is not bound to candidate for product/plans/oss-v1/plan.json",
    );
  }, 45_000);

  it("routes the actual V1-06 trust gate through the domain review skill", async () => {
    const root = await createFixture();
    const planPath = "product/plans/oss-v1/plan.json";
    const plan = await readFixtureJson(root, planPath);
    plan.tasks.find((task) => task.id === "V1-06").dependsOn = [];
    await writeFixtureJson(root, planPath, plan);

    const statePath = "product/plans/oss-v1/state/V1-06.json";
    const state = await readFixtureJson(root, statePath);
    Object.assign(state, {
      revision: 1,
      state: "in_progress",
      attempt: 1,
      candidate: null,
      history: [
        ...state.history,
        {
          from: "planned",
          to: "in_progress",
          at: "2026-08-10T01:00:00Z",
          actor: "task-test-fixture",
          reason: "Exercise the actual V1-06 executable packet.",
        },
      ],
    });
    await writeFixtureJson(root, statePath, state);
    const writeResult = runPlan(root, "write");
    expect(writeResult.status, writeResult.stderr).toBe(0);

    const result = runTask(root, "compile", "V1-06");
    expect(result.status, result.stderr).toBe(0);
    const packet = JSON.parse(result.stdout);
    expect(packet.required_domain_review_chain).toEqual(["vetryn-trust-review"]);
    expect(packet.lifecycle_gates.trust_review_required).toBe(true);
    expect(packet.lifecycle_evidence_required).toContain("trust_review_report");
    expect(packet.stop_conditions).toEqual(
      expect.arrayContaining([expect.stringContaining("vetryn-trust-review")]),
    );

    const schema = await readFixtureJson(root, "product/plans/schemas/task-packet.schema.json");
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const unsafe = globalThis.structuredClone(packet);
    unsafe.required_domain_review_chain = [];
    unsafe.lifecycle_gates.trust_review_required = false;
    unsafe.lifecycle_evidence_required = unsafe.lifecycle_evidence_required.filter(
      (item) => item !== "trust_review_report",
    );
    expect(validate(unsafe)).toBe(false);
  }, 10_000);

  it("preserves reviewed capability denials while declaring separate maintainer delivery authority", async () => {
    const root = await createFixture();
    const planPath = "product/plans/oss-v1/plan.json";
    const plan = await readFixtureJson(root, planPath);
    const task = plan.tasks.find((candidate) => candidate.id === v1TaskId);
    task.capabilities = {
      network: false,
      credentials: false,
      provider: false,
      githubWrite: false,
    };
    await writeFixtureJson(root, planPath, plan);

    const result = runTask(root, "compile", v1TaskId);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      task: {
        capabilities: {
          network: false,
          credentials: false,
          provider: false,
          githubWrite: false,
        },
      },
      execution: {
        deliveryPermissions: {
          mode: "factory-lifecycle-only",
          requiresExplicitMaintainerAuthorization: true,
          allowsProviderAccess: false,
        },
      },
    });
  });

  it("fails schema validation when a runner-required field is missing", async () => {
    const root = await createFixture();
    const result = runTask(root, "compile", "V1-00");
    expect(result.status, result.stderr).toBe(0);
    const packet = JSON.parse(result.stdout);
    delete packet.validation_commands;

    const schema = JSON.parse(
      await readFile(path.join(root, "product/plans/schemas/task-packet.schema.json"), "utf8"),
    );
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    expect(validate(packet)).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: "required",
          params: { missingProperty: "validation_commands" },
        }),
      ]),
    );
  });

  it("compiles an explicit reviewed delivery intent instead of generic release boilerplate", async () => {
    const root = await createFixture();
    const planPath = path.join(root, "product/plans/oss-v1/plan.json");
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    const task = plan.tasks.find(({ id }) => id === "V1-00");
    task.deliveryIntent = {
      changelog: {
        draftEntry: "Document the reviewed contract migration.",
        impact: "required",
        section: "Changed",
        semverMarker: "minor",
      },
      docsSyncRefs: [{ reason: "Public contract migration", path: "docs/oss-v1.md" }],
      migrationImpact: "Regenerate pre-release repository artifacts.",
      versioningImpact: "Record a minor Changeset for @vetryn/core.",
    };
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    const writeResult = runPlan(root, "write");
    expect(writeResult.status, writeResult.stderr).toBe(0);

    const result = runTask(root, "compile", "V1-00");
    expect(result.status, result.stderr).toBe(0);
    const packet = JSON.parse(result.stdout);
    expect(packet.changelog_intent).toEqual({
      draft_entry: "Document the reviewed contract migration.",
      impact: "required",
      section: "Changed",
      semver_marker: "minor",
    });
    expect(packet.versioning_impact).toBe("Record a minor Changeset for @vetryn/core.");
    expect(packet.migration_impact).toBe("Regenerate pre-release repository artifacts.");
    expect(packet.docs_sync_refs).toEqual([
      { path: "docs/oss-v1.md", reason: "Public contract migration" },
    ]);
  });

  it("changes the packet digest when the product contract changes", async () => {
    const root = await createFixture();
    const before = runTask(root, "compile", "V1-00");
    expect(before.status, before.stderr).toBe(0);
    const contractPath = path.join(root, "docs/oss-v1.md");
    await writeFile(contractPath, `${await readFile(contractPath, "utf8")}\ncontract drift\n`);

    const after = runTask(root, "compile", "V1-00");

    expect(after.status, after.stderr).toBe(0);
    expect(JSON.parse(after.stdout).source.productContractDigest).not.toBe(
      JSON.parse(before.stdout).source.productContractDigest,
    );
  });

  it.each(["verification_pending", "review_pending"])(
    "compiles a packet while a candidate is %s",
    async (stateName) => {
      const root = await createFixture();
      const statePath = path.join(root, "product/plans/oss-v1/state/V1-00.json");
      const state = JSON.parse(await readFile(statePath, "utf8"));
      state.state = stateName;
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
      const writeResult = runPlan(root, "write");
      expect(writeResult.status, writeResult.stderr).toBe(0);

      const result = runTask(root, "compile", "V1-00");

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).currentState.state).toBe(stateName);
    },
  );

  it("refuses a planned task whose dependency is not accepted", async () => {
    const root = await createFixture();
    const result = runTask(root, "compile", "V1-01");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("is planned and is not legal to compile");
  });

  it("fails closed when generated progress is stale", async () => {
    const root = await createFixture();
    await writeFile(
      path.join(root, "product/plans/oss-v1/progress.json"),
      `${JSON.stringify({ planId: "oss-v1" })}\n`,
    );
    const result = runTask(root, "compile", "V1-00");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("canonical plan is invalid");
  });
});

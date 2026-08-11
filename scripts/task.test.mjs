import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const fixtureTaskIds = [v1TaskId, "M0-01", "M0-02", "M0-03", "M0-04", "V1-01"];
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
  });

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
      retry_budget: { max_attempts: 2, current_attempt: 1, remaining_attempts: 1 },
      execution: {
        executorMayAccept: false,
        verifierMustDifferFromExecutor: false,
        maintainerApprovalRequired: true,
        progressIsGenerated: true,
      },
    });
    expect(packet.source.productContractDigest).toBe(
      packet.source.digests[packet.source.productContract],
    );
    expect(Object.keys(packet.source.digests)).toHaveLength(5);
    expect(packet.allowed_paths).toContain("vitest.config.ts");
    expect(packet.required_worker_chain).toEqual(packet.execution.factorySkills);
    expect(packet.required_worker_chain).toEqual([
      "task-executor",
      "validation-gate",
      "commit-push",
    ]);
    expect(packet.required_worker_chain).not.toContain("ship-pr");
    expect(packet.worker_evidence_required).toEqual(packet.evidence_required);
    expect(packet.lifecycle_evidence_required).toEqual([
      "validation_report",
      "github_review_evidence",
      "ship_packet",
      "pr_lifecycle_report",
      "post_merge_report",
      "canonical_promotion",
    ]);
    expect(packet.lifecycle_evidence_required).not.toContain("scope_closure_report");
    expect(packet.lifecycle_gates).toMatchObject({
      code_review_required: false,
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
  });

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

import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";
import { check as checkPrettier } from "prettier";

import prettierConfig from "../prettier.config.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const planScript = path.join(repositoryRoot, "scripts/plan.mjs");
const temporaryRoots = [];
const bootstrapCommentId = 987654321;
const v1TaskId = "V1-00";
const v1FixtureTaskIds = [v1TaskId, "V1-01"];

function bootstrapBody(overrides = {}) {
  const values = {
    repository: "Clyra-AI/vetryn",
    pull_request: "5",
    task_id: "V1-00",
    candidate_sha: "a".repeat(40),
    decision: "APPROVED",
    roles: "maintainer,trust-reviewer",
    ...overrides,
  };
  return [
    "<!-- vetryn-bootstrap-review:v1 -->",
    `repository=${values.repository}`,
    `pull_request=${values.pull_request}`,
    `task_id=${values.task_id}`,
    `candidate_sha=${values.candidate_sha}`,
    `decision=${values.decision}`,
    `roles=${values.roles}`,
  ].join("\n");
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vetryn-plan-"));
  temporaryRoots.push(root);
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

async function digestFixture(root, relativePath) {
  const contents = await readFile(path.join(root, relativePath));
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

function runPlan(root, command = "check", env = {}) {
  return spawnSync(process.execPath, [planScript, command], {
    encoding: "utf8",
    env: { ...process.env, ...env, VETRYN_PLAN_REPO_ROOT: root },
  });
}

async function normalizeV1Fixture(root) {
  const statePath = "product/plans/oss-v1/state/V1-00.json";
  const state = await readFixtureJson(root, statePath);
  Object.assign(state, {
    revision: 0,
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
        actor: "plan-test-fixture",
        reason: "Deterministic V1-00 validator fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, statePath, state);

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
        actor: "plan-test-fixture",
        reason: "Reset dependent V1-01 lifecycle data with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, dependentStatePath, dependentState);

  const ledgerPath = "product/plans/oss-v1/acceptance-ledger.json";
  const ledger = await readFixtureJson(root, ledgerPath);
  ledger.items = ledger.items.map((item) =>
    v1FixtureTaskIds.includes(item.taskId)
      ? { ...item, status: "planned", evidenceRefs: [] }
      : item,
  );
  await writeFixtureJson(root, ledgerPath, ledger);

  const evidenceDirectory = path.join(root, "product/plans/oss-v1/evidence");
  for (const filename of await readdir(evidenceDirectory)) {
    if (!filename.endsWith(".json")) continue;
    const evidencePath = path.join(evidenceDirectory, filename);
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    if (v1FixtureTaskIds.includes(evidence.taskId)) await rm(evidencePath);
  }

  const writeResult = runPlan(root, "write");
  if (writeResult.status !== 0)
    throw new Error(`could not normalize V1-00 plan fixture: ${writeResult.stderr}`);
}

async function createV1Evidence(root, overrides = {}) {
  const evidence = await readFixtureJson(
    root,
    "product/plans/oss-v1/evidence/ev-m0-main-checks-20260809.json",
  );
  Object.assign(evidence, {
    id: "ev-v1-candidate-check",
    taskId: "V1-00",
    type: "command-run",
    actor: "implementation-agent",
    commit: "a".repeat(40),
    inputs: {
      planDigest: await digestFixture(root, "product/plans/oss-v1/plan.json"),
      lockfileDigest: await digestFixture(root, "pnpm-lock.yaml"),
    },
    gateBinding: {
      gateId: "QG-PLAN-CHECK",
      kind: "command",
      command: "pnpm plan:check",
    },
    review: null,
    ...overrides,
  });
  const relativePath = `product/plans/oss-v1/evidence/${evidence.id}.json`;
  await writeFixtureJson(root, relativePath, evidence);
  return evidence;
}

async function acceptV1ForProgressFixture(root) {
  const planPath = "product/plans/oss-v1/plan.json";
  const plan = await readFixtureJson(root, planPath);
  const task = plan.tasks.find((candidate) => candidate.id === v1TaskId);
  task.requiredGates = ["QG-PLAN-CHECK"];
  task.requiredReviews = [];
  await writeFixtureJson(root, planPath, plan);

  const ledgerPath = "product/plans/oss-v1/acceptance-ledger.json";
  const ledger = await readFixtureJson(root, ledgerPath);
  for (const item of ledger.items.filter((candidate) => candidate.taskId === v1TaskId))
    item.verification = {
      ...item.verification,
      method: "command",
      gateId: "QG-PLAN-CHECK",
    };
  await writeFixtureJson(root, ledgerPath, ledger);

  const evidence = await createV1Evidence(root);
  const statePath = "product/plans/oss-v1/state/V1-00.json";
  const state = await readFixtureJson(root, statePath);
  state.state = "accepted";
  state.candidate = {
    baseCommit: "b".repeat(40),
    commit: evidence.commit,
    executor: "implementation-agent",
  };
  state.criteria = state.criteria.map((criterion) => ({
    ...criterion,
    status: "pass",
    evidenceRefs: [evidence.id],
  }));
  state.gates = [{ gateId: "QG-PLAN-CHECK", status: "pass", evidenceRefs: [evidence.id] }];
  state.reviews = [];
  await writeFixtureJson(root, statePath, state);

  for (const item of ledger.items.filter((candidate) => candidate.taskId === v1TaskId)) {
    item.status = "accepted";
    item.evidenceRefs = [evidence.id];
  }
  await writeFixtureJson(root, ledgerPath, ledger);
}

async function createBootstrapReviewEvidence(root, reviewOverrides = {}) {
  return createV1Evidence(root, {
    id: "ev-v1-bootstrap-review",
    type: "review",
    actor: "implementation-agent",
    gateBinding: null,
    review: {
      role: "maintainer",
      subjectActor: "implementation-agent",
      source: "github-bootstrap-owner-comment",
      state: "APPROVED",
      authorAssociation: "OWNER",
      commentId: bootstrapCommentId,
      observedCommit: "a".repeat(40),
      authorizationBody: bootstrapBody(),
      authorizationRef: `https://github.com/Clyra-AI/vetryn/pull/5#issuecomment-${bootstrapCommentId}`,
      ...reviewOverrides,
    },
  });
}

async function approveMaintainerReview(root, evidence) {
  const statePath = "product/plans/oss-v1/state/V1-00.json";
  const state = await readFixtureJson(root, statePath);
  state.candidate = {
    baseCommit: "eb970bf3708ceb7a0d93d93481812dac090428b9",
    commit: evidence.commit,
    executor: "implementation-agent",
  };
  const review = state.reviews.find((candidate) => candidate.role === "maintainer");
  review.status = "approved";
  review.evidenceRefs = [evidence.id];
  await writeFixtureJson(root, statePath, state);
}

async function passFirstPlanningCriterion(root, evidenceId, candidateCommit = "a".repeat(40)) {
  const statePath = "product/plans/oss-v1/state/V1-00.json";
  const state = await readFixtureJson(root, statePath);
  state.candidate = {
    baseCommit: "eb970bf3708ceb7a0d93d93481812dac090428b9",
    commit: candidateCommit,
    executor: "implementation-agent",
  };
  state.criteria[0].status = "pass";
  state.criteria[0].evidenceRefs = [evidenceId];
  await writeFixtureJson(root, statePath, state);
}

async function passGate(root, gateId, evidenceId, candidateCommit = "a".repeat(40)) {
  const statePath = "product/plans/oss-v1/state/V1-00.json";
  const state = await readFixtureJson(root, statePath);
  state.candidate = {
    baseCommit: "eb970bf3708ceb7a0d93d93481812dac090428b9",
    commit: candidateCommit,
    executor: "implementation-agent",
  };
  const gate = state.gates.find((candidate) => candidate.gateId === gateId);
  gate.status = "pass";
  gate.evidenceRefs = [evidenceId];
  await writeFixtureJson(root, statePath, state);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("implementation plan validator", () => {
  it("normalizes promoted V1-00 lifecycle data back to the isolated fixture baseline", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, { id: "ev-v1-promoted-fixture" });
    const statePath = "product/plans/oss-v1/state/V1-00.json";
    const state = await readFixtureJson(root, statePath);
    state.revision = 9;
    state.state = "accepted";
    state.candidate = {
      baseCommit: "b".repeat(40),
      commit: evidence.commit,
      executor: "implementation-agent",
    };
    state.criteria = state.criteria.map((criterion) => ({
      ...criterion,
      status: "pass",
      evidenceRefs: [evidence.id],
    }));
    state.gates = state.gates.map((gate) => ({
      ...gate,
      status: "pass",
      evidenceRefs: [evidence.id],
    }));
    state.reviews = state.reviews.map((review) => ({
      ...review,
      status: "approved",
      evidenceRefs: [evidence.id],
    }));
    await writeFixtureJson(root, statePath, state);

    const ledgerPath = "product/plans/oss-v1/acceptance-ledger.json";
    const ledger = await readFixtureJson(root, ledgerPath);
    ledger.items = ledger.items.map((item) =>
      item.taskId === v1TaskId
        ? { ...item, status: "accepted", evidenceRefs: [evidence.id] }
        : item,
    );
    await writeFixtureJson(root, ledgerPath, ledger);

    const progressPath = "product/plans/oss-v1/progress.json";
    const progress = await readFixtureJson(root, progressPath);
    const taskProgress = progress.tasks.find((task) => task.taskId === v1TaskId);
    taskProgress.state = "accepted";
    taskProgress.acceptedCriteria = taskProgress.totalCriteria;
    await writeFixtureJson(root, progressPath, progress);

    await normalizeV1Fixture(root);

    const normalizedState = await readFixtureJson(root, statePath);
    const normalizedLedger = await readFixtureJson(root, ledgerPath);
    const normalizedProgress = await readFixtureJson(root, progressPath);
    expect(normalizedState).toMatchObject({
      revision: 0,
      state: "in_progress",
      attempt: 1,
      candidate: null,
    });
    expect(
      [...normalizedState.criteria, ...normalizedState.gates, ...normalizedState.reviews].every(
        (record) => record.status === "pending" && record.evidenceRefs.length === 0,
      ),
    ).toBe(true);
    expect(
      normalizedLedger.items
        .filter((item) => item.taskId === v1TaskId)
        .every((item) => item.status === "planned" && item.evidenceRefs.length === 0),
    ).toBe(true);
    expect(normalizedProgress.tasks.find((task) => task.taskId === v1TaskId)).toMatchObject({
      state: "in_progress",
      acceptedCriteria: 0,
    });
    await expect(
      readFile(path.join(root, `product/plans/oss-v1/evidence/${evidence.id}.json`), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const result = runPlan(root);
    expect(result.status, result.stderr).toBe(0);
  });

  it("regenerates a missing progress roll-up in write mode", async () => {
    const root = await createFixture();
    const progressPath = path.join(root, "product/plans/oss-v1/progress.json");
    await rm(progressPath);

    const writeResult = runPlan(root, "write");
    expect(writeResult.status, writeResult.stderr).toBe(0);
    expect(writeResult.stdout).toContain("updated product/plans/oss-v1/progress.json");

    const checkResult = runPlan(root);
    expect(checkResult.status, checkResult.stderr).toBe(0);
  });

  it("writes Prettier-stable progress when accepted dependencies expose next legal work", async () => {
    const root = await createFixture();
    await acceptV1ForProgressFixture(root);

    const writeResult = runPlan(root, "write");
    expect(writeResult.status, writeResult.stderr).toBe(0);

    const progressPath = path.join(root, "product/plans/oss-v1/progress.json");
    const contents = await readFile(progressPath, "utf8");
    expect(JSON.parse(contents).nextLegalTasks).toEqual(["V1-01", "V1-02"]);
    expect(await checkPrettier(contents, { ...prettierConfig, filepath: progressPath })).toBe(true);

    const checkResult = runPlan(root);
    expect(checkResult.status, checkResult.stderr).toBe(0);
  });

  it("overwrites a malformed progress roll-up in write mode", async () => {
    const root = await createFixture();
    const progressPath = path.join(root, "product/plans/oss-v1/progress.json");
    await writeFile(progressPath, "not json\n");

    const result = runPlan(root, "write");
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(await readFile(progressPath, "utf8"))).toMatchObject({ planId: "oss-v1" });
  });

  it("rejects evidence from a stale candidate commit", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, { commit: "b".repeat(40) });
    await passFirstPlanningCriterion(root, evidence.id);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not match candidate commit");
  });

  it("rejects unsuccessful evidence for a passing record", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      result: {
        status: "fail",
        checks: [{ name: "candidate check", status: "fail", summary: "intentional failure" }],
      },
    });
    await passFirstPlanningCriterion(root, evidence.id);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cites unsuccessful evidence");
  });

  it("accepts immutable evidence bound to an earlier plan digest", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      inputs: {
        planDigest: `sha256:${"0".repeat(64)}`,
        lockfileDigest: await digestFixture(root, "pnpm-lock.yaml"),
      },
    });
    await passFirstPlanningCriterion(root, evidence.id);

    const result = runPlan(root);
    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts immutable evidence bound to an earlier lockfile digest", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      inputs: {
        planDigest: await digestFixture(root, "product/plans/oss-v1/plan.json"),
        lockfileDigest: `sha256:${"0".repeat(64)}`,
      },
    });
    await passFirstPlanningCriterion(root, evidence.id);

    const result = runPlan(root);
    expect(result.status, result.stderr).toBe(0);
  });

  it("preserves candidate-bound evidence when later plan or lockfile revisions evolve", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      inputs: {
        planDigest: `sha256:${"0".repeat(64)}`,
        lockfileDigest: `sha256:${"1".repeat(64)}`,
      },
    });
    await passFirstPlanningCriterion(root, evidence.id);

    const result = runPlan(root);

    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects command evidence used as a maintainer approval", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root);
    const statePath = "product/plans/oss-v1/state/V1-00.json";
    const state = await readFixtureJson(root, statePath);
    state.candidate = {
      baseCommit: "eb970bf3708ceb7a0d93d93481812dac090428b9",
      commit: evidence.commit,
      executor: "implementation-agent",
    };
    state.reviews.find((review) => review.role === "maintainer").status = "approved";
    state.reviews.find((review) => review.role === "maintainer").evidenceRefs = [evidence.id];
    await writeFixtureJson(root, statePath, state);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires review evidence for role maintainer");
  });

  it("accepts the bootstrap owner-comment shape without treating it as command evidence", async () => {
    const root = await createFixture();
    await createBootstrapReviewEvidence(root);

    const result = runPlan(root);

    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts MEMBER association in the bootstrap owner-comment shape", async () => {
    const root = await createFixture();
    await createBootstrapReviewEvidence(root, { authorAssociation: "MEMBER" });

    const result = runPlan(root);

    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts CONTRIBUTOR as exact public provenance in the bootstrap owner-comment shape", async () => {
    const root = await createFixture();
    await createBootstrapReviewEvidence(root, { authorAssociation: "CONTRIBUTOR" });

    const result = runPlan(root);

    expect(result.status, result.stderr).toBe(0);
  });

  it("allows bootstrap owner identity overlap only through the authenticated comment path", async () => {
    const root = await createFixture();
    const evidence = await createBootstrapReviewEvidence(root, {
      commentId: bootstrapCommentId + 1,
    });
    await approveMaintainerReview(root, evidence);

    const result = runPlan(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("mismatched GitHub comment identity");
    expect(result.stderr).not.toContain("self-approved by the executor");
  });

  it.each(["COLLABORATOR", "NONE"])(
    "rejects a bootstrap comment shape with %s association",
    async (authorAssociation) => {
      const root = await createFixture();
      await createBootstrapReviewEvidence(root, { authorAssociation });

      const result = runPlan(root);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("evidence/ev-v1-bootstrap-review.json");
      expect(result.stderr).toContain(
        "authorAssociation must be equal to one of the allowed values",
      );
    },
  );

  it("rejects review evidence issued by the candidate executor", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      type: "review",
      gateBinding: null,
      review: {
        role: "maintainer",
        subjectActor: "implementation-agent",
        source: "github-pull-request-review",
        state: "APPROVED",
        authorAssociation: "MEMBER",
        reviewId: 123456789,
        observedCommit: "a".repeat(40),
        authorizationRef: "https://github.com/Clyra-AI/vetryn/pull/1#pullrequestreview-123456789",
      },
    });
    const statePath = "product/plans/oss-v1/state/V1-00.json";
    const state = await readFixtureJson(root, statePath);
    state.candidate = {
      baseCommit: "eb970bf3708ceb7a0d93d93481812dac090428b9",
      commit: evidence.commit,
      executor: "implementation-agent",
    };
    state.reviews.find((review) => review.role === "maintainer").status = "approved";
    state.reviews.find((review) => review.role === "maintainer").evidenceRefs = [evidence.id];
    await writeFixtureJson(root, statePath, state);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("self-approved by the executor");
  });

  it("rejects self-review when the executor and reviewer logins differ only by case", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      type: "review",
      actor: "IMPLEMENTATION-AGENT",
      gateBinding: null,
      review: {
        role: "maintainer",
        subjectActor: "Implementation-Agent",
        source: "github-pull-request-review",
        state: "APPROVED",
        authorAssociation: "MEMBER",
        reviewId: 123456789,
        observedCommit: "a".repeat(40),
        authorizationRef: "https://github.com/Clyra-AI/vetryn/pull/1#pullrequestreview-123456789",
      },
    });
    const statePath = "product/plans/oss-v1/state/V1-00.json";
    const state = await readFixtureJson(root, statePath);
    state.candidate = {
      baseCommit: "eb970bf3708ceb7a0d93d93481812dac090428b9",
      commit: evidence.commit,
      executor: "implementation-agent",
    };
    state.reviews.find((review) => review.role === "maintainer").status = "approved";
    state.reviews.find((review) => review.role === "maintainer").evidenceRefs = [evidence.id];
    await writeFixtureJson(root, statePath, state);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("self-approved by the executor");
  });

  it("rejects a review attestation whose ID does not match its GitHub URL", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      type: "review",
      actor: "maintainer-reviewer",
      gateBinding: null,
      review: {
        role: "maintainer",
        subjectActor: "implementation-agent",
        source: "github-pull-request-review",
        state: "APPROVED",
        authorAssociation: "MEMBER",
        reviewId: 987654321,
        observedCommit: "a".repeat(40),
        authorizationRef: "https://github.com/Clyra-AI/vetryn/pull/1#pullrequestreview-123456789",
      },
    });
    const statePath = "product/plans/oss-v1/state/V1-00.json";
    const state = await readFixtureJson(root, statePath);
    state.candidate = {
      baseCommit: "eb970bf3708ceb7a0d93d93481812dac090428b9",
      commit: evidence.commit,
      executor: "implementation-agent",
    };
    state.reviews.find((review) => review.role === "maintainer").status = "approved";
    state.reviews.find((review) => review.role === "maintainer").evidenceRefs = [evidence.id];
    await writeFixtureJson(root, statePath, state);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("mismatched GitHub review identity");
  });

  it("rejects command evidence bound to a different gate", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root);
    await passGate(root, "QG-REPO-CHECK", evidence.id);

    const result = runPlan(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("bound to QG-PLAN-CHECK, not QG-REPO-CHECK");
  });

  it("accepts command evidence bound to the exact gate and command", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      gateBinding: {
        gateId: "QG-REPO-CHECK",
        kind: "command",
        command: "pnpm check",
      },
    });
    await passGate(root, "QG-REPO-CHECK", evidence.id);

    const result = runPlan(root);

    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects command evidence with the right gate but a different command", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      gateBinding: {
        gateId: "QG-REPO-CHECK",
        kind: "command",
        command: "pnpm lint",
      },
    });
    await passGate(root, "QG-REPO-CHECK", evidence.id);

    const result = runPlan(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("command that differs from QG-REPO-CHECK");
  });

  it("rejects passing evidence for a gate that is still planned", async () => {
    const root = await createFixture();
    const planPath = "product/plans/oss-v1/plan.json";
    const plan = await readFixtureJson(root, planPath);
    plan.gateCatalog.find((gate) => gate.id === "QG-REPO-CHECK").availability = "planned";
    await writeFixtureJson(root, planPath, plan);
    const evidence = await createV1Evidence(root, {
      gateBinding: {
        gateId: "QG-REPO-CHECK",
        kind: "command",
        command: "pnpm check",
      },
    });
    await passGate(root, "QG-REPO-CHECK", evidence.id);

    const result = runPlan(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("records pass for planned gate QG-REPO-CHECK");
  });

  it("rejects evidence belonging to a different task", async () => {
    const root = await createFixture();
    await passFirstPlanningCriterion(
      root,
      "ev-m0-main-checks-20260809",
      "eb970bf3708ceb7a0d93d93481812dac090428b9",
    );

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("for task M0-00");
  });

  it("rejects accepted task state while its ledger remains incomplete", async () => {
    const root = await createFixture();
    const ledgerPath = "product/plans/oss-v1/acceptance-ledger.json";
    const ledger = await readFixtureJson(root, ledgerPath);
    for (const item of ledger.items.filter((candidate) => candidate.taskId === "M0-00"))
      item.status = "planned";
    await writeFixtureJson(root, ledgerPath, ledger);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("is accepted while ledger item");
  });

  it("rejects committed evidence containing raw model output", async () => {
    const root = await createFixture();
    const evidencePath = "product/plans/oss-v1/evidence/ev-m0-main-checks-20260809.json";
    const evidence = await readFixtureJson(root, evidencePath);
    evidence.redaction.containsRawModelOutput = true;
    await writeFixtureJson(root, evidencePath, evidence);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("contains raw model output");
  });

  it("enforces the task-specific attempt limit", async () => {
    const root = await createFixture();
    const statePath = "product/plans/oss-v1/state/V1-00.json";
    const state = await readFixtureJson(root, statePath);
    state.attempt = 3;
    await writeFixtureJson(root, statePath, state);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exceeds maxAttempts 2");
  });
});

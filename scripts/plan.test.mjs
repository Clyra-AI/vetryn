import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const planScript = path.join(repositoryRoot, "scripts/plan.mjs");
const temporaryRoots = [];
const bootstrapCommentId = 987654321;

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

  it("rejects evidence bound to a stale plan digest", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      inputs: {
        planDigest: `sha256:${"0".repeat(64)}`,
        lockfileDigest: await digestFixture(root, "pnpm-lock.yaml"),
      },
    });
    await passFirstPlanningCriterion(root, evidence.id);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stale plan digest");
  });

  it("rejects evidence bound to a stale lockfile digest", async () => {
    const root = await createFixture();
    const evidence = await createV1Evidence(root, {
      inputs: {
        planDigest: await digestFixture(root, "product/plans/oss-v1/plan.json"),
        lockfileDigest: `sha256:${"0".repeat(64)}`,
      },
    });
    await passFirstPlanningCriterion(root, evidence.id);

    const result = runPlan(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stale lockfile digest");
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

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve(import.meta.dirname, "promotion-tail.mjs");
const roots = [];
const taskId = "M0-14";

function git(root, ...arguments_) {
  const result = spawnSync("git", ["-C", root, ...arguments_], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function writeJson(root, relativePath, document) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function commit(root, message) {
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function evidence(id, candidate) {
  return {
    id,
    taskId,
    type: "command-run",
    actor: "validation-agent",
    commit: candidate,
    inputs: { planDigest: null, lockfileDigest: null },
    gateBinding: { gateId: "QG-CONTRACTS", kind: "command", command: "pnpm test" },
    result: { status: "pass", checks: [{ name: "pnpm test", status: "pass" }] },
    redaction: { containsSecrets: false, containsRawModelOutput: false },
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vetryn-promotion-tail-"));
  roots.push(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Vetryn fixture");
  git(root, "config", "user.email", "fixture@vetryn.invalid");
  const planRoot = "product/plans/oss-v1";
  const item = {
    id: "PROCESS-015",
    taskId,
    statement: "Validate promotion tails.",
    verification: { method: "test", testLevel: "contract", gateId: "QG-CONTRACTS" },
    waivable: false,
    status: "planned",
    evidenceRefs: [],
  };
  await writeJson(root, `${planRoot}/plan.json`, {
    planId: "fixture",
    tasks: [
      {
        id: taskId,
        risk: { level: "high", domains: ["delivery-policy"] },
        acceptanceItemIds: [item.id],
        requiredGates: ["QG-CONTRACTS", "QG-TRUST-REVIEW"],
      },
      {
        id: "M0-12",
        risk: { level: "medium", domains: ["agent-workflow"] },
        acceptanceItemIds: ["OTHER-001"],
        requiredGates: ["QG-CONTRACTS"],
      },
    ],
  });
  await writeJson(root, `${planRoot}/acceptance-ledger.json`, {
    planId: "fixture",
    items: [
      item,
      {
        ...item,
        id: "OTHER-001",
        taskId: "M0-12",
        status: "accepted",
        evidenceRefs: ["ev-m0-12-historical"],
      },
    ],
  });
  await writeJson(root, `${planRoot}/state/${taskId}.json`, {
    taskId,
    state: "review_pending",
    candidate: null,
    criteria: [{ criterionId: item.id, status: "pending", evidenceRefs: [] }],
    gates: [],
    reviews: [],
    blockers: [],
  });
  await writeJson(root, `${planRoot}/progress.json`, {
    $schema: "../schemas/progress.schema.json",
    schemaVersion: "1.0.0",
    planId: "fixture",
    taskCounts: { accepted: 1, review_pending: 1 },
    acceptanceCounts: { accepted: 1, planned: 1 },
    nextLegalTasks: [],
    blockedTasks: [],
    tasks: [
      { taskId, state: "review_pending", acceptedCriteria: 0, totalCriteria: 1 },
      { taskId: "M0-12", state: "accepted", acceptedCriteria: 1, totalCriteria: 1 },
    ],
  });
  await writeJson(root, `${planRoot}/evidence/ev-m0-12-historical.json`, {
    ...evidence("ev-m0-12-historical", "1".repeat(40)),
    taskId: "M0-12",
  });
  await writeFile(path.join(root, "product.txt"), "candidate\n");
  const candidate = commit(root, "product candidate");

  const evidenceId = `ev-m0-14-contracts-${candidate.slice(0, 7)}`;
  const state = await readJson(root, `${planRoot}/state/${taskId}.json`);
  Object.assign(state, {
    state: "accepted",
    candidate: { baseCommit: "0".repeat(40), commit: candidate, executor: "implementation-agent" },
    criteria: [{ criterionId: item.id, status: "pass", evidenceRefs: [evidenceId] }],
  });
  await writeJson(root, `${planRoot}/state/${taskId}.json`, state);
  const ledger = await readJson(root, `${planRoot}/acceptance-ledger.json`);
  Object.assign(ledger.items[0], { status: "accepted", evidenceRefs: [evidenceId] });
  await writeJson(root, `${planRoot}/acceptance-ledger.json`, ledger);
  await writeJson(root, `${planRoot}/progress.json`, {
    $schema: "../schemas/progress.schema.json",
    schemaVersion: "1.0.0",
    planId: "fixture",
    taskCounts: { accepted: 2 },
    acceptanceCounts: { accepted: 2 },
    nextLegalTasks: [],
    blockedTasks: [],
    tasks: [
      { taskId, state: "accepted", acceptedCriteria: 1, totalCriteria: 1 },
      { taskId: "M0-12", state: "accepted", acceptedCriteria: 1, totalCriteria: 1 },
    ],
  });
  await writeJson(root, `${planRoot}/evidence/${evidenceId}.json`, evidence(evidenceId, candidate));
  const lifecycleRoot = `${planRoot}/evidence/lifecycle/${taskId}/${candidate}`;
  await writeJson(root, `${lifecycleRoot}/validation_report.json`, {
    task_id: taskId,
    work_item_id: taskId,
    result: "pass",
    checks: [{ name: "pnpm test", status: "pass" }],
    work_proof_marker_refs: [`${lifecycleRoot}/work_proof_marker.json`],
  });
  await writeJson(root, `${lifecycleRoot}/work_proof_marker.json`, {
    git_sha: candidate,
  });
  await writeJson(root, `${lifecycleRoot}/review_report.json`, {
    artifact_type: "review_report",
    task_id: taskId,
    work_item_id: taskId,
    verdict: "approved",
    current_work: {
      candidate_digest: `sha256:${"a".repeat(64)}`,
      work_proof_markers: [{ ref: `${lifecycleRoot}/work_proof_marker.json` }],
    },
    evidence_refs: [`${lifecycleRoot}/validation_report.json`],
    findings: [],
    required_fixes: [],
  });
  await writeJson(root, `${lifecycleRoot}/trust_review_report.json`, {
    artifactType: "vetryn-trust-review-report",
    taskId,
    candidateCommit: candidate,
    verdict: "pass",
    unresolvedFindings: [],
  });
  await writeJson(root, `${lifecycleRoot}/canonical_promotion.json`, {
    artifactType: "canonical_promotion",
    taskId,
    candidateCommit: candidate,
    decision: "accepted",
  });
  const delivery = commit(root, "promotion only");
  return { root, candidate, delivery, planRoot, evidenceId };
}

function run(root, candidate, delivery) {
  return spawnSync(process.execPath, [script, "check", taskId, candidate, delivery], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, VETRYN_PROMOTION_REPO_ROOT: root },
  });
}

async function amend(root, edit) {
  await edit();
  git(root, "add", ".");
  git(root, "commit", "--quiet", "--amend", "--no-edit");
  return git(root, "rev-parse", "HEAD");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("promotion-tail validator", () => {
  it("accepts one exact task-scoped promotion commit", async () => {
    const fixture = await createFixture();
    const result = run(fixture.root, fixture.candidate, fixture.delivery);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "pass", task_id: taskId });
  });

  it("accepts passing evidence cited only by an active command gate", async () => {
    const fixture = await createFixture();
    const gateEvidenceId = `ev-m0-14-repo-check-${fixture.candidate.slice(0, 7)}`;
    const delivery = await amend(fixture.root, async () => {
      const statePath = `${fixture.planRoot}/state/${taskId}.json`;
      const state = await readJson(fixture.root, statePath);
      state.gates = [{ gateId: "QG-REPO-CHECK", status: "pass", evidenceRefs: [gateEvidenceId] }];
      await writeJson(fixture.root, statePath, state);
      const gateEvidence = evidence(gateEvidenceId, fixture.candidate);
      gateEvidence.gateBinding = {
        gateId: "QG-REPO-CHECK",
        kind: "command",
        command: "pnpm check",
      };
      gateEvidence.result.checks = [{ name: "pnpm check", status: "pass" }];
      await writeJson(
        fixture.root,
        `${fixture.planRoot}/evidence/${gateEvidenceId}.json`,
        gateEvidence,
      );
    });
    const result = run(fixture.root, fixture.candidate, delivery);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    [
      "product bytes",
      async (fixture) => writeFile(path.join(fixture.root, "product.txt"), "changed\n"),
      "forbidden path",
    ],
    [
      "cross-task ledger",
      async (fixture) => {
        const ledger = await readJson(fixture.root, `${fixture.planRoot}/acceptance-ledger.json`);
        ledger.items[1].evidenceRefs = ["ev-m0-12-mutated"];
        await writeJson(fixture.root, `${fixture.planRoot}/acceptance-ledger.json`, ledger);
      },
      "another task",
    ],
    [
      "cross-task state",
      async (fixture) =>
        writeJson(fixture.root, `${fixture.planRoot}/state/M0-12.json`, {
          taskId: "M0-12",
          state: "accepted",
        }),
      "forbidden path",
    ],
    [
      "missing generated progress",
      async (fixture) => {
        const progress = await readJson(fixture.root, `${fixture.planRoot}/progress.json`);
        progress.tasks[0].state = "review_pending";
        progress.taskCounts = { accepted: 1, review_pending: 1 };
        await writeJson(fixture.root, `${fixture.planRoot}/progress.json`, progress);
      },
      "does not mark the task accepted",
    ],
    [
      "another task's generated progress",
      async (fixture) => {
        const progress = await readJson(fixture.root, `${fixture.planRoot}/progress.json`);
        progress.tasks[1].state = "blocked";
        await writeJson(fixture.root, `${fixture.planRoot}/progress.json`, progress);
      },
      "changed another task M0-12",
    ],
    [
      "inconsistent generated progress counts",
      async (fixture) => {
        const progress = await readJson(fixture.root, `${fixture.planRoot}/progress.json`);
        progress.taskCounts = { accepted: 999 };
        await writeJson(fixture.root, `${fixture.planRoot}/progress.json`, progress);
      },
      "task counts are inconsistent",
    ],
    [
      "missing work-proof marker",
      async (fixture) =>
        rm(
          path.join(
            fixture.root,
            `${fixture.planRoot}/evidence/lifecycle/${taskId}/${fixture.candidate}/work_proof_marker.json`,
          ),
        ),
      "missing work_proof_marker",
    ],
    [
      "mutable prior evidence",
      async (fixture) => {
        const evidencePath = `${fixture.planRoot}/evidence/ev-m0-12-historical.json`;
        const historical = await readJson(fixture.root, evidencePath);
        historical.actor = "mutated";
        await writeJson(fixture.root, evidencePath, historical);
      },
      "mutates prior evidence",
    ],
    [
      "undeclared lifecycle artifact",
      async (fixture) =>
        writeJson(
          fixture.root,
          `${fixture.planRoot}/evidence/lifecycle/${taskId}/${fixture.candidate}/mystery.json`,
          { taskId, candidateCommit: fixture.candidate },
        ),
      "forbidden path",
    ],
  ])("rejects %s", async (_name, mutate, message) => {
    const fixture = await createFixture();
    const delivery = await amend(fixture.root, () => mutate(fixture));
    const result = run(fixture.root, fixture.candidate, delivery);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it.each([
    ["validation_report", (artifact) => (artifact.work_proof_marker_refs = [])],
    [
      "review_report",
      (artifact) => {
        artifact.current_work.work_proof_markers = [];
        artifact.evidence_refs = [];
      },
    ],
    ["trust_review_report", (artifact) => delete artifact.candidateCommit],
    ["canonical_promotion", (artifact) => delete artifact.candidateCommit],
  ])("rejects an unbound %s", async (name, unbind) => {
    const fixture = await createFixture();
    const relativePath = `${fixture.planRoot}/evidence/lifecycle/${taskId}/${fixture.candidate}/${name}.json`;
    const delivery = await amend(fixture.root, async () => {
      const artifact = await readJson(fixture.root, relativePath);
      unbind(artifact);
      await writeJson(fixture.root, relativePath, artifact);
    });
    const result = run(fixture.root, fixture.candidate, delivery);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${name} is not candidate-bound`);
  });

  it("rejects a lifecycle report bound to another candidate", async () => {
    const fixture = await createFixture();
    const relativePath = `${fixture.planRoot}/evidence/lifecycle/${taskId}/${fixture.candidate}/validation_report.json`;
    const delivery = await amend(fixture.root, async () => {
      const artifact = await readJson(fixture.root, relativePath);
      artifact.work_proof_marker_refs = [
        `${fixture.planRoot}/evidence/lifecycle/${taskId}/${"f".repeat(40)}/work_proof_marker.json`,
      ];
      await writeJson(fixture.root, relativePath, artifact);
    });
    const result = run(fixture.root, fixture.candidate, delivery);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("validation_report is not candidate-bound");
  });

  it.each([
    [
      "conflicting git_sha and task binding",
      (artifact) => {
        artifact.authorized_task_bindings = [{ task_id: taskId, source_revision: "f".repeat(40) }];
      },
    ],
    [
      "multiple task bindings with different candidates",
      (artifact, fixture) => {
        delete artifact.git_sha;
        artifact.authorized_task_bindings = [
          { task_id: taskId, source_revision: fixture.candidate },
          { task_id: taskId, source_revision: "f".repeat(40) },
        ];
      },
    ],
    [
      "no candidate identity",
      (artifact) => {
        delete artifact.git_sha;
        delete artifact.authorized_task_bindings;
      },
    ],
  ])("rejects a work-proof marker with %s", async (_name, mutate) => {
    const fixture = await createFixture();
    const relativePath = `${fixture.planRoot}/evidence/lifecycle/${taskId}/${fixture.candidate}/work_proof_marker.json`;
    const delivery = await amend(fixture.root, async () => {
      const artifact = await readJson(fixture.root, relativePath);
      mutate(artifact, fixture);
      await writeJson(fixture.root, relativePath, artifact);
    });
    const result = run(fixture.root, fixture.candidate, delivery);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("work_proof_marker is not candidate-bound");
  });

  it.each([
    ["top-level task identity", (artifact) => (artifact.taskId = "M0-12")],
    [
      "authorized task binding",
      (artifact, fixture) => {
        artifact.authorized_task_bindings = [
          { task_id: "M0-12", source_revision: fixture.candidate },
        ];
      },
    ],
  ])("rejects a work-proof marker with another task in its %s", async (_name, mutate) => {
    const fixture = await createFixture();
    const relativePath = `${fixture.planRoot}/evidence/lifecycle/${taskId}/${fixture.candidate}/work_proof_marker.json`;
    const delivery = await amend(fixture.root, async () => {
      const artifact = await readJson(fixture.root, relativePath);
      mutate(artifact, fixture);
      await writeJson(fixture.root, relativePath, artifact);
    });
    const result = run(fixture.root, fixture.candidate, delivery);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("work_proof_marker");
    expect(result.stderr).toContain("task-bound");
  });

  it.each([
    ["blocking findings", (artifact) => artifact.findings.push({ priority: "P1" })],
    ["required fixes", (artifact) => artifact.required_fixes.push("repair the blocker")],
  ])("rejects an approved review report with %s", async (_name, mutate) => {
    const fixture = await createFixture();
    const relativePath = `${fixture.planRoot}/evidence/lifecycle/${taskId}/${fixture.candidate}/review_report.json`;
    const delivery = await amend(fixture.root, async () => {
      const artifact = await readJson(fixture.root, relativePath);
      mutate(artifact);
      await writeJson(fixture.root, relativePath, artifact);
    });
    const result = run(fixture.root, fixture.candidate, delivery);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("review_report");
  });
});

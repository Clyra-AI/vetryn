import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const planScript = path.join(repositoryRoot, "scripts/plan.mjs");
const temporaryRoots = [];

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vetryn-plan-"));
  temporaryRoots.push(root);
  await cp(path.join(repositoryRoot, "product"), path.join(root, "product"), { recursive: true });
  await cp(
    path.join(repositoryRoot, "examples/openrouter-typescript/fixtures"),
    path.join(root, "examples/openrouter-typescript/fixtures"),
    { recursive: true },
  );
  return root;
}

async function readFixtureJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function writeFixtureJson(root, relativePath, document) {
  await writeFile(path.join(root, relativePath), `${JSON.stringify(document, null, 2)}\n`);
}

function runPlan(root, command = "check") {
  return spawnSync(process.execPath, [planScript, command], {
    encoding: "utf8",
    env: { ...process.env, VETRYN_PLAN_REPO_ROOT: root },
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
    commit: "a".repeat(40),
    ...overrides,
  });
  const relativePath = `product/plans/oss-v1/evidence/${evidence.id}.json`;
  await writeFixtureJson(root, relativePath, evidence);
  return evidence;
}

async function passFirstPlanningCriterion(root, evidenceId, candidateCommit = "a".repeat(40)) {
  const statePath = "product/plans/oss-v1/state/V1-00.json";
  const state = await readFixtureJson(root, statePath);
  state.candidate = {
    baseCommit: "eb970bf3708ceb7a0d93d93481812dac090428b9",
    commit: candidateCommit,
  };
  state.criteria[0].status = "pass";
  state.criteria[0].evidenceRefs = [evidenceId];
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

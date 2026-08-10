import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  return root;
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("task packet compiler", () => {
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

  it("compiles a deterministic, role-separated packet for an active task", async () => {
    const root = await createFixture();
    const first = runTask(root, "compile", "V1-00");
    const second = runTask(root, "compile", "V1-00");

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    const packet = JSON.parse(first.stdout);
    expect(packet).toMatchObject({
      packetId: "oss-v1:V1-00:r2",
      source: { productContract: "docs/oss-v1.md" },
      task: { id: "V1-00" },
      currentState: { state: "in_progress", attempt: 1, maxAttempts: 2 },
      task_id: "V1-00",
      risk_class: "medium",
      worker_type: "task-executor",
      retry_budget: { max_attempts: 2, current_attempt: 1, remaining_attempts: 1 },
      execution: {
        executorMayAccept: false,
        verifierMustDifferFromExecutor: true,
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
      codex_review_required: true,
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

import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const taskScript = path.join(repositoryRoot, "scripts/task.mjs");
const temporaryRoots = [];

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vetryn-task-"));
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

function runTask(root, ...args) {
  return spawnSync(process.execPath, [taskScript, ...args], {
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
    expect(JSON.parse(first.stdout)).toMatchObject({
      packetId: "oss-v1:V1-00:r1",
      task: { id: "V1-00" },
      currentState: { state: "in_progress", attempt: 1, maxAttempts: 2 },
      execution: {
        executorMayAccept: false,
        verifierMustDifferFromExecutor: true,
        maintainerApprovalRequired: true,
        progressIsGenerated: true,
      },
    });
  });

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

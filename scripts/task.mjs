import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(
  process.env.VETRYN_PLAN_REPO_ROOT ?? path.resolve(import.meta.dirname, ".."),
);
const planScript = path.resolve(import.meta.dirname, "plan.mjs");

const sourcePaths = {
  plan: "product/plans/oss-v1/plan.json",
  ledger: "product/plans/oss-v1/acceptance-ledger.json",
  progress: "product/plans/oss-v1/progress.json",
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
  const runnableStates = new Set(["ready", "in_progress", "changes_requested"]);
  const isNextLegal = progress.nextLegalTasks.includes(taskId);
  assert(
    runnableStates.has(state.state) || (state.state === "planned" && isNextLegal),
    `${taskId} is ${state.state} and is not legal to compile for execution`,
  );

  const gateById = new Map(plan.gateCatalog.map((gate) => [gate.id, gate]));
  const acceptanceItems = ledger.items.filter((item) => item.taskId === taskId);
  const sourceFiles = [sourcePaths.plan, sourcePaths.ledger, statePath, "pnpm-lock.yaml"];
  const sourceDigests = Object.fromEntries(
    await Promise.all(sourceFiles.map(async (file) => [file, await digest(file)])),
  );
  const packet = {
    $schema: "https://vetryn.dev/schemas/planning/task-packet-v1.json",
    schemaVersion: "1.0.0",
    packetId: `${plan.planId}:${taskId}:r${state.revision}`,
    source: {
      repository: plan.baseline.repository,
      baselineCommit: plan.baseline.commit,
      productContract: plan.productContract,
      planPath: sourcePaths.plan,
      ledgerPath: sourcePaths.ledger,
      statePath,
      digests: sourceDigests,
    },
    task: {
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
    },
    currentState: {
      state: state.state,
      attempt: state.attempt,
      maxAttempts: task.maxAttempts,
      candidate: state.candidate,
    },
    acceptanceItems,
    gates: task.requiredGates.map((gateId) => gateById.get(gateId)),
    requiredReviews: task.requiredReviews,
    execution: {
      implementSkill: "vetryn-implement-task",
      verifySkill: "vetryn-verify-task",
      promoteSkill: "vetryn-promote-task",
      factorySkills: ["task-executor", "validation-gate", "commit-push"],
      executorMayAccept: false,
      verifierMustDifferFromExecutor: true,
      maintainerApprovalRequired: true,
      progressIsGenerated: true,
    },
  };

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
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
}

async function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const command = args[0] ?? "next";
  if (command === "next") return next();
  if (command === "compile") return compile(args[1]);
  fail("usage: node scripts/task.mjs [next|compile <task-id>]");
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

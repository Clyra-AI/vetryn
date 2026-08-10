import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(import.meta.dirname, "..");
const planRoot = path.join(root, "product/plans/oss-v1");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertUnique(values, label) {
  assert(new Set(values).size === values.length, `${label} must contain unique values`);
}

function formatErrors(errors) {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

async function validateDocument(ajv, validators, schemaFile, documentFile, document) {
  if (!validators.has(schemaFile)) {
    const schema = await readJson(`product/plans/schemas/${schemaFile}`);
    validators.set(schemaFile, ajv.compile(schema));
  }
  const validate = validators.get(schemaFile);
  assert(validate(document), `${documentFile}: ${formatErrors(validate.errors)}`);
}

function detectCycles(tasks) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set();
  const visited = new Set();

  function visit(taskId) {
    if (visiting.has(taskId)) fail(`task dependency cycle includes ${taskId}`);
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependency of taskById.get(taskId).dependsOn) visit(dependency.taskId);
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of tasks) visit(task.id);
}

function countBy(values) {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((item) => item === value).length]),
  );
}

function buildProgress(plan, ledger, states) {
  const stateByTask = new Map(states.map((state) => [state.taskId, state]));
  const ledgerByTask = new Map(
    plan.tasks.map((task) => [task.id, ledger.items.filter((item) => item.taskId === task.id)]),
  );
  const acceptedTasks = new Set(
    states.filter((state) => state.state === "accepted").map((state) => state.taskId),
  );
  const nextLegalTasks = plan.tasks
    .filter((task) => ["planned", "ready"].includes(stateByTask.get(task.id).state))
    .filter((task) =>
      task.dependsOn
        .filter((dependency) => ["hard", "contract", "field"].includes(dependency.kind))
        .every((dependency) => acceptedTasks.has(dependency.taskId)),
    )
    .map((task) => task.id);

  return {
    $schema: "../schemas/progress.schema.json",
    schemaVersion: "1.0.0",
    planId: plan.planId,
    taskCounts: countBy(states.map((state) => state.state)),
    acceptanceCounts: countBy(ledger.items.map((item) => item.status)),
    nextLegalTasks,
    blockedTasks: states.filter((state) => state.state === "blocked").map((state) => state.taskId),
    tasks: plan.tasks.map((task) => ({
      taskId: task.id,
      state: stateByTask.get(task.id).state,
      acceptedCriteria: ledgerByTask.get(task.id).filter((item) => item.status === "accepted")
        .length,
      totalCriteria: ledgerByTask.get(task.id).length,
    })),
  };
}

async function loadStateFiles() {
  const directory = path.join(planRoot, "state");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      document: JSON.parse(await readFile(path.join(directory, file), "utf8")),
    })),
  );
}

async function loadEvidenceFiles() {
  const directory = path.join(planRoot, "evidence");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      document: JSON.parse(await readFile(path.join(directory, file), "utf8")),
    })),
  );
}

async function main() {
  const command = process.argv[2] ?? "check";
  assert(["check", "write"].includes(command), "usage: node scripts/plan.mjs [check|write]");

  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  const validators = new Map();

  const index = await readJson("product/plans/index.json");
  const plan = await readJson("product/plans/oss-v1/plan.json");
  const ledger = await readJson("product/plans/oss-v1/acceptance-ledger.json");
  const progress = await readJson("product/plans/oss-v1/progress.json");
  const scenarios = await readJson("examples/openrouter-typescript/fixtures/scenarios.json");
  const stateFiles = await loadStateFiles();
  const evidenceFiles = await loadEvidenceFiles();

  await validateDocument(ajv, validators, "index.schema.json", "product/plans/index.json", index);
  await validateDocument(
    ajv,
    validators,
    "plan.schema.json",
    "product/plans/oss-v1/plan.json",
    plan,
  );
  await validateDocument(
    ajv,
    validators,
    "acceptance-ledger.schema.json",
    "acceptance-ledger.json",
    ledger,
  );
  await validateDocument(ajv, validators, "progress.schema.json", "progress.json", progress);
  await validateDocument(
    ajv,
    validators,
    "scenario-contract.schema.json",
    "fixtures/scenarios.json",
    scenarios,
  );
  for (const { file, document } of stateFiles)
    await validateDocument(ajv, validators, "task-state.schema.json", `state/${file}`, document);
  for (const { file, document } of evidenceFiles)
    await validateDocument(ajv, validators, "evidence.schema.json", `evidence/${file}`, document);

  const taskIds = plan.tasks.map((task) => task.id);
  const taskSet = new Set(taskIds);
  const gateIds = plan.gateCatalog.map((gate) => gate.id);
  const gateSet = new Set(gateIds);
  const ledgerIds = ledger.items.map((item) => item.id);
  const evidenceIds = evidenceFiles.map(({ document }) => document.id);
  assertUnique(taskIds, "plan task IDs");
  assertUnique(gateIds, "gate IDs");
  assertUnique(
    plan.decisions.map((decision) => decision.id),
    "decision IDs",
  );
  assertUnique(ledgerIds, "acceptance item IDs");
  assertUnique(evidenceIds, "evidence IDs");
  assertUnique(
    scenarios.scenarios.map((scenario) => scenario.id),
    "scenario IDs",
  );
  assert(plan.planId === ledger.planId && plan.planId === progress.planId, "plan IDs must agree");
  assert(
    index.plans.some((entry) => entry.id === plan.planId && entry.status === "active"),
    "active plan is not indexed",
  );

  for (const task of plan.tasks) {
    for (const dependency of task.dependsOn)
      assert(
        taskSet.has(dependency.taskId),
        `${task.id} references unknown dependency ${dependency.taskId}`,
      );
    for (const gateId of task.requiredGates)
      assert(gateSet.has(gateId), `${task.id} references unknown gate ${gateId}`);
    const itemIds = ledger.items.filter((item) => item.taskId === task.id).map((item) => item.id);
    assert(
      JSON.stringify(itemIds.sort()) === JSON.stringify([...task.acceptanceItemIds].sort()),
      `${task.id} acceptance items differ between plan and ledger`,
    );
  }
  detectCycles(plan.tasks);

  for (const item of ledger.items) {
    const task = plan.tasks.find((candidate) => candidate.id === item.taskId);
    assert(task, `${item.id} references unknown task ${item.taskId}`);
    if (item.verification.gateId)
      assert(
        task.requiredGates.includes(item.verification.gateId),
        `${item.id} uses an undeclared task gate`,
      );
    for (const evidenceRef of item.evidenceRefs)
      assert(
        evidenceIds.includes(evidenceRef),
        `${item.id} references unknown evidence ${evidenceRef}`,
      );
    if (item.status === "accepted")
      assert(item.evidenceRefs.length > 0, `${item.id} is accepted without evidence`);
  }

  assert(
    stateFiles.length === plan.tasks.length,
    "exactly one task-state file is required per task",
  );
  const stateTaskIds = stateFiles.map(({ document }) => document.taskId);
  const acceptedStateTasks = new Set(
    stateFiles
      .filter(({ document }) => document.state === "accepted")
      .map(({ document }) => document.taskId),
  );
  assertUnique(stateTaskIds, "task-state task IDs");
  for (const { file, document: state } of stateFiles) {
    assert(file === `${state.taskId}.json`, `${file} does not match task ID ${state.taskId}`);
    const task = plan.tasks.find((candidate) => candidate.id === state.taskId);
    assert(task, `${file} references unknown task`);
    assert(
      JSON.stringify(state.criteria.map((criterion) => criterion.criterionId).sort()) ===
        JSON.stringify([...task.acceptanceItemIds].sort()),
      `${file} criteria differ from the task`,
    );
    assert(
      JSON.stringify(state.gates.map((gate) => gate.gateId).sort()) ===
        JSON.stringify([...task.requiredGates].sort()),
      `${file} gates differ from the task`,
    );
    assert(
      JSON.stringify(state.reviews.map((review) => review.role).sort()) ===
        JSON.stringify([...task.requiredReviews].sort()),
      `${file} reviews differ from the task`,
    );
    if (
      [
        "ready",
        "in_progress",
        "verification_pending",
        "review_pending",
        "changes_requested",
        "accepted",
      ].includes(state.state)
    ) {
      for (const dependency of task.dependsOn.filter((item) =>
        ["hard", "contract", "field"].includes(item.kind),
      ))
        assert(
          acceptedStateTasks.has(dependency.taskId),
          `${file} advanced before ${dependency.taskId} was accepted`,
        );
    }
    for (const record of [...state.criteria, ...state.gates, ...state.reviews]) {
      for (const evidenceRef of record.evidenceRefs)
        assert(
          evidenceIds.includes(evidenceRef),
          `${file} references unknown evidence ${evidenceRef}`,
        );
      if (["pass", "approved"].includes(record.status))
        assert(record.evidenceRefs.length > 0, `${file} records ${record.status} without evidence`);
    }
    for (const criterion of state.criteria) {
      const ledgerItem = ledger.items.find((item) => item.id === criterion.criterionId);
      if (criterion.status === "waived")
        assert(
          ledgerItem.waivable,
          `${file} waives non-waivable criterion ${criterion.criterionId}`,
        );
      if (ledgerItem.status === "accepted")
        assert(
          ["pass", "waived"].includes(criterion.status),
          `${file} disagrees with accepted criterion ${criterion.criterionId}`,
        );
    }
    for (const gate of state.gates) {
      const gateDefinition = plan.gateCatalog.find((item) => item.id === gate.gateId);
      if (gate.status === "waived")
        assert(gateDefinition.waivable, `${file} waives non-waivable gate ${gate.gateId}`);
    }
    if (state.state === "accepted") {
      assert(
        state.criteria.every((criterion) => ["pass", "waived"].includes(criterion.status)),
        `${file} is accepted with incomplete criteria`,
      );
      assert(
        state.gates.every((gate) => ["pass", "waived"].includes(gate.status)),
        `${file} is accepted with incomplete gates`,
      );
      assert(
        state.reviews.every((review) => review.status === "approved"),
        `${file} is accepted with incomplete reviews`,
      );
    }
  }

  for (const { file, document: evidence } of evidenceFiles) {
    assert(taskSet.has(evidence.taskId), `${file} references unknown task ${evidence.taskId}`);
    assert(file === `${evidence.id}.json`, `${file} does not match evidence ID ${evidence.id}`);
    assert(!evidence.redaction.containsSecrets, `${file} declares that it contains secrets`);
  }

  const generated = buildProgress(
    plan,
    ledger,
    stateFiles.map(({ document }) => document),
  );
  const serialized = `${JSON.stringify(generated, null, 2)}\n`;
  if (command === "write") {
    await writeFile(path.join(planRoot, "progress.json"), serialized);
    process.stdout.write("updated product/plans/oss-v1/progress.json\n");
  } else {
    assert(
      JSON.stringify(progress) === JSON.stringify(generated),
      "progress.json is stale; run pnpm plan:write",
    );
    process.stdout.write("implementation plan is valid and progress is current\n");
  }
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

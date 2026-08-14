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

const reauthorizationFindingIds = [
  "r3754744063",
  "r3754744064",
  "r3754744067",
  "r3754790013",
  "r3754790019",
];
const reauthorizationRemedyInvariants = [
  "The only authorized application replay correction is r3754744063: replay the real application call through a deterministic OpenAI-compatible transport.",
  "The only authorized unknown-outcome correction is r3754744064: reject unknown mock outcomes rather than reporting success.",
  "The only authorized stale-source correction is r3754744067: bind refusal to the checked-in source and manifest fingerprint.",
  "The only authorized budget correction is r3754790013: propagate provider budget exhaustion through the SDK-compatible transport.",
  "The only authorized typecheck correction is r3754790019: run golden-fixture typechecking through the repository quality gate.",
];
const m003AuthorizedInvariantSet = [
  "The reauthorization is limited to exactly one additional V1-02 attempt: its canonical state records two consumed attempts, revision 1, and maxAttempts 3.",
  ...reauthorizationRemedyInvariants,
  "The process task does not implement product behavior, broaden V1-02 capabilities, or weaken offline, redaction, or fail-closed requirements.",
  "V1-02 cannot begin its reauthorized attempt until this task is accepted with candidate-bound command evidence.",
];
const m004FindingIds = ["r3755066013", "r3755066020"];
const m004AuthorizedInvariantSet = [
  "The reauthorization amends only the still-unaccepted third V1-02 attempt; it does not add a fourth attempt or broaden capabilities.",
  "The only authorized acceptance-separation correction is r3755066013: keep V1-02 pending until a maintainer promotes its exact candidate separately from the executor.",
  "The only authorized redaction correction is r3755066020: recursively scan every durable fixture and expected artifact for credential and protected-output markers.",
  "The process task does not implement product behavior, expand fixture scope, or weaken offline, redaction, or fail-closed requirements.",
  "V1-02 cannot submit this corrective candidate for verification until this task is accepted with candidate-bound command evidence.",
];
const m005FindingIds = ["r3758194562", "r3758194569"];
const m005AuthorizedInvariantSet = [
  "The authorization is limited to the still-unaccepted V1-03 correction; it retains V1-03 attempt 3 and maxAttempts 3, and never creates a fourth attempt.",
  "The only authorized accessor correction is r3758194562: a later statically named model accessor makes the earlier literal model field ambiguous and therefore not patchable.",
  "The only authorized criterion correction is r3758194569: after preserving the reviewed V1-01 and V1-02 privacy gates, bind V1-03 SCAN-004 to QG-SCANNER-CORPUS, the deterministic gate that exercises its adversarial assertion.",
  "The process task does not implement product behavior, broaden V1-03 capabilities, rewrite another task's acceptance criteria, or weaken privacy, abstention, or fail-closed requirements.",
  "V1-03 cannot begin or submit this corrective candidate until this task is accepted with candidate-bound command evidence.",
];
const v102AuthorizedInvariantSet = [
  "The golden suite runs without network access.",
  "Fixture secrets and protected output markers never appear in logs or reports.",
  "This reauthorized attempt is limited to r3754744063 application replay, r3754744064 unknown-outcome rejection, r3754744067 stale-source binding, r3754790013 transport budget propagation, and r3754790019 golden-fixture typechecking.",
  "The M0-04 amendment is limited to r3755066013 separate maintainer promotion and r3755066020 recursive durable-artifact redaction scanning.",
];

function assertV102ReauthorizationBoundary(plan, v102State, m003State) {
  const m003Task = plan.tasks.find((task) => task.id === "M0-03");
  const m004Task = plan.tasks.find((task) => task.id === "M0-04");
  const v102Task = plan.tasks.find((task) => task.id === "V1-02");
  const m003AcceptedAt = m003State.history.find((entry) => entry.to === "accepted")?.at;
  const priorV102History = v102State.history.filter(
    (entry) => m003AcceptedAt !== undefined && entry.at < m003AcceptedAt,
  );
  const findingIds = (task) =>
    [...task.semanticInvariants.join(" ").matchAll(/r[0-9]{10}/gu)].map(([id]) => id).sort();

  expect(m003Task).toBeDefined();
  expect(m004Task).toBeDefined();
  expect(v102Task).toBeDefined();
  if (
    m003Task === undefined ||
    m004Task === undefined ||
    v102Task === undefined ||
    m003AcceptedAt === undefined
  )
    throw new Error("M0-03, M0-04, and V1-02 reauthorization records must be present");

  expect(m003Task.maxAttempts).toBe(1);
  expect(m004Task.maxAttempts).toBe(1);
  expect(v102Task.maxAttempts).toBe(3);
  expect(v102Task.dependsOn).toContainEqual({ taskId: "M0-03", kind: "hard" });
  expect(v102Task.dependsOn).toContainEqual({ taskId: "M0-04", kind: "hard" });
  expect(findingIds(m003Task)).toEqual(reauthorizationFindingIds);
  expect(findingIds(m004Task)).toEqual(m004FindingIds);
  expect(findingIds(v102Task)).toEqual([...reauthorizationFindingIds, ...m004FindingIds].sort());
  expect(m003Task.semanticInvariants).toEqual(m003AuthorizedInvariantSet);
  expect(m004Task.semanticInvariants).toEqual(m004AuthorizedInvariantSet);
  expect(v102Task.semanticInvariants).toEqual(v102AuthorizedInvariantSet);
  expect(priorV102History.filter((entry) => entry.to === "in_progress")).toHaveLength(2);
  expect(priorV102History.filter((entry) => entry.to === "verification_pending")).toHaveLength(2);
  expect(priorV102History.filter((entry) => entry.to === "changes_requested")).toHaveLength(2);
  if (["planned", "ready"].includes(v102State.state)) {
    expect(v102State.attempt).toBe(2);
  } else {
    expect(v102State.attempt).toBe(3);
  }
}

function assertV103CorrectionAuthorization(plan, ledger, v103State) {
  const m005Task = plan.tasks.find((task) => task.id === "M0-05");
  const v103Task = plan.tasks.find((task) => task.id === "V1-03");
  const findingIds = (task) =>
    [...task.semanticInvariants.join(" ").matchAll(/r[0-9]{10}/gu)].map(([id]) => id).sort();

  expect(m005Task).toBeDefined();
  expect(v103Task).toBeDefined();
  if (m005Task === undefined || v103Task === undefined)
    throw new Error("M0-05 and V1-03 correction authorization records must be present");

  expect(m005Task.dependsOn).toEqual([{ taskId: "M0-04", kind: "hard" }]);
  expect(m005Task.scope).toEqual({
    allowedPaths: ["product/plans/oss-v1/**", "scripts/plan.test.mjs", "scripts/task.test.mjs"],
    forbiddenPaths: ["packages/**", "examples/**", "action.yml", ".github/**"],
  });
  expect(m005Task.maxAttempts).toBe(1);
  expect(m005Task.semanticInvariants).toEqual(m005AuthorizedInvariantSet);
  expect(findingIds(m005Task)).toEqual(m005FindingIds);
  expect(v103Task.dependsOn).toContainEqual({ taskId: "M0-05", kind: "hard" });
  expect(v103Task.maxAttempts).toBe(3);
  expect(v103State.attempt).toBe(3);
  expect(["changes_requested", "verification_pending", "accepted"]).toContain(v103State.state);
  if (v103State.state === "changes_requested") expect(v103State.candidate).toBeNull();
  else expect(v103State.candidate).toMatchObject({ executor: "implementation-agent" });
  expect(v103Task.semanticInvariants).toContain(
    "The M0-05 authorization is limited to r3758194562 accessor abstention and r3758194569 binding SCAN-004 to QG-SCANNER-CORPUS; it does not broaden discovery or permit source patching.",
  );
  expect(ledger.items.find((item) => item.id === "SCAN-004")?.verification.gateId).toBe(
    "QG-SCANNER-CORPUS",
  );
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
        actor: "plan-test-fixture",
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
        actor: "plan-test-fixture",
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
        actor: "plan-test-fixture",
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
        actor: "plan-test-fixture",
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
        actor: "plan-test-fixture",
        reason: "Reset the V1-03 correction authorization task with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(
    root,
    scannerCorrectionAuthorizationStatePath,
    scannerCorrectionAuthorizationState,
  );

  const localReviewStatePath = "product/plans/oss-v1/state/M0-06.json";
  const localReviewState = await readFixtureJson(root, localReviewStatePath);
  Object.assign(localReviewState, {
    revision: 0,
    state: "planned",
    attempt: 0,
    candidate: null,
    criteria: localReviewState.criteria.map((criterion) => ({
      ...criterion,
      status: "pending",
      evidenceRefs: [],
    })),
    gates: localReviewState.gates.map((gate) => ({
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
        actor: "plan-test-fixture",
        reason: "Reset the local-review process task with the V1-00 fixture baseline.",
      },
    ],
  });
  await writeFixtureJson(root, localReviewStatePath, localReviewState);

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
        actor: "plan-test-fixture",
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
        actor: "plan-test-fixture",
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
        actor: "plan-test-fixture",
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
        actor: "plan-test-fixture",
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
          actor: "plan-test-fixture",
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
        actor: "plan-test-fixture",
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
        actor: "plan-test-fixture",
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
  it("places one bounded review-lifecycle simplification before V1-07", async () => {
    const plan = await readFixtureJson(repositoryRoot, "product/plans/oss-v1/plan.json");
    const ledger = await readFixtureJson(
      repositoryRoot,
      "product/plans/oss-v1/acceptance-ledger.json",
    );
    const state = await readFixtureJson(repositoryRoot, "product/plans/oss-v1/state/M0-12.json");
    const task = plan.tasks.find((candidate) => candidate.id === "M0-12");
    const v107 = plan.tasks.find((candidate) => candidate.id === "V1-07");

    expect(task).toMatchObject({
      risk: { level: "medium" },
      dependsOn: [{ taskId: "M0-11", kind: "hard" }],
      acceptanceItemIds: ["PROCESS-012", "PROCESS-013", "PROCESS-014"],
      capabilities: { network: false, credentials: false, provider: false, githubWrite: false },
      maxAttempts: 1,
    });
    expect(task.scope.forbiddenPaths).toEqual(
      expect.arrayContaining(["packages/**", ".github/**", "llms.txt"]),
    );
    expect(task.semanticInvariants.join(" ")).toContain("product candidate");
    expect(task.semanticInvariants.join(" ").toLowerCase()).toContain("promotion-only commits");
    expect(task.semanticInvariants.join(" ")).toContain("one batch per product candidate");
    expect(task.semanticInvariants.join(" ")).toContain("standalone P2");
    expect(v107.dependsOn).toContainEqual({ taskId: "M0-13", kind: "hard" });
    expect(ledger.items.filter((item) => item.taskId === "M0-12")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "PROCESS-012", waivable: false }),
        expect.objectContaining({ id: "PROCESS-013", waivable: false }),
        expect.objectContaining({ id: "PROCESS-014", waivable: false }),
      ]),
    );
    expect(state.taskId).toBe("M0-12");
  });

  it("places one high-risk late-review correction before V1-07", async () => {
    const plan = await readFixtureJson(repositoryRoot, "product/plans/oss-v1/plan.json");
    const ledger = await readFixtureJson(
      repositoryRoot,
      "product/plans/oss-v1/acceptance-ledger.json",
    );
    const state = await readFixtureJson(repositoryRoot, "product/plans/oss-v1/state/M0-13.json");
    const task = plan.tasks.find((candidate) => candidate.id === "M0-13");
    const v107 = plan.tasks.find((candidate) => candidate.id === "V1-07");

    expect(task).toMatchObject({
      risk: { level: "high" },
      dependsOn: [{ taskId: "M0-14", kind: "hard" }],
      acceptanceItemIds: ["HARDEN-001", "HARDEN-002", "HARDEN-003", "PROCESS-016"],
      capabilities: { network: false, credentials: false, provider: false, githubWrite: false },
      maxAttempts: 2,
    });
    expect(task.scope.allowedPaths).toEqual(
      expect.arrayContaining([
        ".factory/profile.yaml",
        ".agents/skills/vetryn-implement-task/**",
        "packages/cli/**",
        "packages/openrouter/**",
        "docs/adr/0023-close-late-review-trust-and-delivery-gaps.md",
        "docs/oss-v1.md",
        "scripts/continue-next-skill.test.mjs",
        "scripts/verify_installed_worker_packs.py",
        "scripts/task.mjs",
      ]),
    );
    expect(task.deliverables).toEqual(
      expect.arrayContaining([
        ".agents/skills/vetryn-implement-task/**",
        "scripts/task.test.mjs",
        "scripts/verify_installed_worker_packs.py",
      ]),
    );
    expect(task.scope.allowedPaths).not.toEqual(
      expect.arrayContaining([
        ".agents/skills/vetryn-promote-task/**",
        "scripts/plan.mjs",
        "scripts/promotion-tail.mjs",
      ]),
    );
    expect(task.scope.allowedPaths).not.toContain(".factory/artifacts/task-runs/M0-13/**");
    expect(task.scope.forbiddenPaths).toEqual(
      expect.arrayContaining(["packages/core/**", ".github/**", "llms.txt"]),
    );
    expect(v107.dependsOn).toContainEqual({ taskId: "M0-13", kind: "hard" });
    const m013Items = ledger.items.filter((item) => item.taskId === "M0-13");
    expect(m013Items).toHaveLength(4);
    expect(m013Items.find((item) => item.id === "HARDEN-001")?.verification.gateId).toBe(
      "QG-CONTRACTS",
    );
    expect(state).toMatchObject({ taskId: "M0-13", revision: 2, state: "planned" });
  });

  it("places one terminal-review correction before M0-13", async () => {
    const plan = await readFixtureJson(repositoryRoot, "product/plans/oss-v1/plan.json");
    const ledger = await readFixtureJson(
      repositoryRoot,
      "product/plans/oss-v1/acceptance-ledger.json",
    );
    const state = await readFixtureJson(repositoryRoot, "product/plans/oss-v1/state/M0-14.json");
    const task = plan.tasks.find((candidate) => candidate.id === "M0-14");
    const m013 = plan.tasks.find((candidate) => candidate.id === "M0-13");

    expect(task).toMatchObject({
      risk: { level: "high" },
      dependsOn: [{ taskId: "M0-12", kind: "hard" }],
      acceptanceItemIds: ["PROCESS-015", "PROCESS-017", "PROCESS-018", "PROCESS-019"],
      capabilities: { network: false, credentials: false, provider: false, githubWrite: false },
      maxAttempts: 1,
    });
    expect(task.scope.forbiddenPaths).toEqual(
      expect.arrayContaining(["packages/**", ".github/**", "llms.txt"]),
    );
    expect(m013.dependsOn).toContainEqual({ taskId: "M0-14", kind: "hard" });
    expect(ledger.items.filter((item) => item.taskId === "M0-14")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "PROCESS-015", waivable: false }),
        expect.objectContaining({ id: "PROCESS-017", waivable: false }),
        expect.objectContaining({ id: "PROCESS-018", waivable: false }),
        expect.objectContaining({ id: "PROCESS-019", waivable: false }),
      ]),
    );
    expect(state.taskId).toBe("M0-14");
    expect(state.revision).toBeGreaterThanOrEqual(0);
  });

  it("locks narrow continuation behind one bounded process task", async () => {
    const plan = await readFixtureJson(repositoryRoot, "product/plans/oss-v1/plan.json");
    const ledger = await readFixtureJson(
      repositoryRoot,
      "product/plans/oss-v1/acceptance-ledger.json",
    );
    const state = await readFixtureJson(repositoryRoot, "product/plans/oss-v1/state/M0-11.json");
    const task = plan.tasks.find((candidate) => candidate.id === "M0-11");
    const v106 = plan.tasks.find((candidate) => candidate.id === "V1-06");

    expect(task).toMatchObject({
      risk: { level: "high" },
      dependsOn: [{ taskId: "M0-10", kind: "hard" }],
      acceptanceItemIds: ["PROCESS-010", "PROCESS-011"],
      capabilities: { network: false, credentials: false, provider: false, githubWrite: false },
    });
    expect(task.scope.allowedPaths).toEqual([
      ".agents/skills/vetryn-continue-next/**",
      ".github/CODEOWNERS",
      ".factory/profile.yaml",
      ".factory/README.md",
      "AGENTS.md",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "MAINTAINERS.md",
      "WORKFLOW.md",
      "docs/adr/0009-single-maintainer-v1-delivery.md",
      "docs/adr/0010-require-local-and-domain-review-evidence.md",
      "docs/adr/0022-separate-continuation-procedure-from-run-authority.md",
      "docs/agent-map.md",
      "docs/implementation/oss-v1-execution.md",
      "product/plans/oss-v1/**",
      "product/plans/README.md",
      "scripts/continue-next-skill.test.mjs",
      "scripts/plan.test.mjs",
      "scripts/semantic-risk.test.mjs",
      "scripts/task.mjs",
      "scripts/task.test.mjs",
    ]);
    expect(task.scope.forbiddenPaths).toEqual(
      expect.arrayContaining(["packages/**", ".github/workflows/**", "llms.txt"]),
    );
    expect(task.semanticInvariants.join(" ")).toContain("per-run grants");
    expect(task.semanticInvariants.join(" ")).toContain("MAINTAINERS.md");
    expect(task.semanticInvariants.join(" ")).toContain("sibling Factory checkout");
    expect(task.semanticInvariants.join(" ")).toContain("trusts the local developer runtime");
    expect(task.semanticInvariants.join(" ")).toContain("does not sandbox the host");
    expect(v106.dependsOn).toContainEqual({ taskId: "M0-11", kind: "hard" });
    expect(ledger.items.filter((item) => item.taskId === "M0-11")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "PROCESS-010", waivable: false }),
        expect.objectContaining({ id: "PROCESS-011", waivable: false }),
      ]),
    );
    expect(state.taskId).toBe("M0-11");
  });

  it("locks the M0-05 bounded V1-03 correction authorization", async () => {
    const planPath = "product/plans/oss-v1/plan.json";
    const ledgerPath = "product/plans/oss-v1/acceptance-ledger.json";
    const v103StatePath = "product/plans/oss-v1/state/V1-03.json";
    const plan = await readFixtureJson(repositoryRoot, planPath);
    const ledger = await readFixtureJson(repositoryRoot, ledgerPath);
    const v103State = await readFixtureJson(repositoryRoot, v103StatePath);

    assertV103CorrectionAuthorization(plan, ledger, v103State);

    const missingDependency = JSON.parse(JSON.stringify(plan));
    missingDependency.tasks.find((task) => task.id === "V1-03").dependsOn = missingDependency.tasks
      .find((task) => task.id === "V1-03")
      .dependsOn.filter((dependency) => dependency.taskId !== "M0-05");
    expect(() => assertV103CorrectionAuthorization(missingDependency, ledger, v103State)).toThrow();

    const extraCorrection = JSON.parse(JSON.stringify(plan));
    extraCorrection.tasks
      .find((task) => task.id === "M0-05")
      .semanticInvariants.push("An additional correction without a review ID.");
    expect(() => assertV103CorrectionAuthorization(extraCorrection, ledger, v103State)).toThrow();

    const trustBoundCriterion = JSON.parse(JSON.stringify(ledger));
    trustBoundCriterion.items.find((item) => item.id === "SCAN-004").verification.gateId =
      "QG-TRUST-REVIEW";
    expect(() => assertV103CorrectionAuthorization(plan, trustBoundCriterion, v103State)).toThrow();

    const inactiveCorrection = { ...v103State, state: "planned" };
    expect(() => assertV103CorrectionAuthorization(plan, ledger, inactiveCorrection)).toThrow();
  });

  it("locks the M0-03 and M0-04 bounded V1-02 reauthorization boundaries", async () => {
    const planPath = "product/plans/oss-v1/plan.json";
    const v102StatePath = "product/plans/oss-v1/state/V1-02.json";
    const m003StatePath = "product/plans/oss-v1/state/M0-03.json";
    const plan = await readFixtureJson(repositoryRoot, planPath);
    const v102State = await readFixtureJson(repositoryRoot, v102StatePath);
    const m003State = await readFixtureJson(repositoryRoot, m003StatePath);

    assertV102ReauthorizationBoundary(plan, v102State, m003State);

    const tooManyAttempts = JSON.parse(JSON.stringify(plan));
    tooManyAttempts.tasks.find((task) => task.id === "V1-02").maxAttempts = 4;
    expect(() =>
      assertV102ReauthorizationBoundary(tooManyAttempts, v102State, m003State),
    ).toThrow();

    const missingFinding = JSON.parse(JSON.stringify(plan));
    missingFinding.tasks.find((task) => task.id === "M0-03").semanticInvariants =
      missingFinding.tasks
        .find((task) => task.id === "M0-03")
        .semanticInvariants.filter((invariant) => !invariant.includes("r3754790019"));
    expect(() => assertV102ReauthorizationBoundary(missingFinding, v102State, m003State)).toThrow();

    const alteredRemedy = JSON.parse(JSON.stringify(plan));
    alteredRemedy.tasks.find((task) => task.id === "M0-03").semanticInvariants = alteredRemedy.tasks
      .find((task) => task.id === "M0-03")
      .semanticInvariants.map((invariant) =>
        invariant.replace(
          "reject unknown mock outcomes",
          "report unknown mock outcomes as success",
        ),
      );
    expect(() => assertV102ReauthorizationBoundary(alteredRemedy, v102State, m003State)).toThrow();

    const extraCorrection = JSON.parse(JSON.stringify(plan));
    extraCorrection.tasks
      .find((task) => task.id === "V1-02")
      .semanticInvariants.push("An additional authorization invariant without a review ID.");
    expect(() =>
      assertV102ReauthorizationBoundary(extraCorrection, v102State, m003State),
    ).toThrow();

    const extraM004Correction = JSON.parse(JSON.stringify(plan));
    extraM004Correction.tasks
      .find((task) => task.id === "M0-04")
      .semanticInvariants.push("An additional post-review correction without a review ID.");
    expect(() =>
      assertV102ReauthorizationBoundary(extraM004Correction, v102State, m003State),
    ).toThrow();

    const staleActiveAttempt = JSON.parse(JSON.stringify(v102State));
    staleActiveAttempt.state = "in_progress";
    staleActiveAttempt.attempt = 2;
    expect(() => assertV102ReauthorizationBoundary(plan, staleActiveAttempt, m003State)).toThrow();
  });

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
    expect(JSON.parse(contents).nextLegalTasks).toEqual(["M0-01", "M0-02"]);
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

  it.each([
    "scripts/**",
    "scripts/**/*",
    ".factory/**",
    ".factory/**/*",
    ".github/**",
    ".github/**/*",
    "product/plans/**",
    "product/plans/**/*",
    "docs/**",
  ])(
    "rejects an unaccepted low-risk task whose broad %s scope covers protected policy",
    async (scopePattern) => {
      const root = await createFixture();
      const planPath = "product/plans/oss-v1/plan.json";
      const plan = await readFixtureJson(root, planPath);
      const task = plan.tasks.find((candidate) => candidate.id === "M0-14");
      task.risk = { level: "low", domains: ["agent-workflow"] };
      task.scope.allowedPaths = [scopePattern];
      task.deliverables = [scopePattern];
      await writeFixtureJson(root, planPath, plan);

      const result = runPlan(root);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("M0-14 changes approval, evidence, persistence");
    },
  );

  it.each([
    ["protected exact path", ["scripts/task.mjs"], ["agent-workflow"]],
    ["maintainer authority path", ["MAINTAINERS.md"], ["agent-workflow"]],
    [
      "acceptance-ledger schema path",
      ["product/plans/schemas/acceptance-ledger.schema.json"],
      ["agent-workflow"],
    ],
    [
      "canonical acceptance ledger path",
      ["product/plans/oss-v1/acceptance-ledger.json"],
      ["agent-workflow"],
    ],
    ["canonical plan path", ["product/plans/oss-v1/plan.json"], ["agent-workflow"]],
    [
      "task-state schema path",
      ["product/plans/schemas/task-state.schema.json"],
      ["agent-workflow"],
    ],
    [
      "semantic-risk legacy schema path",
      ["product/plans/schemas/semantic-risk-report-v0.1.schema.json"],
      ["agent-workflow"],
    ],
    [
      "semantic-risk schema path",
      ["product/plans/schemas/semantic-risk-report-v0.2.schema.json"],
      ["agent-workflow"],
    ],
    ["semantic-risk validator path", ["scripts/semantic-risk.mjs"], ["agent-workflow"]],
    [
      "trust-review skill path",
      [".agents/skills/vetryn-trust-review/SKILL.md"],
      ["agent-workflow"],
    ],
    ["verification skill path", [".agents/skills/vetryn-verify-task/SKILL.md"], ["agent-workflow"]],
    ["security workflow path", [".github/workflows/codeql.yml"], ["agent-workflow"]],
    [
      "dependency security workflow path",
      [".github/workflows/dependency-review.yml"],
      ["agent-workflow"],
    ],
    ["supply-chain workflow path", [".github/workflows/scorecard.yml"], ["agent-workflow"]],
    [
      "credential and evidence implementation path",
      ["packages/cli/src/evidence-store.ts"],
      ["agent-workflow"],
    ],
    ["protected risk domain", ["packages/openrouter/**"], ["release-policy"]],
  ])("rejects an unaccepted medium-risk task with a %s", async (_name, paths, domains) => {
    const root = await createFixture();
    const planPath = "product/plans/oss-v1/plan.json";
    const plan = await readFixtureJson(root, planPath);
    const task = plan.tasks.find((candidate) => candidate.id === "M0-14");
    task.risk = { level: "medium", domains };
    task.scope.allowedPaths = paths;
    task.deliverables = paths;
    await writeFixtureJson(root, planPath, plan);

    const result = runPlan(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("M0-14 changes approval, evidence, persistence");
  });

  it("allows a low-risk package scope that cannot cover protected policy", async () => {
    const root = await createFixture();
    const planPath = "product/plans/oss-v1/plan.json";
    const plan = await readFixtureJson(root, planPath);
    const task = plan.tasks.find((candidate) => candidate.id === "M0-14");
    task.risk = { level: "low", domains: ["agent-workflow"] };
    task.scope.allowedPaths = ["packages/typescript/**"];
    task.deliverables = ["packages/typescript/**"];
    await writeFixtureJson(root, planPath, plan);

    const result = runPlan(root);

    expect(result.status, result.stderr).toBe(0);
  });
});

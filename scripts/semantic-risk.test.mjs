import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { semanticRiskRefs, validateSemanticRiskEvidence } from "./semantic-risk.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const semanticRiskScript = path.join(repositoryRoot, "scripts/semantic-risk.mjs");
const planScript = path.join(repositoryRoot, "scripts/plan.mjs");
const temporaryRoots = [];

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function run(root, ...arguments_) {
  return spawnSync(process.execPath, [semanticRiskScript, ...arguments_], {
    encoding: "utf8",
    env: { ...process.env, VETRYN_PLAN_REPO_ROOT: root },
  });
}

function git(root, ...arguments_) {
  const result = spawnSync("git", ["-C", root, ...arguments_], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function highRiskDraft() {
  return {
    artifact_lifecycle_matrix: [
      {
        artifact: "V1-06 recommendation evidence",
        producer_or_authority: "repository task",
        mutable_owner: "task executor before validation",
        states: ["generated", "persisted"],
        freshness: "pinned task source revision",
        integrity: "schema and digest validation",
        authenticity: "repository-owned integrity marker; independent authority is out of scope",
        actionable_states: [],
        transitions_and_recovery: ["Reject stale or tampered evidence and regenerate."],
      },
    ],
    authorization_boundary_trace: [
      "input_validation",
      "reuse_or_persistence",
      "plan_authorization",
      "workspace_mutation",
      "command_execution",
      "remote_effect",
      "external_status",
    ].map((stage) => ({
      stage,
      authority: "compiled V1-06 packet",
      input: "offline repository evidence",
      decision: "not_applicable",
      denied_behavior: "stop before implementation",
    })),
    normative_adversarial_matrix: [
      {
        invariant: "Recommendation evidence remains explicit and fail-closed.",
        positive: "Valid evidence permits implementation.",
        missing: "Missing evidence blocks implementation.",
        stale: "Stale evidence blocks implementation.",
        contradictory: "Contradictory evidence abstains.",
        tampered: "Tampered evidence blocks implementation.",
        transition_or_recovery: "Regenerate from a clean task baseline.",
        concurrency: "Task-specific paths prevent writer collision.",
      },
    ],
    external_effect_preflight: {
      actions: [
        "agent_runner",
        "model",
        "repository_command",
        "package_registry",
        "provider_sandbox",
        "github",
        "provider_status",
      ].map((action) => ({
        action,
        disposition: "not_applicable",
        authority_ref: null,
        invalid_authority_effect: { calls: 0, spend_usd: 0, writes: 0 },
      })),
    },
    persistence_threat_matrix: [
      "integrity",
      "authenticity",
      "freshness",
      "completeness",
      "ordering",
      "anti_rollback",
    ].map((threat) => ({
      threat,
      attack_cases: [`Reject ${threat} violations.`],
      expected_disposition: "reject",
    })),
    review_convergence: {
      implementation_design_pass: "pass",
      same_subsystem_p1_rounds_seen: 0,
      decision: "proceed",
    },
    residual_risks: ["The field task remains separately gated."],
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vetryn-semantic-risk-"));
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
  await cp(path.join(repositoryRoot, ".factory"), path.join(root, ".factory"), { recursive: true });

  const planPath = path.join(root, "product/plans/oss-v1/plan.json");
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const evaluationTask = plan.tasks.find((task) => task.id === "V1-06");
  evaluationTask.dependsOn = evaluationTask.dependsOn.filter(
    (dependency) => dependency.taskId !== "M0-11",
  );
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const planWrite = spawnSync(process.execPath, [planScript, "write"], {
    encoding: "utf8",
    env: { ...process.env, VETRYN_PLAN_REPO_ROOT: root },
  });
  expect(planWrite.status, planWrite.stderr).toBe(0);

  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Vetryn semantic-risk fixture");
  git(root, "config", "user.email", "fixture@vetryn.invalid");
  git(root, "add", ".factory", "docs", "examples", "product", "pnpm-lock.yaml");
  git(root, "commit", "--quiet", "-m", "fixture baseline");
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("semantic-risk implementation design", () => {
  it("binds a high-risk draft to a clean candidate snapshot and rejects unrelated changes", async () => {
    const root = await createFixture();
    const draftRef = ".factory/tmp/task-runs/V1-06/semantic-risk-report.draft.json";
    await mkdir(path.dirname(path.join(root, draftRef)), { recursive: true });
    await writeFile(path.join(root, draftRef), `${JSON.stringify(highRiskDraft(), null, 2)}\n`);

    await writeFile(path.join(root, "unexpected.txt"), "not authorized\n");
    const dirty = run(root, "design", "V1-06", "--input", draftRef);
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain("requires a clean candidate snapshot");
    await rm(path.join(root, "unexpected.txt"));

    const result = run(root, "design", "--", "V1-06", "--input", draftRef);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "pass", taskId: "V1-06" });
    const rerun = run(root, "design", "--", "V1-06", "--input", draftRef);
    expect(rerun.status, rerun.stderr).toBe(0);
    const report = JSON.parse(
      await readFile(
        path.join(root, ".factory/artifacts/task-runs/V1-06/semantic-risk-report.json"),
        "utf8",
      ),
    );
    expect(report).toMatchObject({
      task_id: "V1-06",
      risk_class: "high",
      source_revision: git(root, "rev-parse", "HEAD"),
      profile_ref: ".factory/profile.yaml",
      review_convergence: { implementation_design_pass: "pass", decision: "proceed" },
    });
    expect(report.baseline_evidence.work_proof_marker_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const { reportRef, integrityMarkerRef } = semanticRiskRefs("V1-06");
    const integrityMarker = JSON.parse(await readFile(path.join(root, integrityMarkerRef), "utf8"));
    expect(integrityMarker).toMatchObject({
      artifact_type: "semantic_risk_integrity_marker",
      schema_version: "0.2",
    });
    expect(integrityMarker).not.toHaveProperty("generated_by");
    expect(integrityMarker).not.toHaveProperty("runner_id");
    git(root, "add", reportRef, integrityMarkerRef);
    git(root, "commit", "--quiet", "-m", "commit semantic-risk evidence");
    const candidateCommit = git(root, "rev-parse", "HEAD");
    const packet = {
      task_id: "V1-06",
      risk_class: "high",
      semantic_risk_report_ref: reportRef,
      semantic_risk_integrity_marker_ref: integrityMarkerRef,
      currentState: { candidate: { commit: candidateCommit } },
    };
    await expect(validateSemanticRiskEvidence({ root, packet })).resolves.toBeUndefined();

    const contradictoryMarker = JSON.parse(
      await readFile(path.join(root, integrityMarkerRef), "utf8"),
    );
    contradictoryMarker.task_id = "V1-07";
    const contradictoryMarkerBytes = `${JSON.stringify(contradictoryMarker, null, 2)}\n`;
    const contradictoryReport = JSON.parse(await readFile(path.join(root, reportRef), "utf8"));
    contradictoryReport.baseline_evidence.work_proof_marker_sha256 =
      sha256(contradictoryMarkerBytes);
    await writeFile(path.join(root, integrityMarkerRef), contradictoryMarkerBytes);
    await writeFile(
      path.join(root, reportRef),
      `${JSON.stringify(contradictoryReport, null, 2)}\n`,
    );
    git(root, "add", reportRef, integrityMarkerRef);
    git(root, "commit", "--quiet", "-m", "commit contradictory marker");
    packet.currentState.candidate.commit = git(root, "rev-parse", "HEAD");
    await expect(validateSemanticRiskEvidence({ root, packet })).rejects.toThrow(
      "integrity marker contains unsupported or redundant fields",
    );
    packet.currentState.candidate.commit = candidateCommit;

    await writeFile(path.join(root, reportRef), "{}\n");
    await expect(validateSemanticRiskEvidence({ root, packet })).resolves.toBeUndefined();
    packet.currentState.candidate.commit = git(root, "rev-parse", `${candidateCommit}^`);
    await expect(validateSemanticRiskEvidence({ root, packet })).rejects.toThrow(
      "semantic-risk report is unavailable at candidate",
    );
  }, 15_000);

  it("rejects external-action authorization in the offline repo-native design pass", async () => {
    const root = await createFixture();
    const draftRef = ".factory/tmp/task-runs/V1-06/semantic-risk-report.draft.json";
    const draft = highRiskDraft();
    const githubAction = draft.external_effect_preflight.actions.find(
      ({ action }) => action === "github",
    );
    Object.assign(githubAction, {
      disposition: "authorized",
      authority_ref: "docs/authority.json",
    });
    await mkdir(path.dirname(path.join(root, draftRef)), { recursive: true });
    await writeFile(path.join(root, draftRef), `${JSON.stringify(draft, null, 2)}\n`);
    const design = run(root, "design", "--", "V1-06", "--input", draftRef);
    expect(design.status).toBe(1);
    expect(design.stderr).toContain("cannot authorize external actions");
    expect(git(root, "status", "--short")).toBe("?? .factory/tmp/task-runs/V1-06/");
    const { reportRef, integrityMarkerRef } = semanticRiskRefs("V1-06");
    await expect(readFile(path.join(root, reportRef))).rejects.toThrow();
    await expect(readFile(path.join(root, integrityMarkerRef))).rejects.toThrow();
  });

  it("rejects malformed or reversed timestamps and additional task bindings", async () => {
    const root = await createFixture();
    const draftRef = ".factory/tmp/task-runs/V1-06/semantic-risk-report.draft.json";
    const { reportRef, integrityMarkerRef } = semanticRiskRefs("V1-06");
    await mkdir(path.dirname(path.join(root, draftRef)), { recursive: true });
    await writeFile(path.join(root, draftRef), `${JSON.stringify(highRiskDraft(), null, 2)}\n`);
    const design = run(root, "design", "--", "V1-06", "--input", draftRef);
    expect(design.status, design.stderr).toBe(0);
    git(root, "add", reportRef, integrityMarkerRef);
    git(root, "commit", "--quiet", "-m", "commit semantic-risk evidence");

    const validMarker = JSON.parse(await readFile(path.join(root, integrityMarkerRef), "utf8"));
    const packet = {
      task_id: "V1-06",
      risk_class: "high",
      semantic_risk_report_ref: reportRef,
      semantic_risk_integrity_marker_ref: integrityMarkerRef,
      currentState: { candidate: { commit: "" } },
    };
    const commitMarker = async (marker, message) => {
      const markerBytes = `${JSON.stringify(marker, null, 2)}\n`;
      const report = JSON.parse(await readFile(path.join(root, reportRef), "utf8"));
      report.baseline_evidence.work_proof_marker_sha256 = sha256(markerBytes);
      await writeFile(path.join(root, integrityMarkerRef), markerBytes);
      await writeFile(path.join(root, reportRef), `${JSON.stringify(report, null, 2)}\n`);
      git(root, "add", reportRef, integrityMarkerRef);
      git(root, "commit", "--quiet", "-m", message);
      packet.currentState.candidate.commit = git(root, "rev-parse", "HEAD");
    };
    const cloneValidMarker = () => JSON.parse(JSON.stringify(validMarker));

    const malformedTimestamp = cloneValidMarker();
    malformedTimestamp.finished_at = "not-a-date";
    await commitMarker(malformedTimestamp, "commit malformed timestamp");
    await expect(validateSemanticRiskEvidence({ root, packet })).rejects.toThrow(
      "integrity marker finished_at must be an RFC 3339 timestamp",
    );

    const reversedTimestamps = cloneValidMarker();
    reversedTimestamps.started_at = "2030-01-01T00:00:00.000Z";
    await commitMarker(reversedTimestamps, "commit reversed timestamps");
    await expect(validateSemanticRiskEvidence({ root, packet })).rejects.toThrow(
      "integrity marker timestamps must satisfy started_at <= finished_at <= report created_at",
    );

    const additionalBinding = cloneValidMarker();
    additionalBinding.authorized_task_bindings.push({
      ...additionalBinding.authorized_task_bindings[0],
      task_id: "V1-07",
    });
    await commitMarker(additionalBinding, "commit additional task binding");
    await expect(validateSemanticRiskEvidence({ root, packet })).rejects.toThrow(
      "integrity marker does not bind the exact semantic-risk content and source",
    );
  }, 15_000);

  it("rejects artifact paths redirected outside the repository by a symlink", async () => {
    const root = await createFixture();
    const outside = await mkdtemp(path.join(tmpdir(), "vetryn-semantic-risk-outside-"));
    temporaryRoots.push(outside);
    const draftRef = ".factory/tmp/task-runs/V1-06/semantic-risk-report.draft.json";
    await mkdir(path.dirname(path.join(root, draftRef)), { recursive: true });
    await writeFile(path.join(root, draftRef), `${JSON.stringify(highRiskDraft(), null, 2)}\n`);
    const redirectedDirectory = path.join(root, ".factory/artifacts/task-runs/V1-06");
    await symlink(outside, redirectedDirectory);
    git(root, "add", ".factory/artifacts/task-runs/V1-06");
    git(root, "commit", "--quiet", "-m", "commit redirected artifact directory");

    const result = run(root, "design", "--", "V1-06", "--input", draftRef);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("escapes the repository via symlink");
    await expect(readFile(path.join(outside, "semantic-risk-report.json"))).rejects.toThrow();
    await expect(
      readFile(path.join(outside, "semantic-risk-integrity-marker.json")),
    ).rejects.toThrow();
  });
});

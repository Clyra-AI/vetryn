import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { semanticRiskRefs, validateSemanticRiskEvidence } from "./semantic-risk.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const semanticRiskScript = path.join(repositoryRoot, "scripts/semantic-risk.mjs");
const temporaryRoots = [];

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
        authenticity: "repository-owned preflight runner",
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
      pre_implementation_design_pass: "pass",
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

describe("semantic-risk preflight", () => {
  it("seals a high-risk draft from a clean baseline and rejects unrelated changes", async () => {
    const root = await createFixture();
    const draftRef = ".factory/tmp/task-runs/V1-06/semantic-risk-report.draft.json";
    await mkdir(path.dirname(path.join(root, draftRef)), { recursive: true });
    await writeFile(path.join(root, draftRef), `${JSON.stringify(highRiskDraft(), null, 2)}\n`);

    await writeFile(path.join(root, "unexpected.txt"), "not authorized\n");
    const dirty = run(root, "preflight", "V1-06", "--input", draftRef);
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain("requires a clean baseline");
    await rm(path.join(root, "unexpected.txt"));

    const result = run(root, "preflight", "--", "V1-06", "--input", draftRef);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "pass", taskId: "V1-06" });
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
      review_convergence: { pre_implementation_design_pass: "pass", decision: "proceed" },
    });
    expect(report.baseline_evidence.work_proof_marker_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const { reportRef, markerRef } = semanticRiskRefs("V1-06");
    git(root, "add", reportRef, markerRef);
    git(root, "commit", "--quiet", "-m", "commit semantic-risk evidence");
    const candidateCommit = git(root, "rev-parse", "HEAD");
    const packet = {
      task_id: "V1-06",
      risk_class: "high",
      semantic_risk_report_ref: reportRef,
      semantic_risk_baseline_marker_ref: markerRef,
      currentState: { candidate: { commit: candidateCommit } },
    };
    await expect(validateSemanticRiskEvidence({ root, packet })).resolves.toBeUndefined();

    await writeFile(path.join(root, reportRef), "{}\n");
    await expect(validateSemanticRiskEvidence({ root, packet })).resolves.toBeUndefined();
    packet.currentState.candidate.commit = git(root, "rev-parse", "HEAD~1");
    await expect(validateSemanticRiskEvidence({ root, packet })).rejects.toThrow(
      "semantic-risk report is unavailable at candidate",
    );
  });

  it("rejects external-action authorization in the offline repo-native preflight", async () => {
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
    const preflight = run(root, "preflight", "--", "V1-06", "--input", draftRef);
    expect(preflight.status).toBe(1);
    expect(preflight.stderr).toContain("cannot authorize external actions");
    expect(git(root, "status", "--short")).toBe("?? .factory/tmp/");
    const { reportRef, markerRef } = semanticRiskRefs("V1-06");
    await expect(readFile(path.join(root, reportRef))).rejects.toThrow();
    await expect(readFile(path.join(root, markerRef))).rejects.toThrow();
  });
});

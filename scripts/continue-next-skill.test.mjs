import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  executeVerifiedSnapshot,
  portableFactoryPlatformSupported,
  PREFLIGHT_SCHEMA_VERSION,
} from "../.agents/skills/vetryn-continue-next/scripts/preflight.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const skillRef = ".agents/skills/vetryn-continue-next";
const workers = ["task-executor", "validation-gate", "code-review", "commit-push"];
const sandboxes = [];

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function command(cwd, executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${executable} ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result;
}

function git(root, ...args) {
  return command(root, "git", args).stdout.trim();
}

function write(root, relative, contents, mode) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  if (mode) chmodSync(target, mode);
}

const fakePlanScript = `
import { readFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const behavior = JSON.parse(readFileSync(".adapter-behavior.json", "utf8"));
if (process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN || process.env.AWS_SECRET_ACCESS_KEY) process.exit(91);
if (process.env.GIT_NO_REPLACE_OBJECTS !== "1") process.exit(92);
if (process.argv[2] !== "check") process.exit(2);
if (behavior.mutation === "ignored") appendFileSync(".ignored", "changed\\n");
if (behavior.mutation === "tracked") appendFileSync("WORKFLOW.md", "changed\\n");
if (behavior.mutation === "config") spawnSync("git", ["config", "test.preflightMutation", "yes"]);
if (behavior.mutation === "ref") spawnSync("git", ["update-ref", "refs/heads/preflight-mutated", "HEAD"]);
if (behavior.mutation === "index") {
  appendFileSync("index-target.txt", "changed\\n");
  spawnSync("git", ["add", "index-target.txt"]);
}
process.stdout.write("implementation plan is valid and progress is current\\n");
`;

const fakeTaskScript = `
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const behavior = JSON.parse(readFileSync(".adapter-behavior.json", "utf8"));
if (process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN || process.env.AWS_SECRET_ACCESS_KEY) process.exit(91);
if (process.env.GIT_NO_REPLACE_OBJECTS !== "1") process.exit(92);
const git = (...args) => spawnSync("git", args, { encoding: "utf8" }).stdout.trim();
if (process.argv[2] === "next") {
  process.stdout.write(JSON.stringify({
    planId: "fixture-plan",
    activeTasks: behavior.activeTasks,
    nextLegalTasks: behavior.nextLegalTasks,
    blockedTasks: [],
  }));
  process.exit(0);
}
if (process.argv[2] !== "compile" || !process.argv[3]) process.exit(2);
const taskId = process.argv[3];
const active = behavior.activeTasks.find((record) => record.taskId === taskId);
const head = git("rev-parse", "HEAD");
const base = git("rev-parse", "refs/heads/main");
const workerChain = ["task-executor", "validation-gate", "code-review", "commit-push"];
const packet = {
  packetId: "fixture-plan:" + taskId + ":r0",
  task_id: taskId,
  risk_class: "high",
  allowed_paths: [".adapter-behavior.json", "src/**"],
  forbidden_paths: ["secrets/**"],
  validation_commands: ["pnpm check", "pnpm test:contracts"],
  baseline_commands: ["pnpm format:check"],
  red_first_commands: ["pnpm test"],
  final_validation_commands: ["pnpm check"],
  required_worker_chain: workerChain,
  required_domain_review_chain: [],
  requiredReviews: ["maintainer"],
  lifecycle_gates: {
    local_validation_required: true,
    ci_required: true,
    code_review_required: true,
    trust_review_required: false,
    codex_review_required: false,
    commit_push_required: true,
    post_merge_monitor_required: true,
    pr_lifecycle_report_required: true,
    skip_policy: "approved_exception_required",
  },
  task: {
    capabilities: { network: false, credentials: false, provider: false, githubWrite: false },
  },
  execution: {
    implementSkill: "vetryn-implement-task",
    verifySkill: "vetryn-verify-task",
    promoteSkill: "vetryn-promote-task",
    factorySkills: workerChain,
    maintainerApprovalRequired: true,
    progressIsGenerated: true,
    executorMayAccept: false,
    deliveryPermissions: { mode: "factory-lifecycle-only" },
  },
  currentState: {
    state: active ? (behavior.compiledState ?? active.state) : "planned",
    candidate: active && behavior.candidateBound
      ? { baseCommit: base, commit: head, executor: "fixture-executor" }
      : null,
  },
};
process.stdout.write(JSON.stringify(packet));
`;

const fakeVerifier = `#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path

if any(os.environ.get(key) for key in ("OPENAI_API_KEY", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY")):
    raise SystemExit(91)
if os.environ.get("GIT_NO_REPLACE_OBJECTS") != "1":
    raise SystemExit(92)

parser = argparse.ArgumentParser()
parser.add_argument("mode")
parser.add_argument("--skills-root", required=True)
parser.add_argument("--repo-root", required=True)
parser.add_argument("--profile", required=True)
parser.add_argument("--require", required=True)
parser.add_argument("--json", action="store_true")
args = parser.parse_args()
skills = args.require.split(",")
digests = {}
for skill in skills:
    root = Path(args.skills_root) / skill
    manifest_path = root / "resources" / "portable-pack-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest["skill_id"] != skill:
        raise SystemExit(2)
    for resource in manifest["resources"]:
        target = root / resource["path"]
        actual = "sha256:" + hashlib.sha256(target.read_bytes()).hexdigest()
        if target.is_symlink() or actual != resource["sha256"]:
            raise SystemExit(2)
    digests[skill] = "sha256:" + hashlib.sha256(manifest_path.read_bytes()).hexdigest()
profile = Path(args.profile).read_text()
source_line = next(line for line in profile.splitlines() if line.strip().startswith("source_ref:"))
source_ref = source_line.split(":", 1)[1].strip()
behavior = json.loads((Path(args.repo_root) / ".adapter-behavior.json").read_text())
race = behavior.get("race")
race_marker = Path(args.skills_root) / ".race-fired"
if race and not race_marker.exists():
    race_marker.write_text("fired\\n")
    if race == "profile":
        Path(args.profile).write_text(Path(args.profile).read_text() + "# raced\\n")
    elif race == "manifest":
        target = Path(args.skills_root) / "task-executor" / "resources" / "portable-pack-manifest.json"
        target.write_text(target.read_text() + " ")
    elif race == "verifier":
        target = Path(args.skills_root) / "task-executor" / "scripts" / "verify_portable_pack.py"
        target.write_text(target.read_text() + "# raced\\n")
payload = {
    "manifest_digests": digests,
    "pack_set_version": "1",
    "profile": ".factory/profile.yaml",
    "skills": skills,
    "source_ref": source_ref,
    "status": "verified",
}
print(json.dumps(payload, separators=(",", ":"), sort_keys=True))
`;

function makePacks(skillsRoot) {
  const pins = {};
  for (const worker of workers) {
    const root = path.join(skillsRoot, worker);
    const resources = {
      "SKILL.md": `---\nname: ${worker}\ndescription: fixture\n---\n`,
      "agents/openai.yaml": `interface:\n  display_name: "${worker}"\n`,
      "resources/helper.txt": "fixture-helper\n",
      "resources/profile-requirements.json": "{}\n",
      "scripts/verify_portable_pack.py": fakeVerifier,
    };
    for (const [relative, contents] of Object.entries(resources)) {
      write(root, relative, contents, relative.endsWith(".py") ? 0o755 : undefined);
    }
    const manifest = {
      manifest_version: "1",
      pack_set_version: "1",
      skill_id: worker,
      resources: Object.entries(resources)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([relative, contents]) => ({ path: relative, sha256: sha256(contents) })),
    };
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    write(root, "resources/portable-pack-manifest.json", manifestBytes);
    pins[worker] = sha256(manifestBytes);
  }
  return pins;
}

function profile(pins) {
  return `project: fixture
product_name: Fixture
repo_root: .
default_branch: main
maintainer_roster: MAINTAINERS.md
plan_root: product/plans/oss-v1
standards:
  repo_contract: AGENTS.md
  product_contract: docs/oss-v1.md
  dev_guide: CONTRIBUTING.md
  architecture_guide: docs/architecture.md
  workflow_contract: WORKFLOW.md
task_adapter:
  plan_script: scripts/plan.mjs
  task_script: scripts/task.mjs
  plan_check_args:
    - check
  next_args:
    - next
  compile_args:
    - compile
  packet_schema: product/plans/schemas/task-packet.schema.json
skills:
  continue: .agents/skills/vetryn-continue-next/SKILL.md
  implement: .agents/skills/vetryn-implement-task/SKILL.md
  verify: .agents/skills/vetryn-verify-task/SKILL.md
  promote: .agents/skills/vetryn-promote-task/SKILL.md
implementation_risk:
  high_risk_change_classes:
    - authorization
  required_transition_classes:
    - planned_to_active
code_review:
  review_modes:
    - diff
  baseline_commands:
    - pnpm format:check
  command_anchors:
    - pnpm check
  high_risk_surfaces:
    - scripts
  severity_escalators:
    - correctness break is P1
commit_push:
  modes:
    - land
  default_remote: origin
  protected_branches:
    - main
  local_validation:
    - pnpm check
  command_anchors:
    - pnpm check
  required_pr_checks:
    - discover-from-github
  optional_checks: []
  ci_timeout_minutes: 25
  poll_seconds: 10
  max_no_progress_cycles: 2
  merge_strategy_order:
    - squash
  submodule_policy:
    factory_path: .factory/disabled
    require_clean_submodules: false
    require_factory_commit_first: false
    allow_parent_pointer_update_after_factory_commit: false
  codex_review:
    enabled: true
    reviewer_identity: chatgpt-codex-connector
    initial_wait_minutes: 15
    followup_wait_minutes: 5
    eyes_wait_minutes: 15
    poll_seconds: 15
    carry_forward_requires_prior_artifact: true
    standalone_p2_exception:
      enabled: true
      authorization: explicit_human_task_or_pr
      max_findings: 1
      allowed_priorities:
        - P2
      require_current_head: true
      require_green_ci: true
      require_complete_current_head_inventory: true
      require_no_active_eyes: true
      require_no_changes_requested: true
      require_no_p0_p1: true
      require_no_unclassified: true
      forbidden_break_classes:
        - correctness
      evidence_ref_required: true
  post_merge:
    monitor_main: true
    timeout_minutes: 25
    hotfix_enabled: true
    max_hotfix_loops: 2
    hotfix_branch_pattern: codex/hotfix-{topic}-r{n}
factory_worker_packs:
  contract_version: "1"
  pack_set_version: "1"
  source_ref: Clyra-AI/factory@1111111111111111111111111111111111111111
  manifest_sha256:
    task-executor: ${pins["task-executor"]}
    validation-gate: ${pins["validation-gate"]}
    code-review: ${pins["code-review"]}
    commit-push: ${pins["commit-push"]}
`;
}

function makeFixture(options = {}) {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "vetryn-continue-"));
  sandboxes.push(sandbox);
  const root = path.join(sandbox, "arbitrary", "checkout");
  const codexHome = path.join(sandbox, "installed-codex");
  const skillsRoot = path.join(codexHome, "skills");
  mkdirSync(root, { recursive: true });
  mkdirSync(skillsRoot, { recursive: true });
  command(root, "git", ["init", "--initial-branch=main"]);
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Fixture");
  const pins = makePacks(skillsRoot);

  cpSync(path.join(repositoryRoot, skillRef), path.join(root, skillRef), { recursive: true });
  for (const name of ["vetryn-implement-task", "vetryn-verify-task", "vetryn-promote-task"]) {
    write(
      root,
      `.agents/skills/${name}/SKILL.md`,
      `---\nname: ${name}\ndescription: fixture\n---\n`,
    );
  }
  write(root, ".gitignore", "node_modules\n.ignored\n");
  symlinkSync(path.join(repositoryRoot, "node_modules"), path.join(root, "node_modules"), "dir");
  write(root, ".ignored", "initial\n");
  write(root, "AGENTS.md", "# Fixture agent contract\n");
  write(root, "WORKFLOW.md", "# Fixture workflow\n");
  write(root, "CONTRIBUTING.md", "# Fixture dev guide\n");
  write(root, "MAINTAINERS.md", "- fixture-maintainer\n");
  write(root, "docs/oss-v1.md", "# Fixture product\n");
  write(root, "docs/architecture.md", "# Fixture architecture\n");
  write(root, "product/plans/oss-v1/plan.json", "{}\n");
  write(root, "product/plans/schemas/task-packet.schema.json", "{}\n");
  write(root, "scripts/plan.mjs", fakePlanScript);
  write(root, "scripts/task.mjs", fakeTaskScript);
  write(root, "index-target.txt", "initial\n");
  write(
    root,
    ".adapter-behavior.json",
    `${JSON.stringify({
      activeTasks: options.activeTasks ?? [],
      nextLegalTasks: options.nextLegalTasks ?? ["TASK-ALPHA"],
      mutation: options.mutation ?? null,
      race: options.race ?? null,
      compiledState: options.compiledState ?? null,
      candidateBound: options.candidateBound ?? false,
    })}\n`,
  );
  write(root, ".factory/profile.yaml", profile(pins));
  write(
    root,
    "package.json",
    `${JSON.stringify({
      name: "fixture",
      private: true,
      type: "module",
      scripts: {
        check: "true",
        "test:contracts": "true",
        "format:check": "true",
        test: "true",
      },
    })}\n`,
  );
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture baseline");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  return { root, sandbox, codexHome, skillsRoot };
}

function setBehavior(fixture, value, message = "update fixture behavior") {
  write(fixture.root, ".adapter-behavior.json", `${JSON.stringify(value)}\n`);
  git(fixture.root, "add", ".adapter-behavior.json");
  git(fixture.root, "commit", "-m", message);
  if (git(fixture.root, "branch", "--show-current") === "main") {
    git(fixture.root, "update-ref", "refs/remotes/origin/main", "HEAD");
  }
}

function runPreflight(fixture, extraEnv = {}, nodeArguments = []) {
  const script = path.join(fixture.root, skillRef, "scripts/preflight.mjs");
  const result = command(fixture.root, process.execPath, [...nodeArguments, script], {
    allowFailure: true,
    env: {
      AWS_SECRET_ACCESS_KEY: "must-not-leak-aws",
      CODEX_HOME: fixture.codexHome,
      FACTORY_WORKER_SKILLS_ROOT: fixture.skillsRoot,
      GITHUB_TOKEN: "must-not-leak-github",
      OPENAI_API_KEY: "must-not-leak-openai",
      ...extraEnv,
    },
  });
  return { ...result, json: JSON.parse(result.stdout) };
}

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

describe("vetryn-continue-next preflight", () => {
  it("is portable, deterministic, schema-valid, secret-free, and ready only for later authority", () => {
    expect(PREFLIGHT_SCHEMA_VERSION).toBe("1.0.0");
    const fixture = makeFixture();
    expect(path.join(fixture.root, "..", "factory")).not.toSatisfy((candidate) => {
      try {
        return lstatSync(candidate).isDirectory();
      } catch {
        return false;
      }
    });
    const first = runPreflight(fixture);
    const second = runPreflight(fixture);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.json).toMatchObject({
      status: "ready_for_authority",
      mode: "start",
      selection: { taskId: "TASK-ALPHA", source: "next_legal", state: "planned" },
      authority: { currentRunGrantPresent: false, status: "required_before_mutation" },
      resolved: {
        factorySkills: workers,
        lifecycleGates: {
          codexReviewRequired: false,
          prLifecycleReportRequired: true,
          skipPolicy: "approved_exception_required",
        },
      },
    });
    expect(first.stdout).not.toContain(fixture.root);
    expect(first.stdout).not.toContain(fixture.skillsRoot);
    expect(first.stdout).not.toContain("must-not-leak");
    const schema = JSON.parse(
      readFileSync(
        path.join(fixture.root, skillRef, "references/preflight-result.schema.json"),
        "utf8",
      ),
    );
    expect(new Ajv2020({ allowUnionTypes: true, strict: true }).compile(schema)(first.json)).toBe(
      true,
    );
    expect(git(fixture.root, "status", "--short")).toBe("");
  });

  it("resumes one active candidate ahead of next-legal work", () => {
    const fixture = makeFixture();
    git(fixture.root, "switch", "-c", "codex/active-fixture");
    setBehavior(fixture, {
      activeTasks: [{ taskId: "TASK-ACTIVE", state: "in_progress" }],
      nextLegalTasks: ["TASK-FUTURE"],
      mutation: null,
      race: null,
      compiledState: null,
      candidateBound: false,
    });
    const result = runPreflight(fixture);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      status: "ready_for_authority",
      mode: "resume",
      selection: { taskId: "TASK-ACTIVE", source: "active", state: "in_progress" },
    });
  });

  it.each([
    ["in_progress", true],
    ["verification_pending", false],
    ["review_pending", true],
    ["changes_requested", true],
  ])("blocks unsupported frozen resume state %s", (state, candidateBound) => {
    const fixture = makeFixture();
    git(fixture.root, "switch", "-c", `codex/frozen-${state}`);
    setBehavior(fixture, {
      activeTasks: [{ taskId: "TASK-ACTIVE", state }],
      nextLegalTasks: [],
      mutation: null,
      race: null,
      compiledState: null,
      candidateBound,
    });
    const result = runPreflight(fixture);
    expect(result.status).toBe(2);
    expect(result.json.blockers).toContainEqual({
      check: "branch_state",
      code: "frozen_candidate_resume_unsupported",
    });
  });

  it("blocks candidate-null active work on default, non-descendant, dirty, and out-of-scope branches", () => {
    const defaultBranch = makeFixture({
      activeTasks: [{ taskId: "TASK-ACTIVE", state: "in_progress" }],
    });
    const defaultResult = runPreflight(defaultBranch);
    expect(defaultResult.json.blockers).toContainEqual({
      check: "branch_state",
      code: "active_task_requires_candidate_branch",
    });

    const nonDescendant = makeFixture();
    git(nonDescendant.root, "switch", "-c", "codex/non-descendant");
    setBehavior(nonDescendant, {
      activeTasks: [{ taskId: "TASK-ACTIVE", state: "in_progress" }],
      nextLegalTasks: [],
      mutation: null,
      race: null,
      compiledState: null,
      candidateBound: false,
    });
    git(nonDescendant.root, "switch", "main");
    git(nonDescendant.root, "commit", "--allow-empty", "-m", "advance canonical default");
    git(nonDescendant.root, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(nonDescendant.root, "switch", "codex/non-descendant");
    const nonDescendantResult = runPreflight(nonDescendant);
    expect(nonDescendantResult.json.blockers).toContainEqual({
      check: "branch_state",
      code: "active_branch_not_default_descendant",
    });

    const dirty = makeFixture();
    git(dirty.root, "switch", "-c", "codex/dirty-active");
    setBehavior(dirty, {
      activeTasks: [{ taskId: "TASK-ACTIVE", state: "in_progress" }],
      nextLegalTasks: [],
      mutation: null,
      race: null,
      compiledState: null,
      candidateBound: false,
    });
    writeFileSync(path.join(dirty.root, "WORKFLOW.md"), "dirty\n", { flag: "a" });
    const dirtyResult = runPreflight(dirty);
    expect(dirtyResult.json.blockers).toContainEqual({
      check: "repository_clean",
      code: "dirty_repository",
    });

    const outOfScope = makeFixture();
    git(outOfScope.root, "switch", "-c", "codex/out-of-scope-active");
    setBehavior(outOfScope, {
      activeTasks: [{ taskId: "TASK-ACTIVE", state: "in_progress" }],
      nextLegalTasks: [],
      mutation: null,
      race: null,
      compiledState: null,
      candidateBound: false,
    });
    write(outOfScope.root, "secrets/forbidden.txt", "forbidden\n");
    git(outOfScope.root, "add", "secrets/forbidden.txt");
    git(outOfScope.root, "commit", "-m", "add forbidden path");
    rmSync(path.join(outOfScope.root, "secrets/forbidden.txt"));
    git(outOfScope.root, "add", "-u", "secrets/forbidden.txt");
    git(outOfScope.root, "commit", "-m", "remove forbidden path");
    expect(git(outOfScope.root, "diff", "--name-only", "main..HEAD")).not.toContain("secrets/");
    const outOfScopeResult = runPreflight(outOfScope);
    expect(outOfScopeResult.json.blockers).toContainEqual({
      check: "branch_scope",
      code: "active_branch_out_of_scope",
    });
  }, 15_000);

  it("blocks when task-next active state disagrees with the compiled packet", () => {
    const fixture = makeFixture();
    git(fixture.root, "switch", "-c", "codex/active-state-drift");
    setBehavior(fixture, {
      activeTasks: [{ taskId: "TASK-ACTIVE", state: "review_pending" }],
      nextLegalTasks: [],
      mutation: null,
      race: null,
      compiledState: "in_progress",
    });
    const result = runPreflight(fixture);
    expect(result.status).toBe(2);
    expect(result.json.blockers).toContainEqual({
      check: "task_selection",
      code: "active_task_state_mismatch",
    });
  });

  it.each([
    ["no_legal_task", { activeTasks: [], nextLegalTasks: [], mutation: null, race: null }],
    [
      "multiple_next_legal_tasks",
      { activeTasks: [], nextLegalTasks: ["TASK-A", "TASK-B"], mutation: null, race: null },
    ],
    [
      "multiple_active_tasks",
      {
        activeTasks: [
          { taskId: "TASK-A", state: "in_progress" },
          { taskId: "TASK-B", state: "review_pending" },
        ],
        nextLegalTasks: [],
        mutation: null,
        race: null,
      },
    ],
  ])("blocks ambiguous selection: %s", (code, behavior) => {
    const fixture = makeFixture();
    setBehavior(fixture, behavior);
    const result = runPreflight(fixture);
    expect(result.status).toBe(2);
    expect(result.json.status).toBe("blocked");
    expect(result.json.blockers).toContainEqual({ check: "task_selection", code });
  });

  it("blocks dirty state and stale local remote-tracking state without repair", () => {
    const dirty = makeFixture();
    write(dirty.root, "WORKFLOW.md", "dirty\n");
    const dirtyResult = runPreflight(dirty);
    expect(dirtyResult.json.blockers).toContainEqual({
      check: "repository_clean",
      code: "dirty_repository",
    });

    const stale = makeFixture();
    const oldRemote = git(stale.root, "rev-parse", "HEAD");
    git(stale.root, "commit", "--allow-empty", "-m", "new local default");
    git(stale.root, "update-ref", "refs/remotes/origin/main", oldRemote);
    const staleResult = runPreflight(stale);
    expect(staleResult.json.blockers).toContainEqual({
      check: "branch_state",
      code: "stale_default_ref",
    });
  });

  it("rejects a clean-looking Git replacement ref before canonical reads", () => {
    const fixture = makeFixture();
    const originalHead = git(fixture.root, "rev-parse", "HEAD");
    write(fixture.root, "WORKFLOW.md", "# Replacement workflow\n");
    git(fixture.root, "add", "WORKFLOW.md");
    const replacementTree = git(fixture.root, "write-tree");
    git(fixture.root, "reset", "--hard", "HEAD");
    const replacementCommit = git(
      fixture.root,
      "commit-tree",
      replacementTree,
      "-m",
      "replacement fixture tree",
    );
    git(fixture.root, "replace", originalHead, replacementCommit);
    git(fixture.root, "reset", "--hard", "HEAD");

    expect(git(fixture.root, "status", "--short")).toBe("");
    expect(
      command(fixture.root, "git", ["status", "--short"], {
        env: { GIT_NO_REPLACE_OBJECTS: "1" },
      }).stdout.trim(),
    ).not.toBe("");

    const result = runPreflight(fixture);
    expect(result.status).toBe(2);
    expect(result.json.blockers).toContainEqual({
      check: "repository_refs",
      code: "git_replacement_refs_unsupported",
    });
  });

  it.each(["ignored", "tracked", "config", "ref", "index"])(
    "detects a malicious adapter %s mutation",
    (mutation) => {
      const fixture = makeFixture({ mutation });
      const result = runPreflight(fixture);
      expect(result.status).toBe(2);
      expect(result.json.blockers).toContainEqual({
        check: "mutation_check",
        code: "repository_mutated_during_preflight",
      });
    },
  );

  it("blocks a missing installed worker and never consults a Factory sibling", () => {
    const fixture = makeFixture();
    rmSync(path.join(fixture.skillsRoot, "code-review"), { recursive: true });
    const result = runPreflight(fixture);
    expect(result.status).toBe(2);
    expect(result.json.blockers).toContainEqual({
      check: "factory_packs",
      code: "missing_factory_pack",
    });
  });

  it.each([
    ["manifest", "task-executor/resources/portable-pack-manifest.json"],
    ["verifier", "task-executor/scripts/verify_portable_pack.py"],
    ["helper", "task-executor/resources/helper.txt"],
  ])("blocks a tampered installed %s", (_label, relative) => {
    const fixture = makeFixture();
    writeFileSync(path.join(fixture.skillsRoot, relative), "tampered\n", { flag: "a" });
    const result = runPreflight(fixture);
    expect(result.status).toBe(2);
    expect(result.json.blockers.some((blocker) => blocker.check === "factory_packs")).toBe(true);
  });

  it.each(["profile", "manifest", "verifier"])(
    "blocks an injected %s swap between authentication phases",
    (race) => {
      const fixture = makeFixture({ race });
      const result = runPreflight(fixture);
      expect(result.status).toBe(2);
      expect(
        result.json.blockers.some((blocker) =>
          race === "profile"
            ? blocker.check === "mutation_check"
            : blocker.check === "factory_packs",
        ),
      ).toBe(true);
    },
  );

  it("executes the authenticated verifier FD when its former pathname is replaced", () => {
    expect(portableFactoryPlatformSupported()).toBe(true);
    const sandbox = mkdtempSync(path.join(os.tmpdir(), "vetryn-fd-race-"));
    sandboxes.push(sandbox);
    const sentinel = path.join(sandbox, "named-snapshot-executed");
    const trusted = 'print("trusted-fd")\n';
    const replacement = `from pathlib import Path\nPath(${JSON.stringify(sentinel)}).write_text("executed")\nprint("replacement")\n`;
    const result = executeVerifiedSnapshot({
      python: "python3",
      verifierBytes: Buffer.from(trusted),
      verifierArgs: [],
      cwd: sandbox,
      afterUnlink(snapshot) {
        expect(existsSync(snapshot)).toBe(false);
        writeFileSync(snapshot, replacement);
      },
    });
    expect(result.stdout.trim()).toBe("trusted-fd");
    expect(existsSync(sentinel)).toBe(false);
  });

  it("emits a typed platform blocker before installed-pack IO", () => {
    const fixture = makeFixture();
    rmSync(fixture.skillsRoot, { recursive: true });
    const preload = path.join(fixture.sandbox, "force-unsupported-platform.mjs");
    writeFileSync(preload, 'Object.defineProperty(process, "platform", { value: "win32" });\n');
    const result = runPreflight(fixture, {}, ["--import", preload]);
    expect(result.status).toBe(2);
    expect(result.json.blockers).toEqual([{ check: "platform", code: "unsupported_platform" }]);
  });

  it("disables repository-local fsmonitor execution for every preflight Git read", () => {
    const fixture = makeFixture();
    const sentinel = path.join(fixture.sandbox, "fsmonitor-executed");
    const hook = path.join(fixture.root, ".fsmonitor-hook.sh");
    writeFileSync(hook, `#!/bin/sh\nprintf invoked > ${JSON.stringify(sentinel)}\nexit 0\n`);
    chmodSync(hook, 0o755);
    git(fixture.root, "config", "core.fsmonitor", hook);
    git(fixture.root, "update-ref", "refs/remotes/origin/main", "HEAD");
    const result = runPreflight(fixture);
    expect(result.status).toBe(2);
    expect(result.json.blockers).toContainEqual({
      check: "repository_clean",
      code: "dirty_repository",
    });
    expect(existsSync(sentinel)).toBe(false);
  });

  it("rejects symlinked profile and installed-pack ancestor directories", () => {
    const profileFixture = makeFixture();
    const externalFactory = path.join(profileFixture.sandbox, "external-profile");
    cpSync(path.join(profileFixture.root, ".factory"), externalFactory, { recursive: true });
    git(profileFixture.root, "update-index", "--assume-unchanged", ".factory/profile.yaml");
    git(profileFixture.root, "update-index", "--skip-worktree", ".factory/profile.yaml");
    writeFileSync(path.join(profileFixture.root, ".git", "info", "exclude"), ".factory\n", {
      flag: "a",
    });
    rmSync(path.join(profileFixture.root, ".factory"), { recursive: true });
    symlinkSync(externalFactory, path.join(profileFixture.root, ".factory"), "dir");
    const profileResult = runPreflight(profileFixture);
    expect(profileResult.status).toBe(2);
    expect(profileResult.json.blockers).toContainEqual({
      check: "profile",
      code: "symlinked_required_path",
    });

    const packFixture = makeFixture();
    const packResources = path.join(packFixture.sandbox, "external-pack-resources");
    const installedResources = path.join(packFixture.skillsRoot, "task-executor", "resources");
    cpSync(installedResources, packResources, { recursive: true });
    rmSync(installedResources, { recursive: true });
    symlinkSync(packResources, installedResources, "dir");
    const packResult = runPreflight(packFixture);
    expect(packResult.status).toBe(2);
    expect(packResult.json.blockers).toContainEqual({
      check: "factory_packs",
      code: "symlinked_required_path",
    });
  });

  it("blocks local profile pin rewriting even when Git status is intentionally hidden", () => {
    const fixture = makeFixture();
    git(fixture.root, "update-index", "--assume-unchanged", ".factory/profile.yaml");
    writeFileSync(path.join(fixture.root, ".factory/profile.yaml"), "# rewritten\n", { flag: "a" });
    const result = runPreflight(fixture);
    expect(result.status).toBe(2);
    expect(result.json.blockers).toContainEqual({
      check: "profile",
      code: "required_file_differs_from_head",
    });
  });

  it("contains no network, GitHub, package-install, or provider execution path", () => {
    const source = readFileSync(
      path.join(repositoryRoot, skillRef, "scripts/preflight.mjs"),
      "utf8",
    );
    expect(source).not.toMatch(
      /git\(root,\s*\[\s*["'](?:fetch|push|pull|clone|checkout|switch)["']/u,
    );
    expect(source).not.toMatch(/run\((?:"|')(?:curl|gh|npm|pnpm|npx)(?:"|')/u);
    expect(source).not.toMatch(
      /(?:from\s+|import\()\s*["'](?:openai|anthropic|openrouter|node:(?:http|https|net|tls|dns))/iu,
    );
  });
});

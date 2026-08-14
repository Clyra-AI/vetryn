#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

class PreflightBlock extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function defaultRun(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
}

function command(run, executable, args, cwd, code) {
  const result = run(executable, args, { cwd });
  if (result.status !== 0) throw new PreflightBlock(code);
  return result.stdout.trim();
}

function parseJson(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    throw new PreflightBlock(code);
  }
}

function snapshot(run, root) {
  return {
    head: command(run, "git", ["rev-parse", "HEAD"], root, "git_snapshot_failed"),
    status: command(
      run,
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      root,
      "git_snapshot_failed",
    ),
  };
}

function selectTask(next) {
  if (!Array.isArray(next.activeTasks) || !Array.isArray(next.nextLegalTasks))
    throw new PreflightBlock("invalid_task_next_output");
  const active = next.activeTasks;
  const legal = next.nextLegalTasks;
  if (active.length > 1) throw new PreflightBlock("ambiguous_active_tasks");
  if (active.length === 1) {
    const record = active[0];
    if (!record || typeof record.taskId !== "string" || typeof record.state !== "string")
      throw new PreflightBlock("invalid_active_task");
    return { source: "active", taskId: record.taskId, state: record.state };
  }
  if (legal.length === 0) throw new PreflightBlock("no_legal_task");
  if (legal.length > 1) throw new PreflightBlock("ambiguous_legal_tasks");
  if (typeof legal[0] !== "string") throw new PreflightBlock("invalid_legal_task");
  return { source: "next_legal", taskId: legal[0], state: null };
}

function routing(packet) {
  return {
    riskClass: packet.risk_class,
    allowedPaths: packet.allowed_paths,
    forbiddenPaths: packet.forbidden_paths,
    capabilities: packet.task?.capabilities ?? packet.task?.scope?.capabilities ?? null,
    validationCommands: packet.validation_commands,
    skills: {
      implementation: packet.execution?.implementSkill,
      verification: packet.execution?.verifySkill,
      promotion: packet.execution?.promoteSkill,
      factory: packet.required_worker_chain,
      domainReview: packet.required_domain_review_chain,
    },
    repositoryReviews: packet.requiredReviews,
    lifecycleGates: packet.lifecycle_gates,
    stopConditions: packet.stop_conditions,
  };
}

export function runPreflight({ cwd = process.cwd(), run = defaultRun } = {}) {
  let root;
  let before;
  let result;
  try {
    root = command(run, "git", ["rev-parse", "--show-toplevel"], cwd, "not_a_repository");
    before = snapshot(run, root);
    if (before.status !== "") throw new PreflightBlock("dirty_checkout");

    command(run, "pnpm", ["plan:check"], root, "plan_check_failed");
    const next = parseJson(
      command(run, "pnpm", ["--silent", "task:next"], root, "task_next_failed"),
      "invalid_task_next_output",
    );
    const selection = selectTask(next);
    const packet = parseJson(
      command(
        run,
        "pnpm",
        ["--silent", "task:compile", "--", selection.taskId],
        root,
        "task_compile_failed",
      ),
      "invalid_task_packet",
    );
    if (packet.task_id !== selection.taskId) throw new PreflightBlock("compiled_task_mismatch");
    if (typeof packet.currentState?.state !== "string")
      throw new PreflightBlock("invalid_task_packet");
    if (selection.source === "active" && packet.currentState.state !== selection.state)
      throw new PreflightBlock("active_state_mismatch");
    selection.state = packet.currentState.state;

    result = {
      schemaVersion: "1",
      status: "ready_for_authority",
      selection,
      packet: { id: packet.packetId, taskId: packet.task_id },
      routing: routing(packet),
      authority: {
        status: "explicit_current_run_grant_required",
        grants: [],
        nonWaivable: [
          "no_direct_main_push",
          "no_ambient_credentials",
          "privacy",
          "fail_closed",
          "provider_safety",
          "evidence_integrity",
        ],
      },
    };
  } catch (error) {
    result = {
      schemaVersion: "1",
      status: "blocked",
      blocker: error instanceof PreflightBlock ? error.code : "unexpected_preflight_failure",
    };
  } finally {
    if (root && before) {
      try {
        const after = snapshot(run, root);
        if (after.head !== before.head || after.status !== before.status) {
          result = {
            schemaVersion: "1",
            status: "blocked",
            blocker: "repository_changed_during_preflight",
          };
        }
      } catch {
        result = {
          schemaVersion: "1",
          status: "blocked",
          blocker: "git_snapshot_failed",
        };
      }
    }
  }
  return result;
}

function main() {
  const result = runPreflight();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "ready_for_authority") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

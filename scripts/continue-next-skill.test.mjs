import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  childEnvironment,
  runPreflight,
} from "../.agents/skills/vetryn-continue-next/scripts/preflight.mjs";

const root = "/arbitrary/vetryn-checkout";

function packet(taskId, state = "planned") {
  return {
    packetId: `oss-v1:${taskId}:r1`,
    task_id: taskId,
    risk_class: "high",
    currentState: { state },
    task: { capabilities: { network: false, credentials: false, provider: false } },
    allowed_paths: ["src/**"],
    forbidden_paths: ["secrets/**"],
    validation_commands: ["pnpm check"],
    required_worker_chain: ["task-executor", "validation-gate", "code-review", "commit-push"],
    required_domain_review_chain: [],
    requiredReviews: ["maintainer"],
    execution: {
      implementSkill: "vetryn-implement-task",
      verifySkill: "vetryn-verify-task",
      promoteSkill: "vetryn-promote-task",
    },
    lifecycle_gates: { local_validation_required: true, ci_required: true },
    stop_conditions: ["Stop on failure."],
  };
}

function fixture({
  next,
  compiled,
  dirty = false,
  fail = null,
  mutateHead = false,
  mutateStatus = false,
} = {}) {
  let headReads = 0;
  let statusReads = 0;
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    const key = [command, ...args].join(" ");
    if (key === fail) return { status: 1, stdout: "", stderr: "failed" };
    if (key === "git rev-parse --show-toplevel") return { status: 0, stdout: `${root}\n` };
    if (key === "git rev-parse HEAD") {
      headReads += 1;
      return {
        status: 0,
        stdout: `${mutateHead && headReads > 1 ? "changed" : "candidate"}\n`,
      };
    }
    if (key === "git status --porcelain=v1 --untracked-files=all") {
      statusReads += 1;
      return {
        status: 0,
        stdout: dirty || (mutateStatus && statusReads > 1) ? "?? draft.txt\n" : "",
      };
    }
    if (key === "pnpm plan:check") return { status: 0, stdout: "valid\n" };
    if (key === "pnpm --silent task:next") return { status: 0, stdout: JSON.stringify(next) };
    if (key.startsWith("pnpm --silent task:compile -- "))
      return { status: 0, stdout: JSON.stringify(compiled) };
    throw new Error(`unexpected command: ${key}`);
  };
  return { run, calls };
}

describe("vetryn-continue-next preflight", () => {
  it("binds repository adapters to the discovered checkout", () => {
    expect(childEnvironment(root, { VETRYN_PLAN_REPO_ROOT: "/other/repository" })).toMatchObject({
      VETRYN_PLAN_REPO_ROOT: root,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    });
  });

  it("selects one active task and reports packet-owned routing", () => {
    const taskId = "V1-42";
    const { run } = fixture({
      next: { activeTasks: [{ taskId, state: "in_progress" }], nextLegalTasks: ["V1-43"] },
      compiled: packet(taskId, "in_progress"),
    });
    const result = runPreflight({ cwd: "/different/path", run });
    expect(result).toMatchObject({
      status: "ready_for_authority",
      selection: { source: "active", taskId, state: "in_progress" },
      routing: {
        allowedPaths: ["src/**"],
        validationCommands: ["pnpm check"],
        skills: { factory: ["task-executor", "validation-gate", "code-review", "commit-push"] },
      },
      authority: { status: "explicit_current_run_grant_required", grants: [] },
    });
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it("selects one next-legal task when none is active", () => {
    const taskId = "V1-43";
    const { run } = fixture({
      next: { activeTasks: [], nextLegalTasks: [taskId] },
      compiled: packet(taskId),
    });
    expect(runPreflight({ run })).toMatchObject({
      status: "ready_for_authority",
      selection: { source: "next_legal", taskId, state: "planned" },
    });
  });

  it.each([
    [{ activeTasks: [], nextLegalTasks: [] }, "no_legal_task"],
    [{ activeTasks: [], nextLegalTasks: ["V1-43", "V1-44"] }, "ambiguous_legal_tasks"],
    [{ activeTasks: null, nextLegalTasks: ["V1-43"] }, "invalid_task_next_output"],
    [
      {
        activeTasks: [
          { taskId: "V1-42", state: "in_progress" },
          { taskId: "V1-43", state: "in_progress" },
        ],
        nextLegalTasks: [],
      },
      "ambiguous_active_tasks",
    ],
  ])("blocks empty or ambiguous selection", (next, blocker) => {
    const { run } = fixture({ next });
    expect(runPreflight({ run })).toEqual({ schemaVersion: "1", status: "blocked", blocker });
  });

  it("blocks a dirty checkout before repository commands", () => {
    const { run, calls } = fixture({ dirty: true });
    expect(runPreflight({ run })).toEqual({
      schemaVersion: "1",
      status: "blocked",
      blocker: "dirty_checkout",
    });
    expect(calls.some(([command]) => command === "pnpm")).toBe(false);
  });

  it("blocks repository command failure", () => {
    const { run } = fixture({ fail: "pnpm plan:check" });
    expect(runPreflight({ run })).toEqual({
      schemaVersion: "1",
      status: "blocked",
      blocker: "plan_check_failed",
    });
  });

  it("blocks when HEAD changes during preflight", () => {
    const taskId = "V1-43";
    const { run } = fixture({
      next: { activeTasks: [], nextLegalTasks: [taskId] },
      compiled: packet(taskId),
      mutateHead: true,
    });
    expect(runPreflight({ run })).toEqual({
      schemaVersion: "1",
      status: "blocked",
      blocker: "repository_changed_during_preflight",
    });
  });

  it("blocks when worktree status changes during preflight", () => {
    const taskId = "V1-43";
    const { run } = fixture({
      next: { activeTasks: [], nextLegalTasks: [taskId] },
      compiled: packet(taskId),
      mutateStatus: true,
    });
    expect(runPreflight({ run })).toEqual({
      schemaVersion: "1",
      status: "blocked",
      blocker: "repository_changed_during_preflight",
    });
  });

  it("contains no baked task, sibling checkout, network, or GitHub command", async () => {
    const source = await readFile(
      path.resolve(
        import.meta.dirname,
        "../.agents/skills/vetryn-continue-next/scripts/preflight.mjs",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/M0-11|\.\.\/factory|\bgh\b|\bcurl\b|\bfetch\s*\(/u);
  });

  it("assigns the protected land lifecycle to the promotion skill once", async () => {
    const instructions = await readFile(
      path.resolve(import.meta.dirname, "../.agents/skills/vetryn-continue-next/SKILL.md"),
      "utf8",
    );
    expect(instructions).toContain("single handoff to Factory `commit-push`");
    expect(instructions).toContain("do not invoke the land lifecycle a second time");
  });
});

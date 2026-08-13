#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  createReadStream,
  chmodSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

const WORKERS = ["task-executor", "validation-gate", "code-review", "commit-push"];
const LIFECYCLE_GATE_KEYS = [
  "local_validation_required",
  "ci_required",
  "code_review_required",
  "trust_review_required",
  "codex_review_required",
  "commit_push_required",
  "post_merge_monitor_required",
  "pr_lifecycle_report_required",
  "skip_policy",
];
export const PREFLIGHT_SCHEMA_VERSION = "1.0.0";
const ACTIVE_STATES = new Set([
  "in_progress",
  "verification_pending",
  "review_pending",
  "changes_requested",
]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SOURCE_REF_PATTERN = /^Clyra-AI\/factory@[0-9a-f]{40}$/u;
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
const ZERO_SOURCE_REF = `Clyra-AI/factory@${"0".repeat(40)}`;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const SAFE_ARGUMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:=-]*$/u;
const CANONICAL_RESUME_POLICY_PATHS = [
  ".factory/profile.yaml",
  "prettier.config.mjs",
  "product/plans/oss-v1/acceptance-ledger.json",
  "product/plans/oss-v1/plan.json",
  "product/plans/schemas",
  "scripts/plan.mjs",
  "scripts/semantic-risk.mjs",
  "scripts/task.mjs",
];
const REQUIRED_PROFILE_FIELDS = new Map([
  ["project", "nonempty_string"],
  ["product_name", "nonempty_string"],
  ["repo_root", "repo_root_dot"],
  ["default_branch", "nonempty_string"],
  ["maintainer_roster", "portable_path"],
  ["plan_root", "portable_path"],
  ["standards", "nonempty_map"],
  ["task_adapter.plan_script", "portable_path"],
  ["task_adapter.task_script", "portable_path"],
  ["task_adapter.plan_check_args", "nonempty_string_list"],
  ["task_adapter.next_args", "nonempty_string_list"],
  ["task_adapter.compile_args", "nonempty_string_list"],
  ["task_adapter.packet_schema", "portable_path"],
  ["skills", "nonempty_map"],
  ["implementation_risk.high_risk_change_classes", "nonempty_string_list"],
  ["implementation_risk.required_transition_classes", "nonempty_string_list"],
  ["code_review.review_modes", "nonempty_string_list"],
  ["code_review.baseline_commands", "nonempty_string_list"],
  ["code_review.command_anchors", "nonempty_string_list"],
  ["code_review.high_risk_surfaces", "nonempty_string_list"],
  ["code_review.severity_escalators", "nonempty_string_list"],
  ["commit_push.modes", "nonempty_string_list"],
  ["commit_push.default_remote", "nonempty_string"],
  ["commit_push.protected_branches", "nonempty_string_list"],
  ["commit_push.local_validation", "nonempty_string_list"],
  ["commit_push.command_anchors", "nonempty_string_list"],
  ["commit_push.required_pr_checks", "nonempty_string_list"],
  ["commit_push.optional_checks", "string_list"],
  ["commit_push.ci_timeout_minutes", "positive_integer"],
  ["commit_push.poll_seconds", "positive_integer"],
  ["commit_push.max_no_progress_cycles", "positive_integer"],
  ["commit_push.merge_strategy_order", "nonempty_string_list"],
  ["commit_push.submodule_policy.factory_path", "nonempty_string"],
  ["commit_push.submodule_policy.require_clean_submodules", "boolean"],
  ["commit_push.submodule_policy.require_factory_commit_first", "boolean"],
  ["commit_push.submodule_policy.allow_parent_pointer_update_after_factory_commit", "boolean"],
  ["commit_push.codex_review.enabled", "boolean"],
  ["commit_push.codex_review.reviewer_identity", "nonempty_string"],
  ["commit_push.codex_review.initial_wait_minutes", "positive_integer"],
  ["commit_push.codex_review.followup_wait_minutes", "positive_integer"],
  ["commit_push.codex_review.eyes_wait_minutes", "positive_integer"],
  ["commit_push.codex_review.poll_seconds", "positive_integer"],
  ["commit_push.codex_review.carry_forward_requires_prior_artifact", "boolean"],
  ["commit_push.codex_review.standalone_p2_exception.enabled", "boolean"],
  ["commit_push.codex_review.standalone_p2_exception.authorization", "nonempty_string"],
  ["commit_push.codex_review.standalone_p2_exception.max_findings", "positive_integer"],
  ["commit_push.codex_review.standalone_p2_exception.allowed_priorities", "nonempty_string_list"],
  ["commit_push.codex_review.standalone_p2_exception.require_current_head", "boolean"],
  ["commit_push.codex_review.standalone_p2_exception.require_green_ci", "boolean"],
  [
    "commit_push.codex_review.standalone_p2_exception.require_complete_current_head_inventory",
    "boolean",
  ],
  ["commit_push.codex_review.standalone_p2_exception.require_no_active_eyes", "boolean"],
  ["commit_push.codex_review.standalone_p2_exception.require_no_changes_requested", "boolean"],
  ["commit_push.codex_review.standalone_p2_exception.require_no_p0_p1", "boolean"],
  ["commit_push.codex_review.standalone_p2_exception.require_no_unclassified", "boolean"],
  [
    "commit_push.codex_review.standalone_p2_exception.forbidden_break_classes",
    "nonempty_string_list",
  ],
  ["commit_push.codex_review.standalone_p2_exception.evidence_ref_required", "boolean"],
  ["commit_push.post_merge.monitor_main", "boolean"],
  ["commit_push.post_merge.timeout_minutes", "positive_integer"],
  ["commit_push.post_merge.hotfix_enabled", "boolean"],
  ["commit_push.post_merge.max_hotfix_loops", "positive_integer"],
  ["commit_push.post_merge.hotfix_branch_pattern", "nonempty_string"],
  ["factory_worker_packs.contract_version", "contract_version"],
  ["factory_worker_packs.pack_set_version", "pack_set_version"],
  ["factory_worker_packs.source_ref", "factory_source_ref"],
  ["factory_worker_packs.manifest_sha256", "manifest_pin_map"],
]);

class PreflightBlock extends Error {
  constructor(code, check) {
    super(code);
    this.code = code;
    this.check = check;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestValue(value) {
  return digestBytes(canonicalJson(value));
}

function safeChildEnvironment(extra = {}) {
  const environment = {
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
    PYTHONDONTWRITEBYTECODE: "1",
    TZ: "UTC",
  };
  for (const key of ["PATHEXT", "SystemRoot", "TMP", "TEMP", "TMPDIR", "WINDIR"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return { ...environment, ...extra, GIT_NO_REPLACE_OBJECTS: "1" };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: safeChildEnvironment(options.env),
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.stdio,
  });
  const accepted = options.accepted ?? [0];
  if (result.error || !accepted.includes(result.status ?? -1)) {
    throw new PreflightBlock(options.errorCode ?? "command_failed", options.check ?? "commands");
  }
  return {
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

export function portableFactoryPlatformSupported(platform = process.platform) {
  if (platform !== "darwin" && platform !== "linux") return false;
  if (typeof fsConstants.O_DIRECTORY !== "number" || typeof fsConstants.O_NOFOLLOW !== "number") {
    return false;
  }
  try {
    return statSync("/dev/fd").isDirectory();
  } catch {
    return false;
  }
}

export function executeVerifiedSnapshot({ python, verifierBytes, verifierArgs, cwd, afterUnlink }) {
  if (!portableFactoryPlatformSupported()) {
    throw new PreflightBlock("unsupported_platform", "platform");
  }
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "vetryn-worker-verifier-"));
  chmodSync(temporaryRoot, 0o700);
  const snapshot = path.join(temporaryRoot, "verify_portable_pack.py");
  let descriptor;
  try {
    descriptor = openSync(
      snapshot,
      fsConstants.O_RDWR |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW |
        (fsConstants.O_CLOEXEC ?? 0),
      0o700,
    );
    fchmodSync(descriptor, 0o700);
    let offset = 0;
    while (offset < verifierBytes.length) {
      const written = writeSync(
        descriptor,
        verifierBytes,
        offset,
        verifierBytes.length - offset,
        offset,
      );
      if (written <= 0) throw new PreflightBlock("private_verifier_write_failed", "factory_packs");
      offset += written;
    }
    fsyncSync(descriptor);
    fchmodSync(descriptor, 0o500);
    const snapshotStat = fstatSync(descriptor);
    if (!snapshotStat.isFile() || snapshotStat.size !== verifierBytes.length) {
      throw new PreflightBlock("private_verifier_write_failed", "factory_packs");
    }
    unlinkSync(snapshot);
    const directoryDescriptor = openSync(
      temporaryRoot,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
    if (afterUnlink) afterUnlink(snapshot);
    const fdPath = `/dev/fd/${descriptor}`;
    try {
      accessSync(fdPath, fsConstants.R_OK);
    } catch {
      throw new PreflightBlock("verified_fd_execution_unsupported", "factory_packs");
    }
    const stdio = Array.from({ length: descriptor + 1 }, () => "ignore");
    stdio[1] = "pipe";
    stdio[2] = "pipe";
    stdio[descriptor] = descriptor;
    return run(python, ["-I", fdPath, ...verifierArgs], {
      cwd,
      errorCode: "verified_factory_pack_set_rejected",
      check: "factory_packs",
      stdio,
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function git(root, args, options = {}) {
  return run("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], {
    ...options,
    env: { GIT_OPTIONAL_LOCKS: "0", ...(options.env ?? {}) },
    errorCode: options.errorCode ?? "git_command_failed",
    check: options.check ?? "repository",
  });
}

function assertNoReplacementRefs(root) {
  const replacementRefs = git(root, ["for-each-ref", "--format=%(refname)", "refs/replace"], {
    check: "repository_refs",
  }).stdout.trim();
  if (replacementRefs) {
    throw new PreflightBlock("git_replacement_refs_unsupported", "repository_refs");
  }
}

function portablePath(value, code = "invalid_portable_path") {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw new PreflightBlock(code, "profile");
  }
  const pieces = value.split("/");
  if (pieces.some((piece) => !piece || piece === "." || piece === "..")) {
    throw new PreflightBlock(code, "profile");
  }
  return pieces;
}

function resolveInside(root, relative, check = "profile") {
  const pieces = portablePath(relative);
  const resolvedRoot = realpathSync(root);
  let current = resolvedRoot;
  for (const piece of pieces) {
    current = path.join(current, piece);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      throw new PreflightBlock("required_file_missing", check);
    }
    if (stat.isSymbolicLink()) throw new PreflightBlock("symlinked_required_path", check);
  }
  const resolved = realpathSync(current);
  const relativeResolved = path.relative(resolvedRoot, resolved);
  if (relativeResolved.startsWith("..") || path.isAbsolute(relativeResolved)) {
    throw new PreflightBlock("required_path_escape", check);
  }
  return current;
}

function sameFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function authenticatedFileBytes(root, relative, check = "profile") {
  const target = resolveInside(root, relative, check);
  let descriptor;
  try {
    descriptor = openSync(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new PreflightBlock("required_regular_file", check);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(before, after)) {
      throw new PreflightBlock("authenticated_file_drifted", check);
    }
    const resolvedAgain = resolveInside(root, relative, check);
    const pathStat = lstatSync(resolvedAgain, { bigint: true });
    if (!pathStat.isFile() || !sameFileIdentity(after, pathStat)) {
      throw new PreflightBlock("authenticated_file_drifted", check);
    }
    return bytes;
  } catch (error) {
    if (error instanceof PreflightBlock) throw error;
    throw new PreflightBlock("authenticated_file_unreadable", check);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function gitBlobBytes(root, objectRef, check) {
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", "-C", root, "show", objectRef], {
    cwd: root,
    encoding: null,
    env: safeChildEnvironment({ GIT_OPTIONAL_LOCKS: "0" }),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new PreflightBlock("required_file_missing_at_head", check);
  }
  return result.stdout;
}

function trackedHeadBytes(root, relative, check = "profile", requireEqual = true) {
  const bytes = authenticatedFileBytes(root, relative, check);
  git(root, ["ls-files", "--error-unmatch", "--", relative], {
    errorCode: "required_file_untracked",
    check,
  });
  const head = gitBlobBytes(root, `HEAD:${relative}`, check);
  if (requireEqual && !bytes.equals(head)) {
    throw new PreflightBlock("required_file_differs_from_head", check);
  }
  return bytes;
}

function nested(document, dottedPath) {
  let current = document;
  for (const component of dottedPath.split(".")) {
    if (
      !current ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !(component in current)
    ) {
      throw new PreflightBlock("incomplete_profile", "profile");
    }
    current = current[component];
  }
  return current;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTypedValue(value, policy) {
  if (policy === "nonempty_string") return typeof value === "string" && Boolean(value.trim());
  if (policy === "repo_root_dot") return value === ".";
  if (policy === "positive_integer") return Number.isSafeInteger(value) && value > 0;
  if (policy === "boolean") return typeof value === "boolean";
  if (policy === "nonempty_string_list") {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      new Set(value).size === value.length &&
      value.every((entry) => typeof entry === "string" && Boolean(entry.trim()))
    );
  }
  if (policy === "string_list") {
    return (
      Array.isArray(value) &&
      new Set(value).size === value.length &&
      value.every((entry) => typeof entry === "string" && Boolean(entry.trim()))
    );
  }
  if (policy === "nonempty_map") return isPlainObject(value) && Object.keys(value).length > 0;
  if (policy === "portable_path") {
    try {
      portablePath(value);
      return true;
    } catch {
      return false;
    }
  }
  if (policy === "contract_version") return value === "1";
  if (policy === "pack_set_version") return value === "1";
  if (policy === "factory_source_ref")
    return typeof value === "string" && SOURCE_REF_PATTERN.test(value) && value !== ZERO_SOURCE_REF;
  if (policy === "manifest_pin_map") {
    return (
      isPlainObject(value) &&
      isDeepStrictEqual(Object.keys(value).sort(), [...WORKERS].sort()) &&
      Object.values(value).every(
        (entry) => typeof entry === "string" && DIGEST_PATTERN.test(entry) && entry !== ZERO_DIGEST,
      )
    );
  }
  return false;
}

function parseProfile(root) {
  const profileRef = ".factory/profile.yaml";
  const bytes = trackedHeadBytes(root, profileRef, "profile");
  const document = parseDocument(bytes.toString("utf8"), {
    maxAliasCount: 0,
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new PreflightBlock("invalid_profile_yaml", "profile");
  }
  let profile;
  try {
    profile = document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new PreflightBlock("invalid_profile_yaml", "profile");
  }
  if (!isPlainObject(profile)) throw new PreflightBlock("invalid_profile", "profile");
  for (const [field, policy] of REQUIRED_PROFILE_FIELDS) {
    const value = nested(profile, field);
    if (!validTypedValue(value, policy)) {
      throw new PreflightBlock("invalid_profile_type", "profile");
    }
  }
  if (!SAFE_IDENTIFIER_PATTERN.test(profile.default_branch)) {
    throw new PreflightBlock("invalid_default_branch", "profile");
  }
  if (!SAFE_IDENTIFIER_PATTERN.test(profile.commit_push.default_remote)) {
    throw new PreflightBlock("invalid_default_remote", "profile");
  }
  if (!profile.commit_push.protected_branches.includes(profile.default_branch)) {
    throw new PreflightBlock("default_branch_not_protected", "profile");
  }
  for (const args of [
    profile.task_adapter.plan_check_args,
    profile.task_adapter.next_args,
    profile.task_adapter.compile_args,
  ]) {
    if (!args.every((argument) => SAFE_ARGUMENT_PATTERN.test(argument))) {
      throw new PreflightBlock("unsafe_adapter_argument", "profile");
    }
  }
  for (const reference of Object.values(profile.standards)) {
    if (typeof reference !== "string") throw new PreflightBlock("invalid_standard_ref", "profile");
    trackedHeadBytes(root, reference, "profile");
  }
  trackedHeadBytes(root, profile.maintainer_roster, "profile");
  trackedHeadBytes(root, profile.task_adapter.plan_script, "profile");
  trackedHeadBytes(root, profile.task_adapter.task_script, "profile");
  trackedHeadBytes(root, profile.task_adapter.packet_schema, "profile");
  for (const skillRef of Object.values(profile.skills)) {
    if (typeof skillRef !== "string") throw new PreflightBlock("invalid_skill_ref", "profile");
    trackedHeadBytes(root, skillRef, "profile");
  }
  return { bytes, profile, profileRef };
}

async function hashFileInto(hash, file) {
  for await (const chunk of createReadStream(file)) hash.update(chunk);
}

async function worktreeDigest(root) {
  const hash = createHash("sha256");
  async function walk(directory, prefix = "") {
    const names = readdirSync(directory).sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (relative === ".git") continue;
      const absolute = path.join(directory, name);
      const stat = lstatSync(absolute, { bigint: true });
      const kind = stat.isFile()
        ? "file"
        : stat.isDirectory()
          ? "directory"
          : stat.isSymbolicLink()
            ? "symlink"
            : "other";
      hash.update(`${kind}\0${relative}\0${stat.mode}\0${stat.size}\0${stat.mtimeNs}\0`);
      if (stat.isSymbolicLink()) hash.update(readlinkSync(absolute));
      if (stat.isFile()) await hashFileInto(hash, absolute);
      if (stat.isDirectory()) await walk(absolute, relative);
      hash.update("\0");
    }
  }
  await walk(root);
  return `sha256:${hash.digest("hex")}`;
}

function hashText(value) {
  return digestBytes(Buffer.from(value, "utf8"));
}

async function captureSnapshot(root) {
  const head = git(root, ["rev-parse", "--verify", "HEAD"], {
    errorCode: "missing_head",
    check: "repository_snapshot",
  }).stdout.trim();
  if (!SHA_PATTERN.test(head)) throw new PreflightBlock("invalid_head", "repository_snapshot");
  const branchResult = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    accepted: [0, 1],
    check: "repository_snapshot",
  });
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : null;
  const cleanStatus = git(root, ["status", "--porcelain=v2", "--untracked-files=all"], {
    check: "repository_snapshot",
  }).stdout;
  const components = {
    branch,
    config: hashText(
      git(root, ["config", "--local", "--null", "--list", "--show-origin"], {
        check: "repository_snapshot",
      }).stdout,
    ),
    head,
    index: hashText(
      git(root, ["ls-files", "--stage", "-z"], { check: "repository_snapshot" }).stdout +
        git(root, ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv"], {
          check: "repository_snapshot",
        }).stdout,
    ),
    refs: hashText(
      git(root, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)"], {
        check: "repository_snapshot",
      }).stdout,
    ),
    remotes: hashText(git(root, ["remote", "-v"], { check: "repository_snapshot" }).stdout),
    status: hashText(cleanStatus),
    statusIncludingIgnored: hashText(
      git(root, ["status", "--porcelain=v2", "--untracked-files=all", "--ignored=matching"], {
        check: "repository_snapshot",
      }).stdout,
    ),
    tree: await worktreeDigest(root),
  };
  return {
    branch,
    clean: cleanStatus.length === 0,
    digest: digestValue(components),
    head,
  };
}

function canonicalInputPaths(root, profile) {
  const paths = new Set([
    ".factory/profile.yaml",
    profile.maintainer_roster,
    profile.task_adapter.plan_script,
    profile.task_adapter.task_script,
    profile.task_adapter.packet_schema,
    ...Object.values(profile.standards),
    ...Object.values(profile.skills),
  ]);
  portablePath(profile.plan_root);
  const planPaths = git(root, ["ls-files", "-z", "--", profile.plan_root], {
    errorCode: "plan_root_unreadable",
    check: "canonical_inputs",
  })
    .stdout.split("\0")
    .filter(Boolean);
  if (planPaths.length === 0) throw new PreflightBlock("empty_plan_root", "canonical_inputs");
  for (const planPath of planPaths) paths.add(planPath);
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function canonicalInputsDigest(root, profile) {
  const hash = createHash("sha256");
  for (const relative of canonicalInputPaths(root, profile)) {
    const bytes = trackedHeadBytes(root, relative, "canonical_inputs");
    hash.update(`${relative}\0${bytes.length}\0`);
    hash.update(bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function resolveSkillsRoot() {
  const explicit = process.env.FACTORY_WORKER_SKILLS_ROOT;
  const candidate = explicit
    ? path.resolve(explicit)
    : process.env.CODEX_HOME
      ? path.resolve(process.env.CODEX_HOME, "skills")
      : path.resolve(os.homedir(), ".codex", "skills");
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch {
    throw new PreflightBlock("missing_factory_skills_root", "factory_packs");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PreflightBlock("invalid_factory_skills_root", "factory_packs");
  }
  return realpathSync(candidate);
}

function exactObjectKeys(value, expected) {
  return isPlainObject(value) && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function validateManifest(packRoot, worker, expectedDigest) {
  let packStat;
  try {
    packStat = lstatSync(packRoot);
  } catch {
    throw new PreflightBlock("missing_factory_pack", "factory_packs");
  }
  if (!packStat.isDirectory() || packStat.isSymbolicLink()) {
    throw new PreflightBlock("invalid_factory_pack", "factory_packs");
  }
  const manifestRef = "resources/portable-pack-manifest.json";
  const manifestBytes = authenticatedFileBytes(packRoot, manifestRef, "factory_packs");
  if (digestBytes(manifestBytes) !== expectedDigest) {
    throw new PreflightBlock("factory_manifest_pin_mismatch", "factory_packs");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new PreflightBlock("invalid_factory_manifest", "factory_packs");
  }
  if (
    !exactObjectKeys(manifest, ["manifest_version", "pack_set_version", "skill_id", "resources"]) ||
    manifest.manifest_version !== "1" ||
    manifest.pack_set_version !== "1" ||
    manifest.skill_id !== worker ||
    !Array.isArray(manifest.resources) ||
    manifest.resources.length === 0
  ) {
    throw new PreflightBlock("invalid_factory_manifest", "factory_packs");
  }
  const listed = new Set();
  const resourceDigests = {};
  let verifierBytes = null;
  for (const resource of manifest.resources) {
    if (
      !exactObjectKeys(resource, ["path", "sha256"]) ||
      typeof resource.path !== "string" ||
      typeof resource.sha256 !== "string" ||
      !DIGEST_PATTERN.test(resource.sha256) ||
      listed.has(resource.path)
    ) {
      throw new PreflightBlock("invalid_factory_manifest", "factory_packs");
    }
    listed.add(resource.path);
    const bytes = authenticatedFileBytes(packRoot, resource.path, "factory_packs");
    const actualDigest = digestBytes(bytes);
    if (actualDigest !== resource.sha256) {
      throw new PreflightBlock("factory_resource_digest_mismatch", "factory_packs");
    }
    resourceDigests[resource.path] = actualDigest;
    if (resource.path === "scripts/verify_portable_pack.py") verifierBytes = bytes;
  }
  const required = [
    "SKILL.md",
    "agents/openai.yaml",
    "resources/profile-requirements.json",
    "scripts/verify_portable_pack.py",
  ];
  if (!required.every((entry) => listed.has(entry)) || !verifierBytes) {
    throw new PreflightBlock("incomplete_factory_manifest", "factory_packs");
  }
  const actualFiles = [];
  function walk(directory, prefix = "") {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const target = path.join(directory, name);
      const targetStat = lstatSync(target);
      if (targetStat.isSymbolicLink() || (!targetStat.isDirectory() && !targetStat.isFile())) {
        throw new PreflightBlock("unmanifested_factory_resource", "factory_packs");
      }
      if (targetStat.isDirectory()) walk(target, relative);
      if (targetStat.isFile()) actualFiles.push(relative);
    }
  }
  walk(packRoot);
  const expectedFiles = [...listed, "resources/portable-pack-manifest.json"].sort((left, right) =>
    left.localeCompare(right),
  );
  if (!isDeepStrictEqual(actualFiles, expectedFiles)) {
    throw new PreflightBlock("unmanifested_factory_resource", "factory_packs");
  }
  return {
    manifestDigest: expectedDigest,
    snapshotDigest: digestValue({ manifest: expectedDigest, resources: resourceDigests }),
    verifierBytes,
  };
}

function resolveExecutable(name) {
  if (path.isAbsolute(name)) {
    try {
      const candidate = realpathSync(name);
      if (lstatSync(candidate).isFile()) {
        accessSync(candidate, fsConstants.X_OK);
        return candidate;
      }
    } catch {
      return null;
    }
  }
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, name);
    try {
      const resolved = realpathSync(candidate);
      if (lstatSync(resolved).isFile()) {
        accessSync(resolved, fsConstants.X_OK);
        return resolved;
      }
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
}

function verifyFactoryPacks(root, profile) {
  const skillsRoot = resolveSkillsRoot();
  const pins = profile.factory_worker_packs.manifest_sha256;
  const manifests = {};
  const packSnapshots = {};
  let verifierBytes = null;
  for (const worker of WORKERS) {
    const result = validateManifest(path.join(skillsRoot, worker), worker, pins[worker]);
    manifests[worker] = result.manifestDigest;
    packSnapshots[worker] = result.snapshotDigest;
    if (worker === "task-executor") verifierBytes = result.verifierBytes;
  }
  const python = resolveExecutable("python3");
  if (!python || !verifierBytes)
    throw new PreflightBlock("missing_verified_factory_runtime", "factory_packs");
  const verifierArgs = [
    "verify-set",
    "--skills-root",
    skillsRoot,
    "--repo-root",
    root,
    "--profile",
    path.join(root, ".factory", "profile.yaml"),
    "--require",
    WORKERS.join(","),
    "--json",
  ];
  const runVerifiedSnapshot = () =>
    executeVerifiedSnapshot({ python, verifierBytes, verifierArgs, cwd: root });
  const results = [runVerifiedSnapshot(), runVerifiedSnapshot()];
  if (!isDeepStrictEqual(results[0], results[1])) {
    throw new PreflightBlock("nondeterministic_factory_verifier", "factory_packs");
  }
  let payload;
  try {
    payload = JSON.parse(results[0].stdout);
  } catch {
    throw new PreflightBlock("invalid_factory_verifier_output", "factory_packs");
  }
  const expected = {
    manifest_digests: manifests,
    pack_set_version: "1",
    profile: ".factory/profile.yaml",
    skills: WORKERS,
    source_ref: profile.factory_worker_packs.source_ref,
    status: "verified",
  };
  if (!isDeepStrictEqual(payload, expected)) {
    throw new PreflightBlock("factory_verifier_output_mismatch", "factory_packs");
  }
  try {
    for (const worker of WORKERS) {
      const after = validateManifest(path.join(skillsRoot, worker), worker, pins[worker]);
      if (after.snapshotDigest !== packSnapshots[worker]) {
        throw new PreflightBlock("factory_packs_drifted", "factory_packs");
      }
    }
  } catch (error) {
    if (error instanceof PreflightBlock && error.code === "factory_packs_drifted") throw error;
    throw new PreflightBlock("factory_packs_drifted", "factory_packs");
  }
  return {
    contractVersion: "1",
    manifestDigests: manifests,
    packSetVersion: "1",
    sourceRef: profile.factory_worker_packs.source_ref,
  };
}

function runNodeTwice(root, scriptRef, args, check) {
  const script = resolveInside(root, scriptRef, check);
  const options = {
    cwd: root,
    env: { VETRYN_PLAN_REPO_ROOT: root },
    errorCode: `${check}_failed`,
    check,
  };
  const first = run(process.execPath, [script, ...args], options);
  const second = run(process.execPath, [script, ...args], options);
  if (!isDeepStrictEqual(first, second)) {
    throw new PreflightBlock(`${check}_nondeterministic`, check);
  }
  return first;
}

function parseJsonOutput(result, check) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new PreflightBlock(`${check}_invalid_json`, check);
  }
}

function deriveTask(root, profile) {
  runNodeTwice(
    root,
    profile.task_adapter.plan_script,
    profile.task_adapter.plan_check_args,
    "plan_check",
  );
  const next = parseJsonOutput(
    runNodeTwice(
      root,
      profile.task_adapter.task_script,
      profile.task_adapter.next_args,
      "task_next",
    ),
    "task_next",
  );
  if (
    !exactObjectKeys(next, ["planId", "activeTasks", "nextLegalTasks", "blockedTasks"]) ||
    typeof next.planId !== "string" ||
    !Array.isArray(next.activeTasks) ||
    !Array.isArray(next.nextLegalTasks) ||
    !Array.isArray(next.blockedTasks) ||
    !next.activeTasks.every(
      (record) =>
        exactObjectKeys(record, ["taskId", "state"]) &&
        typeof record.taskId === "string" &&
        Boolean(record.taskId) &&
        ACTIVE_STATES.has(record.state),
    ) ||
    ![...next.nextLegalTasks, ...next.blockedTasks].every(
      (taskId) => typeof taskId === "string" && Boolean(taskId),
    ) ||
    new Set(next.activeTasks.map((record) => record.taskId)).size !== next.activeTasks.length
  ) {
    throw new PreflightBlock("invalid_task_selection_output", "task_selection");
  }
  let taskId;
  let source;
  if (next.activeTasks.length > 1)
    throw new PreflightBlock("multiple_active_tasks", "task_selection");
  if (next.activeTasks.length === 1) {
    taskId = next.activeTasks[0].taskId;
    source = "active";
  } else {
    if (next.nextLegalTasks.length === 0)
      throw new PreflightBlock("no_legal_task", "task_selection");
    if (next.nextLegalTasks.length > 1) {
      throw new PreflightBlock("multiple_next_legal_tasks", "task_selection");
    }
    [taskId] = next.nextLegalTasks;
    source = "next_legal";
  }
  const compile = parseJsonOutput(
    runNodeTwice(
      root,
      profile.task_adapter.task_script,
      [...profile.task_adapter.compile_args, taskId],
      "task_compile",
    ),
    "task_compile",
  );
  validatePacket(compile, taskId, source, next.activeTasks[0]?.state ?? null);
  return { packet: compile, source, taskId };
}

function uniqueStringArray(value) {
  return (
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every((entry) => typeof entry === "string" && Boolean(entry))
  );
}

function capabilities(value) {
  return (
    exactObjectKeys(value, ["network", "credentials", "provider", "githubWrite"]) &&
    Object.values(value).every((entry) => typeof entry === "boolean")
  );
}

function validatePacket(packet, taskId, source, selectedActiveState) {
  if (
    !isPlainObject(packet) ||
    packet.task_id !== taskId ||
    typeof packet.packetId !== "string" ||
    !["low", "medium", "high"].includes(packet.risk_class) ||
    !uniqueStringArray(packet.allowed_paths) ||
    !uniqueStringArray(packet.forbidden_paths) ||
    !uniqueStringArray(packet.validation_commands) ||
    !uniqueStringArray(packet.final_validation_commands) ||
    !uniqueStringArray(packet.required_worker_chain) ||
    !uniqueStringArray(packet.required_domain_review_chain) ||
    !uniqueStringArray(packet.requiredReviews) ||
    !exactObjectKeys(packet.lifecycle_gates, LIFECYCLE_GATE_KEYS) ||
    !LIFECYCLE_GATE_KEYS.filter((key) => key !== "skip_policy").every(
      (key) => typeof packet.lifecycle_gates[key] === "boolean",
    ) ||
    packet.lifecycle_gates.skip_policy !== "approved_exception_required" ||
    !capabilities(packet.task?.capabilities) ||
    !isPlainObject(packet.execution) ||
    typeof packet.execution.implementSkill !== "string" ||
    typeof packet.execution.verifySkill !== "string" ||
    typeof packet.execution.promoteSkill !== "string" ||
    typeof packet.execution.maintainerApprovalRequired !== "boolean" ||
    typeof packet.execution.progressIsGenerated !== "boolean" ||
    typeof packet.execution.executorMayAccept !== "boolean" ||
    !isPlainObject(packet.execution.deliveryPermissions) ||
    typeof packet.execution.deliveryPermissions.mode !== "string" ||
    !isPlainObject(packet.currentState) ||
    typeof packet.currentState.state !== "string"
  ) {
    throw new PreflightBlock("invalid_compiled_packet", "task_compile");
  }
  if (
    source === "active" &&
    (!ACTIVE_STATES.has(packet.currentState.state) ||
      packet.currentState.state !== selectedActiveState)
  ) {
    throw new PreflightBlock("active_task_state_mismatch", "task_selection");
  }
  if (source === "next_legal" && !["planned", "ready"].includes(packet.currentState.state)) {
    throw new PreflightBlock("next_task_state_mismatch", "task_selection");
  }
  if (
    !isDeepStrictEqual(packet.required_worker_chain, WORKERS) ||
    !isDeepStrictEqual(packet.execution.factorySkills, WORKERS)
  ) {
    throw new PreflightBlock("worker_chain_mismatch", "task_compile");
  }
}

function parseSkillName(bytes) {
  const text = bytes.toString("utf8");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text);
  if (!match) throw new PreflightBlock("invalid_repository_skill", "skills");
  const document = parseDocument(match[1], {
    maxAliasCount: 0,
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new PreflightBlock("invalid_repository_skill", "skills");
  }
  const frontmatter = document.toJS({ maxAliasCount: 0 });
  if (!isPlainObject(frontmatter) || typeof frontmatter.name !== "string") {
    throw new PreflightBlock("invalid_repository_skill", "skills");
  }
  return frontmatter.name;
}

function resolveRepositorySkills(root, profile, packet) {
  const byName = new Map();
  for (const skillRef of Object.values(profile.skills)) {
    const bytes = trackedHeadBytes(root, skillRef, "skills");
    const name = parseSkillName(bytes);
    if (byName.has(name)) throw new PreflightBlock("duplicate_repository_skill", "skills");
    byName.set(name, skillRef);
  }
  const required = [
    "vetryn-continue-next",
    packet.execution.implementSkill,
    packet.execution.verifySkill,
    packet.execution.promoteSkill,
    ...packet.required_domain_review_chain,
  ];
  for (const name of required) {
    if (!byName.has(name)) throw new PreflightBlock("missing_repository_skill", "skills");
  }
  return [...new Set(required)];
}

function commandScriptName(command) {
  if (typeof command !== "string" || /[;&|><`\n\r]/u.test(command)) {
    throw new PreflightBlock("unsafe_validation_command", "commands");
  }
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu) ?? [];
  if (tokens.length === 0 || !tokens.every((token) => !token.includes("$"))) {
    throw new PreflightBlock("unsafe_validation_command", "commands");
  }
  if (tokens[0] === "node") return { executable: "node", script: null };
  if (tokens[0] !== "pnpm") throw new PreflightBlock("unsupported_validation_command", "commands");
  let index = 1;
  while (index < tokens.length && tokens[index].startsWith("-")) index += 1;
  if (index >= tokens.length) throw new PreflightBlock("invalid_validation_command", "commands");
  return { executable: "pnpm", script: tokens[index].replace(/^['"]|['"]$/gu, "") };
}

function resolveCommands(root, packet) {
  const packageJson = JSON.parse(
    trackedHeadBytes(root, "package.json", "commands").toString("utf8"),
  );
  if (!isPlainObject(packageJson.scripts))
    throw new PreflightBlock("missing_package_scripts", "commands");
  const allCommands = [
    ...(packet.baseline_commands ?? []),
    ...(packet.red_first_commands ?? []),
    ...packet.validation_commands,
    ...packet.final_validation_commands,
  ];
  if (!uniqueStringArray([...new Set(allCommands)])) {
    throw new PreflightBlock("invalid_validation_commands", "commands");
  }
  for (const command of allCommands) {
    const parsed = commandScriptName(command);
    if (parsed.executable === "pnpm" && typeof packageJson.scripts[parsed.script] !== "string") {
      throw new PreflightBlock("missing_package_script", "commands");
    }
    if (parsed.executable === "node" && !resolveExecutable(process.execPath)) {
      throw new PreflightBlock("missing_command_runtime", "commands");
    }
  }
  if (!resolveExecutable("pnpm")) throw new PreflightBlock("missing_command_runtime", "commands");
}

function pathMatchesScopePattern(candidate, pattern) {
  if (pattern === "**") return true;
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  }
  return candidate === pattern;
}

function assertActiveBranchScope(root, base, head, packet) {
  const commits = git(root, ["rev-list", "--reverse", "--topo-order", `${base}..${head}`], {
    check: "branch_scope",
  })
    .stdout.split("\n")
    .filter(Boolean);
  const changedPaths = new Set();
  for (const commit of commits) {
    if (!SHA_PATTERN.test(commit))
      throw new PreflightBlock("invalid_branch_history", "branch_scope");
    const [resolvedCommit, firstParent] = git(root, ["rev-list", "--parents", "-n", "1", commit], {
      check: "branch_scope",
    })
      .stdout.trim()
      .split(" ");
    if (resolvedCommit !== commit || !firstParent || !SHA_PATTERN.test(firstParent)) {
      throw new PreflightBlock("invalid_branch_history", "branch_scope");
    }
    for (const changedPath of git(
      root,
      [
        "diff",
        "--name-only",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        `${firstParent}..${commit}`,
        "--",
      ],
      { check: "branch_scope" },
    )
      .stdout.split("\0")
      .filter(Boolean)) {
      changedPaths.add(changedPath);
    }
  }
  if (
    [...changedPaths].some(
      (changedPath) =>
        packet.forbidden_paths.some((pattern) => pathMatchesScopePattern(changedPath, pattern)) ||
        !packet.allowed_paths.some((pattern) => pathMatchesScopePattern(changedPath, pattern)),
    )
  ) {
    throw new PreflightBlock("active_branch_out_of_scope", "branch_scope");
  }
}

function resolveCanonicalDefault(root, profile) {
  const localRef = `refs/heads/${profile.default_branch}`;
  const remoteRef = `refs/remotes/${profile.commit_push.default_remote}/${profile.default_branch}`;
  const local = git(root, ["rev-parse", "--verify", localRef], {
    errorCode: "missing_local_default_ref",
    check: "branch_state",
  }).stdout.trim();
  const remote = git(root, ["rev-parse", "--verify", remoteRef], {
    errorCode: "missing_remote_tracking_default_ref",
    check: "branch_state",
  }).stdout.trim();
  if (!SHA_PATTERN.test(local) || !SHA_PATTERN.test(remote) || local !== remote) {
    throw new PreflightBlock("stale_default_ref", "branch_state");
  }
  return local;
}

function assertCanonicalResumePolicy(root, snapshot, canonicalDefault) {
  if (!snapshot.branch || snapshot.branch === null) return;
  const comparison = git(
    root,
    [
      "diff",
      "--quiet",
      "--no-ext-diff",
      "--no-textconv",
      `${canonicalDefault}..${snapshot.head}`,
      "--",
      ...CANONICAL_RESUME_POLICY_PATHS,
    ],
    { accepted: [0, 1], check: "canonical_policy" },
  );
  if (comparison.status === 1) {
    throw new PreflightBlock("branch_policy_inputs_not_canonical", "canonical_policy");
  }
}

function assertBranchState(root, profile, snapshot, derived, canonicalDefault) {
  if (derived.source === "next_legal") {
    if (snapshot.branch !== profile.default_branch || snapshot.head !== canonicalDefault) {
      throw new PreflightBlock("next_task_requires_default_branch", "branch_state");
    }
    return "start";
  }
  if (!snapshot.branch || snapshot.branch === profile.default_branch) {
    throw new PreflightBlock("active_task_requires_candidate_branch", "branch_state");
  }
  if (
    derived.packet.currentState.state !== "in_progress" ||
    derived.packet.currentState.candidate
  ) {
    throw new PreflightBlock("frozen_candidate_resume_unsupported", "branch_state");
  }
  git(root, ["merge-base", "--is-ancestor", canonicalDefault, snapshot.head], {
    errorCode: "active_branch_not_default_descendant",
    check: "branch_state",
  });
  assertActiveBranchScope(root, canonicalDefault, snapshot.head, derived.packet);
  return "resume";
}

function resultTemplate() {
  return {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    status: "blocked",
    mode: null,
    repository: {
      head: null,
      currentBranch: null,
      defaultBranch: null,
      defaultRemote: null,
      clean: false,
      snapshotDigest: null,
      canonicalInputsDigest: null,
      remoteFreshness: "not_checked_offline",
    },
    selection: null,
    packet: null,
    resolved: {
      capabilities: { network: false, credentials: false, provider: false, githubWrite: false },
      repositorySkills: [],
      factorySkills: [],
      domainReviews: [],
      requiredReviews: [],
      lifecycleGates: {
        localValidationRequired: false,
        ciRequired: false,
        codeReviewRequired: false,
        trustReviewRequired: false,
        codexReviewRequired: false,
        commitPushRequired: false,
        postMergeMonitorRequired: false,
        prLifecycleReportRequired: false,
        skipPolicy: "approved_exception_required",
      },
      promotion: { maintainerRequired: false, progressGenerated: false, executorMayAccept: false },
      delivery: { mode: "unresolved", directDefaultPush: false, automaticMerge: false },
      factoryPacks: null,
    },
    authority: {
      status: "required_before_mutation",
      currentRunGrantPresent: false,
      effectiveCapabilities: {
        network: false,
        credentials: false,
        provider: false,
        githubWrite: false,
      },
      acceptedSource: "authenticated_listed_maintainer_current_run",
      rejectedSources: [
        "ambient_credentials",
        "chat_history",
        "codeowners",
        "maintainer_roster_membership",
        "self_asserted_identity",
        "skill_invocation",
      ],
    },
    checks: [],
    blockers: [],
  };
}

function addCheck(result, id, status, detail) {
  const existing = result.checks.findIndex((check) => check.id === id);
  const value = { id, status, detail };
  if (existing === -1) result.checks.push(value);
  else result.checks[existing] = value;
}

function addBlocker(result, error) {
  if (
    !result.blockers.some((blocker) => blocker.code === error.code && blocker.check === error.check)
  ) {
    result.blockers.push({ code: error.code, check: error.check });
  }
  addCheck(result, error.check, "fail", error.code);
  result.status = "blocked";
}

function packetSummary(packet) {
  return {
    packetId: packet.packetId,
    digest: digestValue(packet),
    riskClass: packet.risk_class,
    allowedPaths: packet.allowed_paths,
    forbiddenPaths: packet.forbidden_paths,
    validationCommands: packet.validation_commands,
    finalValidationCommands: packet.final_validation_commands,
  };
}

function lifecycleSummary(gates) {
  return {
    localValidationRequired: gates.local_validation_required === true,
    ciRequired: gates.ci_required === true,
    codeReviewRequired: gates.code_review_required === true,
    trustReviewRequired: gates.trust_review_required === true,
    codexReviewRequired: gates.codex_review_required === true,
    commitPushRequired: gates.commit_push_required === true,
    postMergeMonitorRequired: gates.post_merge_monitor_required === true,
    prLifecycleReportRequired: gates.pr_lifecycle_report_required === true,
    skipPolicy: gates.skip_policy,
  };
}

async function preflight({ workerPacksOnly = false } = {}) {
  const result = resultTemplate();
  if (!portableFactoryPlatformSupported()) {
    addBlocker(result, new PreflightBlock("unsupported_platform", "platform"));
    return result;
  }
  let root = null;
  let before = null;
  let profileData = null;
  try {
    const rootResult = run("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      errorCode: "git_repository_required",
      check: "repository",
    });
    root = realpathSync(rootResult.stdout.trim());
    assertNoReplacementRefs(root);
    before = await captureSnapshot(root);
    result.repository.head = before.head;
    result.repository.currentBranch = before.branch;
    result.repository.clean = before.clean;
    result.repository.snapshotDigest = before.digest;
    addCheck(result, "repository_snapshot", "pass", "snapshot_captured");
    if (!before.clean) throw new PreflightBlock("dirty_repository", "repository_clean");
    addCheck(result, "repository_clean", "pass", "repository_clean");

    profileData = parseProfile(root);
    const { profile } = profileData;
    result.repository.defaultBranch = profile.default_branch;
    result.repository.defaultRemote = profile.commit_push.default_remote;
    result.repository.canonicalInputsDigest = canonicalInputsDigest(root, profile);
    addCheck(result, "profile", "pass", "profile_authenticated");
    addCheck(result, "canonical_inputs", "pass", "canonical_inputs_authenticated");

    const canonicalDefault = resolveCanonicalDefault(root, profile);
    assertCanonicalResumePolicy(root, before, canonicalDefault);
    addCheck(result, "canonical_policy", "pass", "canonical_policy_authenticated");

    result.resolved.factoryPacks = verifyFactoryPacks(root, profile);
    addCheck(result, "factory_packs", "pass", "factory_packs_authenticated");

    if (workerPacksOnly) {
      result.mode = "worker_reauthentication";
      addCheck(result, "worker_invocation", "pass", "factory_packs_ready_for_invocation");
    } else {
      const derived = deriveTask(root, profile);
      result.selection = {
        taskId: derived.taskId,
        source: derived.source,
        state: derived.packet.currentState.state,
      };
      result.packet = packetSummary(derived.packet);
      addCheck(result, "plan_check", "pass", "plan_check_deterministic");
      addCheck(result, "task_next", "pass", "task_next_deterministic");
      addCheck(result, "task_selection", "pass", "sole_task_selected");
      addCheck(result, "task_compile", "pass", "task_packet_deterministic");

      result.resolved.repositorySkills = resolveRepositorySkills(root, profile, derived.packet);
      result.resolved.factorySkills = derived.packet.required_worker_chain;
      result.resolved.domainReviews = derived.packet.required_domain_review_chain;
      result.resolved.requiredReviews = derived.packet.requiredReviews;
      result.resolved.capabilities = derived.packet.task.capabilities;
      result.resolved.lifecycleGates = lifecycleSummary(derived.packet.lifecycle_gates);
      result.resolved.promotion = {
        maintainerRequired: derived.packet.execution.maintainerApprovalRequired,
        progressGenerated: derived.packet.execution.progressIsGenerated,
        executorMayAccept: derived.packet.execution.executorMayAccept,
      };
      result.resolved.delivery = {
        mode: derived.packet.execution.deliveryPermissions.mode,
        directDefaultPush: false,
        automaticMerge: false,
      };
      addCheck(result, "skills", "pass", "required_skills_resolved");

      resolveCommands(root, derived.packet);
      addCheck(result, "commands", "pass", "required_commands_resolved");
      result.mode = assertBranchState(root, profile, before, derived, canonicalDefault);
      addCheck(result, "branch_state", "pass", "branch_state_current");
    }
  } catch (error) {
    addBlocker(
      result,
      error instanceof PreflightBlock
        ? error
        : new PreflightBlock("unexpected_preflight_failure", "preflight"),
    );
  }

  if (root && before) {
    try {
      const after = await captureSnapshot(root);
      if (!isDeepStrictEqual(before, after)) {
        addBlocker(
          result,
          new PreflightBlock("repository_mutated_during_preflight", "mutation_check"),
        );
      } else {
        addCheck(result, "mutation_check", "pass", "repository_unchanged");
      }
      if (profileData) {
        const afterCanonical = canonicalInputsDigest(root, profileData.profile);
        if (afterCanonical !== result.repository.canonicalInputsDigest) {
          addBlocker(result, new PreflightBlock("canonical_inputs_drifted", "mutation_check"));
        }
      }
    } catch {
      addBlocker(result, new PreflightBlock("repository_snapshot_failed", "mutation_check"));
    }
  }

  if (result.blockers.length === 0) {
    result.status = workerPacksOnly ? "workers_authenticated" : "ready_for_authority";
    addCheck(result, "authority", "not_checked", "current_run_authority_required");
  }
  result.checks.sort((left, right) => left.id.localeCompare(right.id));
  result.blockers.sort((left, right) =>
    `${left.check}:${left.code}`.localeCompare(`${right.check}:${right.code}`),
  );
  return result;
}

function validateOutput(result) {
  const schemaPath = path.resolve(
    import.meta.dirname,
    "..",
    "references",
    "preflight-result.schema.json",
  );
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
  const validate = ajv.compile(schema);
  if (!validate(result)) throw new Error("internal_preflight_schema_failure");
}

function isDirectInvocation() {
  try {
    return Boolean(
      process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename),
    );
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  const argumentsAfterScript = process.argv.slice(2);
  const workerPacksOnly =
    argumentsAfterScript.length === 1 && argumentsAfterScript[0] === "--worker-packs-only";
  const result =
    argumentsAfterScript.length === 0 || workerPacksOnly
      ? await preflight({ workerPacksOnly })
      : (() => {
          const invalid = resultTemplate();
          addBlocker(invalid, new PreflightBlock("invalid_preflight_arguments", "preflight"));
          return invalid;
        })();
  validateOutput(result);
  process.stdout.write(`${canonicalJson(result)}\n`);
  process.exitCode = ["ready_for_authority", "workers_authenticated"].includes(result.status)
    ? 0
    : 2;
}

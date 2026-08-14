#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, rename, rmdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import { Command } from "commander";
import { scanTypeScript, type ScanFinding, type ScannerReasonCode } from "@vetryn/typescript";
import {
  canonicalizeArtifact,
  initializeCallSiteManifest,
  parseCallSite,
  parseCallSiteManifest,
  parseCatalogSnapshot,
  type CallSiteManifest,
} from "@vetryn/core";
import {
  FileCatalogStore,
  createCurrentCatalogRefresh,
  createOpenRouterEvaluationTransport,
  refreshOpenRouterCatalog,
  resolveCandidates,
  type CandidateShortlist,
  type CurrentCatalogRefresh,
  type EvaluationClock,
  type EvaluationTransport,
  type RefreshCatalogResult,
} from "@vetryn/openrouter";

import { evaluateFiles } from "./evaluation-files.js";
import { FileExecutionReceiptStore } from "./evidence-store.js";

export { FileExecutionReceiptStore };
export { evaluateFiles } from "./evaluation-files.js";

export const VERSION = "0.0.0";
const MAX_REPOSITORY_INPUT_BYTES = 20_000_000;
const ignoredPathNames = new Set([".artifacts", ".git", "coverage", "dist", "node_modules"]);

export interface Diagnostics {
  architecture: string;
  node: string;
  platform: NodeJS.Platform;
  version: string;
}

export interface ManifestInitOptions {
  readonly callSitePath: string;
  readonly dryRun?: boolean;
  readonly manifestId?: string;
  readonly manifestPath: string;
}

export interface ManifestInitResult {
  readonly callSiteId: string;
  readonly changed: boolean;
  readonly manifest: CallSiteManifest;
  readonly wouldChange: boolean;
}

export interface ScanRepositoryOptions {
  readonly paths?: readonly string[];
  readonly repositoryRoot?: string;
}

export interface ScanRepositoryResult {
  readonly assessment: {
    readonly files: {
      readonly considered: number;
      readonly parseErrors: number;
      readonly parsed: number;
    };
    readonly observations: {
      readonly ambiguous: number;
      readonly highConfidence: number;
      readonly nonPatchable: number;
      readonly patchable: number;
      readonly reasonCounts: Readonly<Partial<Record<ScannerReasonCode, number>>>;
      readonly total: number;
    };
    readonly scope: "supported-direct-openai-compatible-typescript-calls";
  };
  readonly files: readonly string[];
  readonly findings: readonly ScanFinding[];
}

export interface CatalogRefreshFileOptions {
  readonly catalogFile?: string;
  readonly observedAt?: string;
  readonly refreshId?: string;
  readonly storePath: string;
}

export interface CatalogShortlistFileOptions {
  readonly callSiteId: string;
  readonly limit?: number;
  readonly manifestPath: string;
  readonly observationPath: string;
  readonly snapshotPath: string;
}

export interface CliDependencies {
  readonly catalogRefreshFactory?: (options: {
    readonly catalogStorePath: string;
    readonly invocationId: string;
    readonly refreshId: string;
  }) => Promise<CurrentCatalogRefresh>;
  readonly clock?: EvaluationClock;
  readonly evaluationTransportFactory?: (apiKey: string) => EvaluationTransport;
}

export async function refreshCatalogFile({
  catalogFile,
  observedAt,
  refreshId = randomUUID(),
  storePath,
}: CatalogRefreshFileOptions): Promise<RefreshCatalogResult> {
  if (catalogFile === undefined && observedAt !== undefined) {
    throw new Error("--observed-at is reserved for captured catalog files.");
  }
  const store = new FileCatalogStore(path.resolve(storePath));
  if (catalogFile === undefined) {
    return refreshOpenRouterCatalog({ acquisition: "live-api", refreshId, store });
  }
  if (observedAt === undefined) {
    throw new Error("--observed-at is required for captured catalog files.");
  }
  const fetch = async (): Promise<Response> =>
    new Response(Readable.toWeb(createReadStream(catalogFile)) as ReadableStream<Uint8Array>, {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  return refreshOpenRouterCatalog({
    acquisition: "captured-response",
    fetch: fetch as typeof globalThis.fetch,
    observedAt,
    refreshId,
    store,
  });
}

export async function createCatalogShortlistFile({
  callSiteId,
  limit,
  manifestPath,
  observationPath,
  snapshotPath,
}: CatalogShortlistFileOptions): Promise<CandidateShortlist> {
  const manifest = parseCallSiteManifest(await readJsonFile(manifestPath));
  const callSite = manifest.callSites.find(({ id }) => id === callSiteId);
  if (callSite === undefined) {
    throw new Error(`Call site ${callSiteId} is not present in ${manifestPath}.`);
  }
  const snapshot = parseCatalogSnapshot(await readJsonFile(snapshotPath));
  const observation = await readJsonFile(observationPath);
  return resolveCandidates({
    callSite,
    ...(limit === undefined ? {} : { limit }),
    observation,
    snapshot,
  });
}

export async function initializeManifestFile({
  callSitePath,
  dryRun = false,
  manifestId,
  manifestPath,
}: ManifestInitOptions): Promise<ManifestInitResult> {
  const callSite = parseCallSite(await readJsonFile(callSitePath));
  const normalizedManifestPath = path.resolve(manifestPath);

  return withManifestLock(normalizedManifestPath, async () => {
    const existingManifest = await readOptionalJsonFile(normalizedManifestPath);
    const manifest = initializeCallSiteManifest({
      callSite,
      existingManifest,
      ...(manifestId === undefined ? {} : { manifestId }),
    });
    const nextContents = `${canonicalizeArtifact(manifest)}\n`;
    const currentContents =
      existingManifest === undefined ? undefined : `${canonicalizeArtifact(existingManifest)}\n`;

    const wouldChange = nextContents !== currentContents;
    if (!wouldChange || dryRun) {
      return { callSiteId: callSite.id, changed: false, manifest, wouldChange };
    }

    await writeFileAtomically(normalizedManifestPath, nextContents);
    return { callSiteId: callSite.id, changed: true, manifest, wouldChange: true };
  });
}

export async function scanRepository({
  paths = ["."],
  repositoryRoot = process.cwd(),
}: ScanRepositoryOptions = {}): Promise<ScanRepositoryResult> {
  const absoluteRoot = path.resolve(repositoryRoot);
  const sourcePaths = new Set<string>();
  for (const requestedPath of paths) {
    const absolutePath = path.resolve(absoluteRoot, requestedPath);
    assertWithinRepository(absoluteRoot, absolutePath);
    for (const sourcePath of await collectTypeScriptFiles(absoluteRoot, absolutePath)) {
      sourcePaths.add(sourcePath);
    }
  }

  const files = [...sourcePaths]
    .map((sourcePath) => repositoryPath(absoluteRoot, sourcePath))
    .toSorted();
  const findings = (
    await Promise.all(
      files.map(async (file) =>
        scanTypeScript({
          file,
          source: await readBoundedTextFile(path.join(absoluteRoot, file)),
        }),
      ),
    )
  )
    .flat()
    .toSorted((left, right) =>
      left.file === right.file
        ? left.location.line === right.location.line
          ? left.location.column - right.location.column
          : left.location.line - right.location.line
        : left.file.localeCompare(right.file),
    );

  const parseErrorFiles = new Set(
    findings.filter(({ reasonCode }) => reasonCode === "parse-error").map(({ file }) => file),
  ).size;
  const observations = findings.filter(({ reasonCode }) => reasonCode !== "parse-error");
  const reasonCounts = Object.fromEntries(
    [...new Set(observations.map(({ reasonCode }) => reasonCode))]
      .toSorted()
      .map((reasonCode) => [
        reasonCode,
        observations.filter((finding) => finding.reasonCode === reasonCode).length,
      ]),
  ) as Partial<Record<ScannerReasonCode, number>>;
  const assessment = {
    files: {
      considered: files.length,
      parseErrors: parseErrorFiles,
      parsed: files.length - parseErrorFiles,
    },
    observations: {
      ambiguous: observations.filter(({ confidence }) => confidence === "ambiguous").length,
      highConfidence: observations.filter(({ confidence }) => confidence === "high").length,
      nonPatchable: observations.filter(({ patchability }) => patchability === "not-patchable")
        .length,
      patchable: observations.filter(({ patchability }) => patchability === "patchable").length,
      reasonCounts,
      total: observations.length,
    },
    scope: "supported-direct-openai-compatible-typescript-calls" as const,
  };

  return { assessment, files, findings };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readBoundedTextFile(filePath)) as unknown;
}

async function readBoundedTextFile(
  filePath: string,
  maximumBytes = MAX_REPOSITORY_INPUT_BYTES,
): Promise<string> {
  const stream = createReadStream(filePath);
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    byteLength += buffer.byteLength;
    if (byteLength > maximumBytes) {
      stream.destroy();
      throw new Error(`Repository input ${filePath} exceeds the ${maximumBytes}-byte limit.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

async function readOptionalJsonFile(filePath: string): Promise<unknown | undefined> {
  try {
    return await readJsonFile(filePath);
  } catch (error: unknown) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

async function writeFileAtomically(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.vetryn-tmp`;

  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function withManifestLock<Value>(
  manifestPath: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  const lockPath = `${manifestPath}.vetryn-lock`;
  const maximumAttempts = 40;

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      await mkdir(lockPath);
    } catch (error: unknown) {
      if (!isExistingFileError(error)) throw error;
      await delay(5);
      continue;
    }

    try {
      return await operation();
    } finally {
      await rmdir(lockPath);
    }
  }

  throw new Error(
    `Manifest initialization is already in progress for ${manifestPath}; retry shortly.`,
  );
}

async function collectTypeScriptFiles(
  repositoryRoot: string,
  absolutePath: string,
): Promise<string[]> {
  assertWithinRepository(repositoryRoot, absolutePath);
  const fileInfo = await lstat(absolutePath);
  if (fileInfo.isSymbolicLink()) {
    throw new Error(
      `Refusing to scan symbolic link outside the repository boundary: ${absolutePath}`,
    );
  }
  if (fileInfo.isFile()) return isTypeScriptFile(absolutePath) ? [absolutePath] : [];
  if (!fileInfo.isDirectory()) return [];

  const entries = (await readdir(absolutePath, { withFileTypes: true })).toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files: string[] = [];
  for (const entry of entries) {
    if (isIgnoredPath(entry.name)) continue;
    const entryPath = path.join(absolutePath, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() && isTypeScriptFile(entry.name)) {
      files.push(entryPath);
      continue;
    }
    if (entry.isDirectory())
      files.push(...(await collectTypeScriptFiles(repositoryRoot, entryPath)));
  }
  return files;
}

function assertWithinRepository(repositoryRoot: string, candidatePath: string): void {
  const relativePath = path.relative(repositoryRoot, candidatePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to scan a path outside repository root: ${candidatePath}`);
  }
}

function repositoryPath(repositoryRoot: string, absolutePath: string): string {
  const relativePath = path.relative(repositoryRoot, absolutePath);
  assertWithinRepository(repositoryRoot, absolutePath);
  return relativePath.split(path.sep).join("/");
}

function isExistingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isIgnoredPath(name: string): boolean {
  return ignoredPathNames.has(name);
}

function isTypeScriptFile(filePath: string): boolean {
  return [".cts", ".mts", ".ts", ".tsx"].some((extension) => filePath.endsWith(extension));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function getDiagnostics(): Diagnostics {
  return {
    architecture: process.arch,
    node: process.version,
    platform: process.platform,
    version: VERSION,
  };
}

export function createProgram(dependencies: CliDependencies = {}): Command {
  const program = new Command();

  program
    .name("vetryn")
    .description("Dependabot for AI model dependencies.")
    .version(VERSION)
    .showHelpAfterError();

  program
    .command("doctor")
    .description("Print local runtime diagnostics.")
    .option("--json", "Print machine-readable JSON.")
    .action((options: { json?: boolean }) => {
      const diagnostics = getDiagnostics();

      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
        return;
      }

      process.stdout.write(
        [
          `Vetryn ${diagnostics.version}`,
          `Node ${diagnostics.node}`,
          `${diagnostics.platform} ${diagnostics.architecture}`,
        ].join("\n") + "\n",
      );
    });

  const manifest = program
    .command("manifest")
    .description("Manage human-owned call-site manifests.");

  manifest
    .command("init")
    .description("Create or append one reviewed call site without overwriting a stable ID.")
    .requiredOption("--call-site <path>", "Path to a reviewed call-site JSON record.")
    .requiredOption("--manifest <path>", "Path to the call-site manifest JSON file.")
    .option("--manifest-id <id>", "Required when creating a new manifest.")
    .option("--dry-run", "Validate without writing the manifest.")
    .option("--json", "Print machine-readable JSON.")
    .action(
      async (options: {
        callSite: string;
        dryRun?: boolean;
        json?: boolean;
        manifest: string;
        manifestId?: string;
      }) => {
        const result = await initializeManifestFile({
          callSitePath: options.callSite,
          manifestPath: options.manifest,
          ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
          ...(options.manifestId === undefined ? {} : { manifestId: options.manifestId }),
        });
        const summary = {
          changed: result.changed,
          callSiteId: result.callSiteId,
          manifestId: result.manifest.id,
          wouldChange: result.wouldChange,
        };

        if (options.json === true) {
          process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
          return;
        }

        const outcome = result.changed
          ? "Updated"
          : result.wouldChange
            ? "Would update"
            : "Validated";
        process.stdout.write(`${outcome} ${summary.manifestId} for ${summary.callSiteId}.\n`);
      },
    );

  const catalog = program
    .command("catalog")
    .description("Refresh immutable OpenRouter snapshots and resolve offline shortlists.");

  catalog
    .command("refresh")
    .description("Fetch or import OpenRouter metadata and record immutable refresh evidence.")
    .requiredOption("--store <path>", "Directory for immutable catalog evidence.")
    .option(
      "--catalog-file <path>",
      "Import a local OpenRouter response instead of using the network.",
    )
    .option(
      "--observed-at <timestamp>",
      "Required acquisition timestamp when importing --catalog-file.",
    )
    .option("--refresh-id <id>", "Unique immutable observation ID.")
    .action(
      async (options: {
        catalogFile?: string;
        observedAt?: string;
        refreshId?: string;
        store: string;
      }) => {
        const result = await refreshCatalogFile({
          ...(options.catalogFile === undefined ? {} : { catalogFile: options.catalogFile }),
          ...(options.observedAt === undefined ? {} : { observedAt: options.observedAt }),
          ...(options.refreshId === undefined ? {} : { refreshId: options.refreshId }),
          storePath: options.store,
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (result.status === "failure") process.exitCode = 1;
      },
    );

  program
    .command("eval")
    .description("Run one bounded current-versus-candidate evaluation and persist its receipt.")
    .requiredOption("--manifest <path>", "Path to the reviewed call-site manifest.")
    .requiredOption("--call-site <id>", "Human-owned call-site ID.")
    .requiredOption("--suite <path>", "Path to the reviewed eval-suite artifact.")
    .requiredOption("--fixture <path>", "Path to reviewed JSONL evaluation cases.")
    .requiredOption(
      "--catalog-store <path>",
      "Repository path for current-invocation catalog evidence.",
    )
    .requiredOption("--refresh-id <id>", "Unique ID for the live catalog refresh attempt.")
    .requiredOption("--candidate <model>", "Canonical candidate model ID.")
    .requiredOption("--run-id <id>", "Stable ID for this immutable execution record.")
    .requiredOption("--trust-epoch <id>", "Externally anchored trust-epoch ID.")
    .requiredOption("--evidence-store <path>", "Repository path for authenticated receipts.")
    .requiredOption("--anchor <path>", "External exact-head anchor path outside the repository.")
    .requiredOption(
      "--receipt-key-file <path>",
      "External HMAC key file for receipt authentication.",
    )
    .requiredOption("--provider-key-file <path>", "Explicit OpenRouter API key file.")
    .requiredOption("--output <path>", "Destination for the redacted evaluation artifacts.")
    .option("--root <path>", "Repository root for the receipt trust boundary.", process.cwd())
    .option("--evaluator-build <ref>", "Evaluator build or commit reference.", "package:0.0.0")
    .action(
      async (options: {
        anchor: string;
        callSite: string;
        candidate: string;
        catalogStore: string;
        evaluatorBuild: string;
        evidenceStore: string;
        fixture: string;
        manifest: string;
        output: string;
        providerKeyFile: string;
        receiptKeyFile: string;
        refreshId: string;
        root: string;
        runId: string;
        suite: string;
        trustEpoch: string;
      }) => {
        const providerKey = (await readBoundedTextFile(options.providerKeyFile)).trim();
        const receiptKey = Buffer.from((await readBoundedTextFile(options.receiptKeyFile)).trim());
        const receiptStore = new FileExecutionReceiptStore({
          anchorPath: options.anchor,
          evidencePath: options.evidenceStore,
          key: receiptKey,
          repositoryRoot: options.root,
        });
        const currentCatalogRefresh = await (dependencies.catalogRefreshFactory?.({
          catalogStorePath: options.catalogStore,
          invocationId: options.runId,
          refreshId: options.refreshId,
        }) ??
          (async () => {
            const refresh = await refreshOpenRouterCatalog({
              acquisition: "live-api",
              refreshId: options.refreshId,
              store: new FileCatalogStore(options.catalogStore),
            });
            if (refresh.status !== "success") {
              await receiptStore.appendCatalogRefreshAttempt(refresh.observation, {
                invocationId: options.runId,
                ordinal: 1,
                trustEpochId: options.trustEpoch,
              });
              throw new Error("The current invocation's terminal catalog refresh failed.");
            }
            return createCurrentCatalogRefresh({
              invocationId: options.runId,
              refresh,
            });
          })());
        for (const attempt of currentCatalogRefresh.lineage.attempts) {
          await receiptStore.appendCatalogRefreshAttempt(attempt.observation, {
            invocationId: currentCatalogRefresh.lineage.invocationId,
            ordinal: attempt.ordinal,
            trustEpochId: options.trustEpoch,
          });
        }
        const result = await evaluateFiles({
          anchorPath: options.anchor,
          callSiteId: options.callSite,
          candidateModel: options.candidate,
          clock: dependencies.clock ?? { now: () => new Date().toISOString() },
          currentCatalogRefresh,
          evaluatorBuild: options.evaluatorBuild,
          evalSuitePath: options.suite,
          evidencePath: options.evidenceStore,
          executionRecordId: `execution-record:${options.runId}`,
          fixturePath: options.fixture,
          key: receiptKey,
          manifestPath: options.manifest,
          outputPath: options.output,
          repositoryRoot: options.root,
          transport:
            dependencies.evaluationTransportFactory?.(providerKey) ??
            createOpenRouterEvaluationTransport({ apiKey: providerKey }),
          trustEpochId: options.trustEpoch,
        });
        process.stdout.write(
          `${JSON.stringify(
            {
              candidateRunId: result.candidateRun.id,
              executionRecordId: result.executionRecord.id,
              output: options.output,
              status: result.candidateRun.status,
            },
            null,
            2,
          )}\n`,
        );
      },
    );

  catalog
    .command("shortlist")
    .description("Resolve candidates from a reviewed manifest and a pinned snapshot.")
    .requiredOption("--manifest <path>", "Path to a reviewed call-site manifest.")
    .requiredOption("--call-site <id>", "Human-owned call-site ID.")
    .requiredOption("--snapshot <path>", "Path to an immutable catalog snapshot.")
    .requiredOption(
      "--observation <path>",
      "Path to successful refresh evidence that commits the snapshot timestamp.",
    )
    .option("--limit <count>", "Repository candidate bound, from one to five.", (value) =>
      Number(value),
    )
    .action(
      async (options: {
        callSite: string;
        limit?: number;
        manifest: string;
        observation: string;
        snapshot: string;
      }) => {
        const shortlist = await createCatalogShortlistFile({
          callSiteId: options.callSite,
          ...(options.limit === undefined ? {} : { limit: options.limit }),
          manifestPath: options.manifest,
          observationPath: options.observation,
          snapshotPath: options.snapshot,
        });
        process.stdout.write(`${JSON.stringify(shortlist, null, 2)}\n`);
      },
    );

  program
    .command("scan")
    .description("Discover high-confidence OpenAI-compatible TypeScript model pins.")
    .argument("[paths...]", "TypeScript files or directories relative to the repository root.")
    .option(
      "--root <path>",
      "Repository root used to derive durable relative source paths.",
      process.cwd(),
    )
    .option("--json", "Print machine-readable JSON.")
    .action(async (paths: string[] | undefined, options: { json?: boolean; root: string }) => {
      const result = await scanRepository({
        paths: paths === undefined || paths.length === 0 ? ["."] : paths,
        repositoryRoot: options.root,
      });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      const { files: fileCounts, observations } = result.assessment;
      process.stdout.write(
        `Assessed ${fileCounts.considered} TypeScript file(s) in the supported direct-call scope: ${fileCounts.parsed} parsed, ${fileCounts.parseErrors} parse error(s); observed ${observations.total} call-site signal(s): ${observations.patchable} patchable, ${observations.nonPatchable} non-patchable.\n`,
      );
      for (const finding of result.findings) {
        const model = finding.modelPin === undefined ? "" : ` ${finding.modelPin}`;
        process.stdout.write(
          `[${finding.confidence}] ${finding.file}:${finding.location.line}:${finding.location.column} ${finding.reasonCode}${model}\n`,
        );
      }
    });

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  await createProgram().parseAsync([...argv]);
}

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}

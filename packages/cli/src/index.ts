#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, rmdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import { Command } from "commander";
import { scanTypeScript, type ScanFinding } from "@vetryn/typescript";
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
  refreshOpenRouterCatalog,
  resolveCandidates,
  type CandidateShortlist,
  type RefreshCatalogResult,
} from "@vetryn/openrouter";

export const VERSION = "0.0.0";
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
  readonly snapshotPath: string;
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
  const fetch =
    catalogFile === undefined
      ? undefined
      : async (): Promise<Response> =>
          new Response(
            Readable.toWeb(createReadStream(catalogFile)) as ReadableStream<Uint8Array>,
            {
              headers: { "content-type": "application/json" },
              status: 200,
            },
          );
  const store = new FileCatalogStore(path.resolve(storePath));
  return catalogFile === undefined
    ? refreshOpenRouterCatalog({ acquisition: "live-api", refreshId, store })
    : refreshOpenRouterCatalog({
        acquisition: "captured-response",
        fetch: fetch as typeof globalThis.fetch,
        observedAt: observedAt ?? new Date().toISOString(),
        refreshId,
        store,
      });
}

export async function createCatalogShortlistFile({
  callSiteId,
  limit,
  manifestPath,
  snapshotPath,
}: CatalogShortlistFileOptions): Promise<CandidateShortlist> {
  const manifest = parseCallSiteManifest(await readJsonFile(manifestPath));
  const callSite = manifest.callSites.find(({ id }) => id === callSiteId);
  if (callSite === undefined) {
    throw new Error(`Call site ${callSiteId} is not present in ${manifestPath}.`);
  }
  return resolveCandidates({
    callSite,
    ...(limit === undefined ? {} : { limit }),
    snapshot: parseCatalogSnapshot(await readJsonFile(snapshotPath)),
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
          source: await readFile(path.join(absoluteRoot, file), "utf8"),
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

  return { files, findings };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
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

export function createProgram(): Command {
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
    .option("--observed-at <timestamp>", "Offset-aware observation timestamp.")
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

  catalog
    .command("shortlist")
    .description("Resolve candidates from a reviewed manifest and a pinned snapshot.")
    .requiredOption("--manifest <path>", "Path to a reviewed call-site manifest.")
    .requiredOption("--call-site <id>", "Human-owned call-site ID.")
    .requiredOption("--snapshot <path>", "Path to an immutable catalog snapshot.")
    .option("--limit <count>", "Repository candidate bound, from one to five.", (value) =>
      Number(value),
    )
    .action(
      async (options: { callSite: string; limit?: number; manifest: string; snapshot: string }) => {
        const shortlist = await createCatalogShortlistFile({
          callSiteId: options.callSite,
          ...(options.limit === undefined ? {} : { limit: options.limit }),
          manifestPath: options.manifest,
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

      process.stdout.write(
        `Scanned ${result.files.length} TypeScript file(s); found ${result.findings.length} finding(s).\n`,
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

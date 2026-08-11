#!/usr/bin/env node

import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Command } from "commander";
import {
  canonicalizeArtifact,
  initializeCallSiteManifest,
  parseCallSite,
  type CallSiteManifest,
} from "@vetryn/core";

export const VERSION = "0.0.0";

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

export async function initializeManifestFile({
  callSitePath,
  dryRun = false,
  manifestId,
  manifestPath,
}: ManifestInitOptions): Promise<ManifestInitResult> {
  const callSite = parseCallSite(await readJsonFile(callSitePath));
  const existingManifest = await readOptionalJsonFile(manifestPath);
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

  await writeFileAtomically(manifestPath, nextContents);
  return { callSiteId: callSite.id, changed: true, manifest, wouldChange: true };
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

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  await createProgram().parseAsync([...argv]);
}

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}

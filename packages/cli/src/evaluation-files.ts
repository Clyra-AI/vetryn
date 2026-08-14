import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseCallSiteManifest,
  parseEvalSuite,
  type CandidateRun,
  type EvaluationExecutionRecord,
} from "@vetryn/core";
import {
  evaluateOpenRouterCandidate,
  type CurrentCatalogRefresh,
  type EvaluationClock,
  type EvaluationTransport,
} from "@vetryn/openrouter";

import { FileExecutionReceiptStore, type ReceiptAppendResult } from "./evidence-store.js";

const MAX_INPUT_BYTES = 20_000_000;

export interface EvaluateFilesOptions {
  readonly anchorPath: string;
  readonly callSiteId: string;
  readonly candidateModel: string;
  readonly clock: EvaluationClock;
  readonly currentCatalogRefresh: CurrentCatalogRefresh;
  readonly evaluatorBuild: string;
  readonly evalSuitePath: string;
  readonly evidencePath: string;
  readonly executionRecordId: string;
  readonly fixturePath: string;
  readonly key: Uint8Array;
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly repositoryRoot: string;
  readonly transport: EvaluationTransport;
  readonly trustEpochId: string;
}

export interface EvaluateFilesResult {
  readonly candidateRun: CandidateRun;
  readonly executionRecord: EvaluationExecutionRecord;
  readonly receipt: ReceiptAppendResult;
}

export async function evaluateFiles(options: EvaluateFilesOptions): Promise<EvaluateFilesResult> {
  const [manifest, evalSuite, fixtureContents] = await Promise.all([
    readJson(options.manifestPath).then(parseCallSiteManifest),
    readJson(options.evalSuitePath).then(parseEvalSuite),
    readBoundedText(options.fixturePath),
  ]);
  const callSite = manifest.callSites.find(({ id }) => id === options.callSiteId);
  if (callSite === undefined)
    throw new Error(`Call site ${options.callSiteId} is not in the manifest.`);
  const fixtureDigest = `sha256:${createHash("sha256").update(fixtureContents).digest("hex")}`;
  const cases = parseFixtureCases(fixtureContents);
  const artifacts = await evaluateOpenRouterCandidate({
    callSite,
    candidateModel: options.candidateModel,
    cases,
    clock: options.clock,
    currentCatalogRefresh: options.currentCatalogRefresh,
    evalSuite,
    evaluator: { build: options.evaluatorBuild, id: "vetryn-evaluator", version: "0.0.0" },
    executionRecordId: options.executionRecordId,
    fixtureDigest,
    limits: {
      concurrency: 4,
      maxRequests: 1_000,
      maxSpendUsd: "10",
      retries: 2,
      timeoutMs: 30_000,
    },
    sampling: { attempts: 1, maxOutputTokens: 128, seed: 42, temperature: 0 },
    scorer: {
      configurationDigest: sha256("vetryn-deterministic-assertions:1.0.0"),
      id: "deterministic-assertions",
      version: "1.0.0",
    },
    transport: options.transport,
  });
  const store = new FileExecutionReceiptStore({
    anchorPath: options.anchorPath,
    evidencePath: options.evidencePath,
    key: options.key,
    repositoryRoot: options.repositoryRoot,
  });
  const receipt = await store.append(artifacts.executionRecord, {
    catalogRefreshLineage: options.currentCatalogRefresh.lineage,
    trustEpochId: options.trustEpochId,
  });
  const result = { ...artifacts, receipt };
  await writeJsonAtomically(options.outputPath, result);
  return result;
}

function parseFixtureCases(contents: string) {
  const lines = contents.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`Evaluation fixture line ${index + 1} is not valid JSON.`);
    }
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof Reflect.get(value, "id") !== "string" ||
      typeof Reflect.get(value, "input") !== "string"
    )
      throw new Error(`Evaluation fixture line ${index + 1} is invalid.`);
    const expectedInput = Reflect.get(value, "expected");
    const expectedClass = Reflect.get(value, "expectedClass");
    const expected =
      typeof expectedInput === "object" && expectedInput !== null && !Array.isArray(expectedInput)
        ? (expectedInput as Record<string, string | number | boolean | null>)
        : typeof expectedClass === "string"
          ? { classification: expectedClass }
          : undefined;
    if (expected === undefined)
      throw new Error(`Evaluation fixture line ${index + 1} lacks expected facts.`);
    const protectedInput = Reflect.get(value, "protectedSegments");
    const protectedSegments = Array.isArray(protectedInput)
      ? protectedInput.filter((entry): entry is string => typeof entry === "string")
      : [];
    return {
      expected,
      id: Reflect.get(value, "id") as string,
      input: Reflect.get(value, "input") as string,
      protectedSegments,
    };
  });
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readBoundedText(filePath)) as unknown;
}

async function readBoundedText(filePath: string): Promise<string> {
  const stream = createReadStream(filePath);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > MAX_INPUT_BYTES) {
      stream.destroy();
      throw new Error(`Evaluation input ${filePath} exceeds ${MAX_INPUT_BYTES} bytes.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  const temporary = `${filePath}.${process.pid}.vetryn-tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, filePath);
  } catch (error: unknown) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

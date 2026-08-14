import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { parseEvaluationExecutionRecord, type EvaluationExecutionRecord } from "@vetryn/core";
import {
  createCatalogRefreshLineageDigest,
  parseCatalogRefreshLineage,
  type CatalogRefreshLineage,
} from "@vetryn/openrouter";

const MAX_RECEIPT_BYTES = 1_000_000;
const LOCK_RETRIES = 100;

interface RepositoryHead {
  readonly headDigest: string;
  readonly sequence: number;
  readonly trustEpochId: string;
}

interface Anchor extends RepositoryHead {
  readonly authenticationTag: string;
}

export interface AuthenticatedExecutionReceipt {
  readonly artifactType: "authenticated-evaluation-receipt";
  readonly authenticationTag: string;
  readonly catalogRefreshLineage: CatalogRefreshLineage;
  readonly executionRecord: EvaluationExecutionRecord;
  readonly priorHeadDigest: string | null;
  readonly schemaVersion: "1.0.0";
  readonly sequence: number;
  readonly trustEpochId: string;
}

export interface ReceiptAppendResult {
  readonly executionRecordId: string;
  readonly headDigest: string;
  readonly sequence: number;
  readonly trustEpochId: string;
}

export type ReceiptVerificationResult =
  | {
      readonly actionable: true;
      readonly reason: "verified";
      readonly receipt: AuthenticatedExecutionReceipt;
    }
  | {
      readonly actionable: false;
      readonly reason:
        | "anchor-head-mismatch"
        | "invalid-authentication"
        | "invalid-chain"
        | "missing-trust-state"
        | "record-not-in-current-epoch";
      readonly receipt: null;
    };

export interface FileExecutionReceiptStoreOptions {
  readonly anchorPath: string;
  readonly evidencePath: string;
  readonly key: Uint8Array;
  readonly repositoryRoot: string;
}

export class FileExecutionReceiptStore {
  readonly anchorPath: string;
  readonly evidencePath: string;
  readonly key: Buffer;
  readonly repositoryRoot: string;

  constructor(options: FileExecutionReceiptStoreOptions) {
    this.repositoryRoot = path.resolve(options.repositoryRoot);
    this.evidencePath = path.resolve(options.evidencePath);
    this.anchorPath = path.resolve(options.anchorPath);
    this.key = Buffer.from(options.key);
    if (this.key.byteLength < 16)
      throw new Error("Execution receipt key must contain at least 16 bytes.");
    if (!isWithin(this.repositoryRoot, this.evidencePath)) {
      throw new Error("Execution evidence store must be inside the repository root.");
    }
    if (isWithin(this.repositoryRoot, this.anchorPath)) {
      throw new Error(
        "Execution receipt anchor must remain outside repository-controlled content.",
      );
    }
  }

  async append(
    recordInput: unknown,
    options: {
      readonly catalogRefreshLineage: unknown;
      readonly trustEpochId: string;
    },
  ): Promise<ReceiptAppendResult> {
    const record = parseEvaluationExecutionRecord(recordInput);
    const catalogRefreshLineage = parseCatalogRefreshLineage(options.catalogRefreshLineage);
    if (
      createCatalogRefreshLineageDigest(catalogRefreshLineage) !==
      record.catalogRefreshLineageDigest
    ) {
      throw new Error("Execution record does not bind the complete catalog refresh lineage.");
    }
    assertStableId(options.trustEpochId, "trust epoch ID");
    await this.ensureDirectories();
    return this.withLock(async () => {
      if (await this.hasRecordCollision(record.id)) {
        throw new Error(`Execution record ID collision for ${record.id}.`);
      }
      const [head, anchor] = await Promise.all([
        readOptionalJson<RepositoryHead>(this.headPath()),
        readOptionalJson<Anchor>(this.anchorPath),
      ]);
      let prior: RepositoryHead | null = null;
      if (head !== null && anchor !== null) {
        const verified = await this.verifyChain(head, anchor);
        if (!verified.valid)
          throw new Error(`Existing execution receipt chain is invalid: ${verified.reason}.`);
        if (head.trustEpochId !== options.trustEpochId) {
          throw new Error("A verified receipt chain cannot change trust epochs implicitly.");
        }
        prior = head;
      } else if (anchor !== null) {
        throw new Error("External execution anchor exists without its repository head.");
      }

      const body = {
        artifactType: "authenticated-evaluation-receipt" as const,
        catalogRefreshLineage,
        executionRecord: record,
        priorHeadDigest: prior?.headDigest ?? null,
        schemaVersion: "1.0.0" as const,
        sequence: (prior?.sequence ?? 0) + 1,
        trustEpochId: options.trustEpochId,
      };
      const receipt: AuthenticatedExecutionReceipt = {
        ...body,
        authenticationTag: hmac(this.key, canonicalJson(body)),
      };
      const headDigest = sha256(canonicalJson(receipt));
      const nextHead: RepositoryHead = {
        headDigest,
        sequence: receipt.sequence,
        trustEpochId: receipt.trustEpochId,
      };
      const anchorBody = nextHead;
      const nextAnchor: Anchor = {
        ...anchorBody,
        authenticationTag: hmac(this.key, canonicalJson(anchorBody)),
      };
      const receiptPath = this.receiptPath(headDigest);
      await publishImmutable(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      try {
        await atomicWrite(this.headPath(), `${JSON.stringify(nextHead, null, 2)}\n`);
        await atomicWrite(this.anchorPath, `${JSON.stringify(nextAnchor, null, 2)}\n`);
      } catch (error: unknown) {
        await unlink(receiptPath).catch(() => undefined);
        throw error;
      }
      return {
        executionRecordId: record.id,
        headDigest,
        sequence: receipt.sequence,
        trustEpochId: receipt.trustEpochId,
      };
    });
  }

  async verify(executionRecordId: string): Promise<ReceiptVerificationResult> {
    await this.ensureDirectories();
    const [head, anchor] = await Promise.all([
      readOptionalJson<RepositoryHead>(this.headPath()),
      readOptionalJson<Anchor>(this.anchorPath),
    ]);
    if (head === null || anchor === null) {
      return { actionable: false, reason: "missing-trust-state", receipt: null };
    }
    if (
      head.headDigest !== anchor.headDigest ||
      head.sequence !== anchor.sequence ||
      head.trustEpochId !== anchor.trustEpochId
    ) {
      return { actionable: false, reason: "anchor-head-mismatch", receipt: null };
    }
    const verified = await this.verifyChain(head, anchor);
    if (!verified.valid) return { actionable: false, reason: verified.reason, receipt: null };
    const receipt = verified.receipts.find(
      (candidate) => candidate.executionRecord.id === executionRecordId,
    );
    return receipt === undefined
      ? { actionable: false, reason: "record-not-in-current-epoch", receipt: null }
      : { actionable: true, reason: "verified", receipt };
  }

  private async verifyChain(
    head: RepositoryHead,
    anchor: Anchor,
  ): Promise<
    | { readonly valid: true; readonly receipts: readonly AuthenticatedExecutionReceipt[] }
    | {
        readonly valid: false;
        readonly reason: "invalid-authentication" | "invalid-chain";
      }
  > {
    const anchorBody: RepositoryHead = {
      headDigest: anchor.headDigest,
      sequence: anchor.sequence,
      trustEpochId: anchor.trustEpochId,
    };
    if (!safeEqual(anchor.authenticationTag, hmac(this.key, canonicalJson(anchorBody)))) {
      return { valid: false, reason: "invalid-authentication" };
    }
    const receipts: AuthenticatedExecutionReceipt[] = [];
    let expectedDigest: string | null = head.headDigest;
    let expectedSequence = head.sequence;
    while (expectedDigest !== null) {
      let receipt: AuthenticatedExecutionReceipt;
      try {
        receipt = parseReceipt(await readBoundedJson(this.receiptPath(expectedDigest)));
      } catch {
        return { valid: false, reason: "invalid-chain" };
      }
      if (
        sha256(canonicalJson(receipt)) !== expectedDigest ||
        receipt.sequence !== expectedSequence ||
        receipt.trustEpochId !== head.trustEpochId
      ) {
        return { valid: false, reason: "invalid-chain" };
      }
      try {
        if (
          createCatalogRefreshLineageDigest(receipt.catalogRefreshLineage) !==
          receipt.executionRecord.catalogRefreshLineageDigest
        ) {
          return { valid: false, reason: "invalid-chain" };
        }
      } catch {
        return { valid: false, reason: "invalid-chain" };
      }
      const { authenticationTag, ...body } = receipt;
      if (!safeEqual(authenticationTag, hmac(this.key, canonicalJson(body)))) {
        return { valid: false, reason: "invalid-authentication" };
      }
      receipts.push(receipt);
      expectedDigest = receipt.priorHeadDigest;
      expectedSequence -= 1;
    }
    if (expectedSequence !== 0 || receipts.length !== head.sequence) {
      return { valid: false, reason: "invalid-chain" };
    }
    return { valid: true, receipts };
  }

  private async hasRecordCollision(id: string): Promise<boolean> {
    const directory = path.join(this.evidencePath, "receipts");
    for (const entry of await readdir(directory).catch(() => [] as string[])) {
      if (!entry.endsWith(".json")) continue;
      try {
        if (
          parseReceipt(await readBoundedJson(path.join(directory, entry))).executionRecord.id === id
        ) {
          return true;
        }
      } catch {
        throw new Error("Execution receipt store contains invalid persisted data.");
      }
    }
    return false;
  }

  private async ensureDirectories(): Promise<void> {
    await mkdir(this.repositoryRoot, { recursive: true });
    await assertNoSymbolicLinks(this.repositoryRoot, this.evidencePath);
    await mkdir(path.join(this.evidencePath, "receipts"), { recursive: true });
    await mkdir(path.dirname(this.anchorPath), { recursive: true });
    const [canonicalRoot, canonicalEvidence, canonicalAnchorParent] = await Promise.all([
      realpath(this.repositoryRoot),
      realpath(this.evidencePath),
      realpath(path.dirname(this.anchorPath)),
    ]);
    if (!isWithin(canonicalRoot, canonicalEvidence)) {
      throw new Error("Execution evidence store resolves outside the repository root.");
    }
    if (isWithin(canonicalRoot, canonicalAnchorParent)) {
      throw new Error("Execution receipt anchor resolves inside repository-controlled content.");
    }
    try {
      if ((await lstat(this.anchorPath)).isSymbolicLink()) {
        throw new Error("Execution receipt anchor cannot be a symbolic link.");
      }
    } catch (error: unknown) {
      if (!isMissingFileError(error)) throw error;
    }
  }

  private headPath(): string {
    return path.join(this.evidencePath, "head.json");
  }

  private receiptPath(digest: string): string {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error("Invalid execution receipt digest.");
    return path.join(this.evidencePath, "receipts", `${digest.slice(7)}.json`);
  }

  private async withLock<Value>(operation: () => Promise<Value>): Promise<Value> {
    const lockPath = path.join(this.evidencePath, ".receipt-lock");
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
      try {
        await mkdir(lockPath);
        try {
          return await operation();
        } finally {
          await rmdir(lockPath);
        }
      } catch (error: unknown) {
        if (!isExistingFileError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    throw new Error("Timed out waiting for the execution receipt store lock.");
  }
}

async function assertNoSymbolicLinks(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error("Execution evidence store refuses symbolic-link path components.");
      }
    } catch (error: unknown) {
      if (!isMissingFileError(error)) throw error;
    }
  }
}

function parseReceipt(value: unknown): AuthenticatedExecutionReceipt {
  if (!isRecord(value)) throw new Error("Invalid execution receipt.");
  const keys = Object.keys(value).sort().join(",");
  if (
    keys !==
      [
        "artifactType",
        "authenticationTag",
        "catalogRefreshLineage",
        "executionRecord",
        "priorHeadDigest",
        "schemaVersion",
        "sequence",
        "trustEpochId",
      ]
        .sort()
        .join(",") ||
    value.artifactType !== "authenticated-evaluation-receipt" ||
    value.schemaVersion !== "1.0.0" ||
    typeof value.authenticationTag !== "string" ||
    !/^hmac-sha256:[0-9a-f]{64}$/.test(value.authenticationTag) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    typeof value.trustEpochId !== "string" ||
    (value.priorHeadDigest !== null &&
      (typeof value.priorHeadDigest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(value.priorHeadDigest)))
  ) {
    throw new Error("Invalid execution receipt.");
  }
  return {
    artifactType: "authenticated-evaluation-receipt",
    authenticationTag: value.authenticationTag,
    catalogRefreshLineage: parseCatalogRefreshLineage(value.catalogRefreshLineage),
    executionRecord: parseEvaluationExecutionRecord(value.executionRecord),
    priorHeadDigest: value.priorHeadDigest as string | null,
    schemaVersion: "1.0.0",
    sequence: value.sequence as number,
    trustEpochId: value.trustEpochId,
  };
}

async function readBoundedJson(filePath: string): Promise<unknown> {
  const contents = await readFile(filePath, "utf8");
  if (Buffer.byteLength(contents) > MAX_RECEIPT_BYTES)
    throw new Error("Execution receipt is oversized.");
  return JSON.parse(contents) as unknown;
}

async function readOptionalJson<Value>(filePath: string): Promise<Value | null> {
  try {
    return (await readBoundedJson(filePath)) as Value;
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
  await rename(temporary, filePath);
}

async function publishImmutable(filePath: string, contents: string): Promise<void> {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
  try {
    await link(temporary, filePath);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function hmac(key: Buffer, value: string): string {
  return `hmac-sha256:${createHmac("sha256", key).update(value, "utf8").digest("hex")}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function assertStableId(value: string, label: string): void {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) throw new Error(`Invalid ${label}.`);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isExistingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

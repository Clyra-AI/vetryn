import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
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
  refreshObservationSchema,
  type CatalogRefreshLineage,
  type RefreshObservation,
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

interface AuthenticatedExecutionReceipt {
  readonly artifactType: "authenticated-evaluation-receipt";
  readonly authenticationTag: string;
  readonly catalogRefreshLineage: CatalogRefreshLineage;
  readonly executionRecord: EvaluationExecutionRecord;
  readonly priorHeadDigest: string | null;
  readonly schemaVersion: "1.0.0";
  readonly sequence: number;
  readonly trustEpochId: string;
}

interface AuthenticatedCatalogRefreshAttempt {
  readonly artifactType: "authenticated-catalog-refresh-attempt";
  readonly authenticationTag: string;
  readonly invocationId: string;
  readonly observation: RefreshObservation;
  readonly ordinal: number;
  readonly priorHeadDigest: string | null;
  readonly schemaVersion: "1.0.0";
  readonly sequence: number;
  readonly trustEpochId: string;
}

type AuthenticatedChainEntry = AuthenticatedCatalogRefreshAttempt | AuthenticatedExecutionReceipt;
type ChainEntryBody =
  | Omit<AuthenticatedCatalogRefreshAttempt, "authenticationTag">
  | Omit<AuthenticatedExecutionReceipt, "authenticationTag">;

export interface ReceiptAppendResult {
  readonly executionRecordId: string;
  readonly headDigest: string;
  readonly sequence: number;
  readonly trustEpochId: string;
}

export interface CatalogRefreshAttemptAppendResult {
  readonly headDigest: string;
  readonly invocationId: string;
  readonly ordinal: number;
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
        | "catalog-refresh-not-current"
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
      const { entries, head, prior } = await this.loadChain(options.trustEpochId);
      assertLineageExtendsAuthenticatedHistory(catalogRefreshLineage, entries);

      const body = {
        artifactType: "authenticated-evaluation-receipt" as const,
        catalogRefreshLineage,
        executionRecord: record,
        priorHeadDigest: prior?.headDigest ?? null,
        schemaVersion: "1.0.0" as const,
        sequence: (prior?.sequence ?? 0) + 1,
        trustEpochId: options.trustEpochId,
      };
      const { entry: receipt, headDigest } = await this.persistEntry(body, head);
      return {
        executionRecordId: record.id,
        headDigest,
        sequence: receipt.sequence,
        trustEpochId: receipt.trustEpochId,
      };
    });
  }

  async appendCatalogRefreshAttempt(
    observationInput: unknown,
    options: {
      readonly invocationId: string;
      readonly ordinal: number;
      readonly trustEpochId: string;
    },
  ): Promise<CatalogRefreshAttemptAppendResult> {
    const observation = refreshObservationSchema.parse(observationInput);
    if (observation.acquisition !== "live-api") {
      throw new Error("Only live catalog attempts can advance actionable refresh state.");
    }
    assertStableId(options.invocationId, "catalog refresh invocation ID");
    assertStableId(options.trustEpochId, "trust epoch ID");
    if (!Number.isSafeInteger(options.ordinal) || options.ordinal < 1) {
      throw new Error("Invalid catalog refresh attempt ordinal.");
    }
    await this.ensureDirectories();
    return this.withLock(async () => {
      const { entries, head, prior } = await this.loadChain(options.trustEpochId);
      const latestAttempt = latestCatalogAttempt(entries);
      if (
        (latestAttempt?.invocationId === options.invocationId &&
          options.ordinal !== latestAttempt.ordinal + 1) ||
        (latestAttempt?.invocationId !== options.invocationId && options.ordinal !== 1)
      ) {
        throw new Error("Catalog refresh attempts must extend the complete ordered lineage.");
      }
      const body: Omit<AuthenticatedCatalogRefreshAttempt, "authenticationTag"> = {
        artifactType: "authenticated-catalog-refresh-attempt",
        invocationId: options.invocationId,
        observation,
        ordinal: options.ordinal,
        priorHeadDigest: prior?.headDigest ?? null,
        schemaVersion: "1.0.0",
        sequence: (prior?.sequence ?? 0) + 1,
        trustEpochId: options.trustEpochId,
      };
      const { entry, headDigest } = await this.persistEntry(body, head);
      if (entry.artifactType !== "authenticated-catalog-refresh-attempt") {
        throw new Error("Unexpected execution receipt store entry type.");
      }
      return {
        headDigest,
        invocationId: entry.invocationId,
        ordinal: entry.ordinal,
        sequence: entry.sequence,
        trustEpochId: entry.trustEpochId,
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
    const receipt = verified.entries.find(
      (candidate): candidate is AuthenticatedExecutionReceipt =>
        candidate.artifactType === "authenticated-evaluation-receipt" &&
        candidate.executionRecord.id === executionRecordId,
    );
    if (receipt === undefined) {
      return { actionable: false, reason: "record-not-in-current-epoch", receipt: null };
    }
    const latestAttempt = latestCatalogAttempt(verified.entries);
    const receiptAttempt = latestCatalogAttempt([receipt]);
    if (
      latestAttempt === undefined ||
      receiptAttempt === undefined ||
      latestAttempt.observation.status !== "success" ||
      canonicalJson(latestAttempt) !== canonicalJson(receiptAttempt)
    ) {
      return { actionable: false, reason: "catalog-refresh-not-current", receipt: null };
    }
    return { actionable: true, reason: "verified", receipt };
  }

  private async verifyChain(
    head: RepositoryHead,
    anchor: Anchor,
  ): Promise<
    | { readonly valid: true; readonly entries: readonly AuthenticatedChainEntry[] }
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
    const entries: AuthenticatedChainEntry[] = [];
    let expectedDigest: string | null = head.headDigest;
    let expectedSequence = head.sequence;
    while (expectedDigest !== null) {
      let entry: AuthenticatedChainEntry;
      try {
        entry = parseChainEntry(await readBoundedJson(this.receiptPath(expectedDigest)));
      } catch {
        return { valid: false, reason: "invalid-chain" };
      }
      if (
        sha256(canonicalJson(entry)) !== expectedDigest ||
        entry.sequence !== expectedSequence ||
        entry.trustEpochId !== head.trustEpochId
      ) {
        return { valid: false, reason: "invalid-chain" };
      }
      try {
        if (
          entry.artifactType === "authenticated-evaluation-receipt" &&
          createCatalogRefreshLineageDigest(entry.catalogRefreshLineage) !==
            entry.executionRecord.catalogRefreshLineageDigest
        ) {
          return { valid: false, reason: "invalid-chain" };
        }
      } catch {
        return { valid: false, reason: "invalid-chain" };
      }
      const { authenticationTag, ...body } = entry;
      if (!safeEqual(authenticationTag, hmac(this.key, canonicalJson(body)))) {
        return { valid: false, reason: "invalid-authentication" };
      }
      entries.push(entry);
      expectedDigest = entry.priorHeadDigest;
      expectedSequence -= 1;
    }
    if (expectedSequence !== 0 || entries.length !== head.sequence) {
      return { valid: false, reason: "invalid-chain" };
    }
    return { valid: true, entries };
  }

  private async hasRecordCollision(id: string): Promise<boolean> {
    const directory = path.join(this.evidencePath, "receipts");
    for (const entry of await readdir(directory).catch(() => [] as string[])) {
      if (!entry.endsWith(".json")) continue;
      try {
        const parsed = parseChainEntry(await readBoundedJson(path.join(directory, entry)));
        if (
          parsed.artifactType === "authenticated-evaluation-receipt" &&
          parsed.executionRecord.id === id
        ) {
          return true;
        }
      } catch {
        throw new Error("Execution receipt store contains invalid persisted data.");
      }
    }
    return false;
  }

  private async loadChain(trustEpochId: string): Promise<{
    readonly entries: readonly AuthenticatedChainEntry[];
    readonly head: RepositoryHead | null;
    readonly prior: RepositoryHead | null;
  }> {
    const [head, anchor] = await Promise.all([
      readOptionalJson<RepositoryHead>(this.headPath()),
      readOptionalJson<Anchor>(this.anchorPath),
    ]);
    if (head !== null && anchor !== null) {
      if (!sameHead(head, anchor)) {
        throw new Error("Repository and external execution receipt heads do not match.");
      }
      const verified = await this.verifyChain(head, anchor);
      if (!verified.valid)
        throw new Error(`Existing execution receipt chain is invalid: ${verified.reason}.`);
      if (head.trustEpochId !== trustEpochId) {
        throw new Error("A verified receipt chain cannot change trust epochs implicitly.");
      }
      return { entries: verified.entries, head, prior: head };
    }
    if (anchor !== null) {
      throw new Error("External execution anchor exists without its repository head.");
    }
    // Repository-only history is not actionable without its external exact-head
    // anchor. Preserve it only for rollback if the new epoch cannot be anchored.
    return { entries: [], head, prior: null };
  }

  private async persistEntry<Body extends ChainEntryBody>(
    body: Body,
    previousHead: RepositoryHead | null,
  ): Promise<{
    readonly entry: Body & { readonly authenticationTag: string };
    readonly headDigest: string;
  }> {
    const entry = {
      ...body,
      authenticationTag: hmac(this.key, canonicalJson(body)),
    };
    const headDigest = sha256(canonicalJson(entry));
    const nextHead: RepositoryHead = {
      headDigest,
      sequence: entry.sequence,
      trustEpochId: entry.trustEpochId,
    };
    const nextAnchor: Anchor = {
      ...nextHead,
      authenticationTag: hmac(this.key, canonicalJson(nextHead)),
    };
    const entryPath = this.receiptPath(headDigest);
    await publishImmutable(entryPath, `${JSON.stringify(entry, null, 2)}\n`);
    try {
      await atomicWrite(this.headPath(), `${JSON.stringify(nextHead, null, 2)}\n`);
      await this.advanceAnchor(`${JSON.stringify(nextAnchor, null, 2)}\n`);
    } catch (error: unknown) {
      await this.restoreHead(previousHead);
      await unlink(entryPath).catch(() => undefined);
      throw error;
    }
    return { entry, headDigest };
  }

  protected async advanceAnchor(contents: string): Promise<void> {
    await atomicWrite(this.anchorPath, contents);
  }

  private async restoreHead(head: RepositoryHead | null): Promise<void> {
    if (head === null) {
      await unlink(this.headPath()).catch((error: unknown) => {
        if (!isMissingFileError(error)) throw error;
      });
      return;
    }
    await atomicWrite(this.headPath(), `${JSON.stringify(head, null, 2)}\n`);
  }

  private async ensureDirectories(): Promise<void> {
    await mkdir(this.repositoryRoot, { recursive: true });
    await assertNoSymbolicLinks(this.repositoryRoot, this.evidencePath);
    const receiptsPath = path.join(this.evidencePath, "receipts");
    await mkdir(receiptsPath, { recursive: true });
    await assertNoSymbolicLinks(this.repositoryRoot, receiptsPath);
    await mkdir(path.dirname(this.anchorPath), { recursive: true });
    const [canonicalRoot, canonicalEvidence, canonicalReceipts, canonicalAnchorParent] =
      await Promise.all([
        realpath(this.repositoryRoot),
        realpath(this.evidencePath),
        realpath(receiptsPath),
        realpath(path.dirname(this.anchorPath)),
      ]);
    if (!isWithin(canonicalRoot, canonicalEvidence)) {
      throw new Error("Execution evidence store resolves outside the repository root.");
    }
    if (!isWithin(canonicalEvidence, canonicalReceipts)) {
      throw new Error("Execution receipt directory resolves outside the evidence store.");
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

function sameHead(left: RepositoryHead, right: RepositoryHead): boolean {
  return (
    left.headDigest === right.headDigest &&
    left.sequence === right.sequence &&
    left.trustEpochId === right.trustEpochId
  );
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

function parseCatalogRefreshAttempt(value: unknown): AuthenticatedCatalogRefreshAttempt {
  if (!isRecord(value)) throw new Error("Invalid authenticated catalog refresh attempt.");
  const keys = Object.keys(value).sort().join(",");
  if (
    keys !==
      [
        "artifactType",
        "authenticationTag",
        "invocationId",
        "observation",
        "ordinal",
        "priorHeadDigest",
        "schemaVersion",
        "sequence",
        "trustEpochId",
      ]
        .sort()
        .join(",") ||
    value.artifactType !== "authenticated-catalog-refresh-attempt" ||
    value.schemaVersion !== "1.0.0" ||
    typeof value.authenticationTag !== "string" ||
    !/^hmac-sha256:[0-9a-f]{64}$/.test(value.authenticationTag) ||
    typeof value.invocationId !== "string" ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.invocationId) ||
    !Number.isSafeInteger(value.ordinal) ||
    (value.ordinal as number) < 1 ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    typeof value.trustEpochId !== "string" ||
    (value.priorHeadDigest !== null &&
      (typeof value.priorHeadDigest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(value.priorHeadDigest)))
  ) {
    throw new Error("Invalid authenticated catalog refresh attempt.");
  }
  return {
    artifactType: "authenticated-catalog-refresh-attempt",
    authenticationTag: value.authenticationTag,
    invocationId: value.invocationId,
    observation: refreshObservationSchema.parse(value.observation),
    ordinal: value.ordinal as number,
    priorHeadDigest: value.priorHeadDigest as string | null,
    schemaVersion: "1.0.0",
    sequence: value.sequence as number,
    trustEpochId: value.trustEpochId,
  };
}

function parseChainEntry(value: unknown): AuthenticatedChainEntry {
  if (!isRecord(value)) throw new Error("Invalid execution receipt store entry.");
  return value.artifactType === "authenticated-catalog-refresh-attempt"
    ? parseCatalogRefreshAttempt(value)
    : parseReceipt(value);
}

interface CatalogAttemptCursor {
  readonly invocationId: string;
  readonly observation: RefreshObservation;
  readonly ordinal: number;
}

function latestCatalogAttempt(
  entries: readonly AuthenticatedChainEntry[],
): CatalogAttemptCursor | undefined {
  for (const entry of entries) {
    if (entry.artifactType === "authenticated-catalog-refresh-attempt") {
      return {
        invocationId: entry.invocationId,
        observation: entry.observation,
        ordinal: entry.ordinal,
      };
    }
    const attempt = entry.catalogRefreshLineage.attempts.at(-1);
    if (attempt !== undefined) {
      return {
        invocationId: entry.catalogRefreshLineage.invocationId,
        observation: attempt.observation,
        ordinal: attempt.ordinal,
      };
    }
  }
  return undefined;
}

function assertLineageExtendsAuthenticatedHistory(
  lineage: CatalogRefreshLineage,
  entries: readonly AuthenticatedChainEntry[],
): void {
  const latest = latestCatalogAttempt(entries);
  if (latest === undefined) return;
  const knownAttempts = new Map<number, RefreshObservation>();
  for (const entry of entries) {
    if (
      entry.artifactType === "authenticated-catalog-refresh-attempt" &&
      entry.invocationId === lineage.invocationId
    ) {
      knownAttempts.set(entry.ordinal, entry.observation);
    } else if (
      entry.artifactType === "authenticated-evaluation-receipt" &&
      entry.catalogRefreshLineage.invocationId === lineage.invocationId
    ) {
      for (const attempt of entry.catalogRefreshLineage.attempts) {
        knownAttempts.set(attempt.ordinal, attempt.observation);
      }
    }
  }
  if (latest.invocationId !== lineage.invocationId) {
    if (knownAttempts.size > 0) {
      throw new Error("Catalog refresh lineage cannot roll back to an older invocation.");
    }
    return;
  }
  for (const [ordinal, observation] of knownAttempts) {
    const candidate = lineage.attempts.find((attempt) => attempt.ordinal === ordinal);
    if (
      candidate === undefined ||
      canonicalJson(candidate.observation) !== canonicalJson(observation)
    ) {
      throw new Error("Catalog refresh lineage omits or changes an authenticated attempt.");
    }
  }
  if (
    lineage.terminalOrdinal < latest.ordinal ||
    (latest.observation.status === "failure" && lineage.terminalOrdinal === latest.ordinal)
  ) {
    throw new Error(
      "A failed terminal catalog refresh remains non-actionable until a later success.",
    );
  }
}

async function readBoundedJson(filePath: string): Promise<unknown> {
  const handle = await open(filePath, "r");
  try {
    const contents = Buffer.allocUnsafe(MAX_RECEIPT_BYTES + 1);
    let offset = 0;
    while (offset < contents.byteLength) {
      const { bytesRead } = await handle.read(
        contents,
        offset,
        contents.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_RECEIPT_BYTES) throw new Error("Execution receipt is oversized.");
    return JSON.parse(contents.subarray(0, offset).toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
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
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filePath);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isMissingFileError(error)) throw error;
    });
  }
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

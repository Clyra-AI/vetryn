import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileExecutionReceiptStore } from "../src/evidence-store.js";
import { createCatalogRefreshLineageDigest } from "@vetryn/openrouter";

const roots: string[] = [];
const digest = (character: string) => `sha256:${character.repeat(64)}`;

const refreshSuccess = {
  acquisition: "live-api",
  artifactType: "openrouter-catalog-refresh-observation",
  contentDigest: digest("d"),
  errorCode: null,
  id: "refresh-success",
  normalizerVersion: "1.0.0",
  observedAt: "2026-08-10T00:00:00.000Z",
  reusedSnapshot: false,
  schemaVersion: "1.0.0",
  snapshotId: "catalog-snapshot:openrouter-test",
  source: "openrouter",
  sourceRef: "openrouter-models-api",
  status: "success",
} as const;
const refreshFailure = {
  ...refreshSuccess,
  contentDigest: null,
  errorCode: "fetch-failed",
  id: "refresh-failure",
  snapshotId: null,
  status: "failure",
} as const;
const lineage = {
  attempts: [{ observation: refreshSuccess, ordinal: 1 }],
  invocationId: "invocation-one",
  schemaVersion: "1.0.0",
  terminalOrdinal: 1,
} as const;

const record = {
  artifactContentDigest: digest("a"),
  artifactType: "evaluation-execution-record",
  candidateRunId: "candidate-run:support-classification-test",
  catalogRefreshLineageDigest: createCatalogRefreshLineageDigest(lineage),
  completedAt: "2026-08-10T00:00:02.000Z",
  evaluationInputDigest: digest("c"),
  id: "execution-record:support-classification-test",
  runner: { build: "git:test", id: "vetryn-evaluator", version: "0.1.0" },
  schemaVersion: "1.0.0",
  startedAt: "2026-08-10T00:00:01.000Z",
} as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vetryn-receipts-"));
  roots.push(root);
  const repositoryRoot = path.join(root, "repo");
  const evidencePath = path.join(repositoryRoot, ".vetryn", "evidence");
  const anchorPath = path.join(root, "trust", "anchor.json");
  const key = Buffer.from("offline-test-key-that-is-not-a-credential");
  return {
    anchorPath,
    evidencePath,
    key,
    repositoryRoot,
    store: new FileExecutionReceiptStore({ anchorPath, evidencePath, key, repositoryRoot }),
  };
}

describe("authenticated execution receipt store", () => {
  it("appends and verifies an exact-head authenticated receipt", async () => {
    const { store } = await fixture();
    const appended = await store.append(record, {
      catalogRefreshLineage: lineage,
      trustEpochId: "epoch-one",
    });

    expect(appended.sequence).toBe(1);
    await expect(store.verify(record.id)).resolves.toMatchObject({
      actionable: true,
      reason: "verified",
      receipt: { executionRecord: record, sequence: 1, trustEpochId: "epoch-one" },
    });
    await expect(
      store.append(record, { catalogRefreshLineage: lineage, trustEpochId: "epoch-one" }),
    ).rejects.toThrow(/collision/i);
  });

  it("fails closed on missing anchor, tamper, and rollback", async () => {
    const fixtureState = await fixture();
    const first = await fixtureState.store.append(record, {
      catalogRefreshLineage: lineage,
      trustEpochId: "epoch-one",
    });
    const firstAnchor = await readFile(fixtureState.anchorPath, "utf8");
    const secondRecord = { ...record, id: "execution-record:support-classification-second" };
    const second = await fixtureState.store.append(secondRecord, {
      catalogRefreshLineage: lineage,
      trustEpochId: "epoch-one",
    });

    await writeFile(fixtureState.anchorPath, firstAnchor);
    await expect(fixtureState.store.verify(secondRecord.id)).resolves.toMatchObject({
      actionable: false,
      reason: "anchor-head-mismatch",
    });

    const receiptPath = path.join(
      fixtureState.evidencePath,
      "receipts",
      `${second.headDigest.slice("sha256:".length)}.json`,
    );
    await writeFile(receiptPath, `${JSON.stringify({ forged: true })}\n`);
    await expect(fixtureState.store.verify(secondRecord.id)).resolves.toMatchObject({
      actionable: false,
      reason: "anchor-head-mismatch",
    });

    await unlink(fixtureState.anchorPath);
    await expect(fixtureState.store.verify(first.executionRecordId)).resolves.toEqual({
      actionable: false,
      reason: "missing-trust-state",
      receipt: null,
    });
  });

  it("starts a new epoch without making prior unanchored receipts actionable", async () => {
    const fixtureState = await fixture();
    await fixtureState.store.append(record, {
      catalogRefreshLineage: lineage,
      trustEpochId: "epoch-one",
    });
    await unlink(fixtureState.anchorPath);
    const nextRecord = { ...record, id: "execution-record:support-classification-fresh" };
    const fresh = await fixtureState.store.append(nextRecord, {
      catalogRefreshLineage: lineage,
      trustEpochId: "epoch-two",
    });

    expect(fresh).toMatchObject({ sequence: 1, trustEpochId: "epoch-two" });
    await expect(fixtureState.store.verify(nextRecord.id)).resolves.toMatchObject({
      actionable: true,
    });
    await expect(fixtureState.store.verify(record.id)).resolves.toMatchObject({
      actionable: false,
      reason: "record-not-in-current-epoch",
    });
  });

  it("restores the prior repository head when the external anchor cannot advance", async () => {
    const fixtureState = await fixture();
    const first = await fixtureState.store.append(record, {
      catalogRefreshLineage: lineage,
      trustEpochId: "epoch-one",
    });
    const headPath = path.join(fixtureState.evidencePath, "head.json");
    const priorHead = await readFile(headPath, "utf8");
    const secondRecord = { ...record, id: "execution-record:support-classification-retry" };
    class FailingAnchorStore extends FileExecutionReceiptStore {
      protected override async advanceAnchor(): Promise<void> {
        throw new Error("injected external anchor failure");
      }
    }
    const failingStore = new FailingAnchorStore({
      anchorPath: fixtureState.anchorPath,
      evidencePath: fixtureState.evidencePath,
      key: fixtureState.key,
      repositoryRoot: fixtureState.repositoryRoot,
    });

    await expect(
      failingStore.append(secondRecord, {
        catalogRefreshLineage: lineage,
        trustEpochId: "epoch-one",
      }),
    ).rejects.toThrow(/injected external anchor failure/i);
    await expect(readFile(headPath, "utf8")).resolves.toBe(priorHead);
    await expect(fixtureState.store.verify(first.executionRecordId)).resolves.toMatchObject({
      actionable: true,
    });
    await expect(fixtureState.store.verify(secondRecord.id)).resolves.toMatchObject({
      actionable: false,
      reason: "record-not-in-current-epoch",
    });

    await expect(
      fixtureState.store.append(secondRecord, {
        catalogRefreshLineage: lineage,
        trustEpochId: "epoch-one",
      }),
    ).resolves.toMatchObject({ sequence: 2 });
  });

  it("rejects symlink paths that cross repository and external-anchor boundaries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vetryn-receipt-links-"));
    roots.push(root);
    const repositoryRoot = path.join(root, "repo");
    const external = path.join(root, "external");
    await mkdir(repositoryRoot, { recursive: true });
    await mkdir(external, { recursive: true });
    await symlink(external, path.join(repositoryRoot, ".vetryn"));
    const evidenceSymlinkStore = new FileExecutionReceiptStore({
      anchorPath: path.join(root, "trust", "anchor.json"),
      evidencePath: path.join(repositoryRoot, ".vetryn", "evidence"),
      key: Buffer.from("offline-test-key-that-is-not-a-credential"),
      repositoryRoot,
    });
    await expect(
      evidenceSymlinkStore.append(record, {
        catalogRefreshLineage: lineage,
        trustEpochId: "epoch-one",
      }),
    ).rejects.toThrow(/symbolic-link|outside/i);

    await unlink(path.join(repositoryRoot, ".vetryn"));
    const repositoryTrust = path.join(repositoryRoot, "trust");
    await mkdir(repositoryTrust, { recursive: true });
    await symlink(repositoryTrust, path.join(root, "anchor-link"));
    const anchorSymlinkStore = new FileExecutionReceiptStore({
      anchorPath: path.join(root, "anchor-link", "anchor.json"),
      evidencePath: path.join(repositoryRoot, ".vetryn", "evidence"),
      key: Buffer.from("offline-test-key-that-is-not-a-credential"),
      repositoryRoot,
    });
    await expect(
      anchorSymlinkStore.append(record, {
        catalogRefreshLineage: lineage,
        trustEpochId: "epoch-one",
      }),
    ).rejects.toThrow(/inside repository-controlled/i);
  });

  it("rejects success followed by failure, omitted attempts, and lineage gaps", async () => {
    const fixtureState = await fixture();
    const invalidLineages = [
      {
        ...lineage,
        attempts: [...lineage.attempts, { observation: refreshFailure, ordinal: 2 }],
        terminalOrdinal: 2,
      },
      { ...lineage, attempts: [{ observation: refreshSuccess, ordinal: 2 }] },
      {
        ...lineage,
        attempts: [
          { observation: refreshFailure, ordinal: 1 },
          { observation: refreshSuccess, ordinal: 3 },
        ],
        terminalOrdinal: 3,
      },
    ];
    for (const invalidLineage of invalidLineages) {
      await expect(
        fixtureState.store.append(record, {
          catalogRefreshLineage: invalidLineage,
          trustEpochId: "epoch-one",
        }),
      ).rejects.toThrow();
    }
  });

  it("authenticates later refresh failure and detects omission, deletion, rollback, and forks", async () => {
    const fixtureState = await fixture();
    const first = await fixtureState.store.append(record, {
      catalogRefreshLineage: lineage,
      trustEpochId: "epoch-one",
    });
    const headPath = path.join(fixtureState.evidencePath, "head.json");
    const oldHead = await readFile(headPath, "utf8");
    const oldAnchor = await readFile(fixtureState.anchorPath, "utf8");

    const failure = await fixtureState.store.appendCatalogRefreshAttempt(refreshFailure, {
      invocationId: "invocation-two",
      ordinal: 1,
      trustEpochId: "epoch-one",
    });
    const failureHead = await readFile(headPath, "utf8");
    const failureAnchor = await readFile(fixtureState.anchorPath, "utf8");
    const failurePath = path.join(
      fixtureState.evidencePath,
      "receipts",
      `${failure.headDigest.slice("sha256:".length)}.json`,
    );
    const failureEntry = await readFile(failurePath, "utf8");

    await expect(fixtureState.store.verify(first.executionRecordId)).resolves.toMatchObject({
      actionable: false,
      reason: "catalog-refresh-not-current",
    });
    await expect(
      fixtureState.store.append(
        { ...record, id: "execution-record:omitted-refresh-failure" },
        { catalogRefreshLineage: lineage, trustEpochId: "epoch-one" },
      ),
    ).rejects.toThrow(/roll back|omits/i);

    await unlink(failurePath);
    await expect(fixtureState.store.verify(first.executionRecordId)).resolves.toMatchObject({
      actionable: false,
      reason: "invalid-chain",
    });
    await writeFile(failurePath, failureEntry);

    await writeFile(headPath, oldHead);
    await expect(fixtureState.store.verify(first.executionRecordId)).resolves.toMatchObject({
      actionable: false,
      reason: "anchor-head-mismatch",
    });

    await writeFile(fixtureState.anchorPath, oldAnchor);
    await fixtureState.store.appendCatalogRefreshAttempt(
      { ...refreshFailure, id: "refresh-fork" },
      { invocationId: "invocation-two", ordinal: 1, trustEpochId: "epoch-one" },
    );
    await writeFile(fixtureState.anchorPath, failureAnchor);
    await expect(fixtureState.store.verify(first.executionRecordId)).resolves.toMatchObject({
      actionable: false,
      reason: "anchor-head-mismatch",
    });

    await writeFile(headPath, failureHead);
    await writeFile(fixtureState.anchorPath, failureAnchor);
    await expect(fixtureState.store.verify(first.executionRecordId)).resolves.toMatchObject({
      actionable: false,
      reason: "catalog-refresh-not-current",
    });
  });
});

import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { createGitHubReviewAuthenticator } from "./github-review-auth.mjs";

const commit = "a".repeat(40);
const approval = {
  id: 123456789,
  state: "APPROVED",
  user: { login: "maintainer-reviewer" },
  author_association: "MEMBER",
  commit_id: commit,
  submitted_at: "2026-08-10T00:00:00Z",
  html_url: "https://github.com/Clyra-AI/vetryn/pull/1#pullrequestreview-123456789",
  pull_request_url: "https://api.github.com/repos/Clyra-AI/vetryn/pulls/1",
};
const ownerCommentId = 987654321;
const contributorCommentId = 5242139438;

function bootstrapBody(overrides = {}) {
  const values = {
    repository: "Clyra-AI/vetryn",
    pull_request: "5",
    task_id: "V1-00",
    candidate_sha: commit,
    decision: "APPROVED",
    roles: "maintainer,trust-reviewer",
    ...overrides,
  };
  return [
    "<!-- vetryn-bootstrap-review:v1 -->",
    `repository=${values.repository}`,
    `pull_request=${values.pull_request}`,
    `task_id=${values.task_id}`,
    `candidate_sha=${values.candidate_sha}`,
    `decision=${values.decision}`,
    `roles=${values.roles}`,
  ].join("\n");
}

const ownerComment = {
  id: ownerCommentId,
  user: { login: "implementation-agent" },
  author_association: "OWNER",
  body: bootstrapBody(),
  html_url: `https://github.com/Clyra-AI/vetryn/pull/5#issuecomment-${ownerCommentId}`,
  issue_url: "https://api.github.com/repos/Clyra-AI/vetryn/issues/5",
};
const candidateLedger = {
  schemaVersion: "1.0.0",
  planId: "oss-v1",
  items: [
    {
      id: "PLAN-001",
      taskId: "V1-00",
      statement: "Reviewed criterion",
      verification: { method: "review", gateId: "QG-INDEPENDENT-VERIFY" },
      waivable: false,
      status: "verification_pending",
      evidenceRefs: [],
    },
    {
      id: "CONTRACT-001",
      taskId: "V1-01",
      statement: "Another task criterion",
      verification: { method: "test", gateId: "QG-CONTRACTS" },
      waivable: false,
      status: "planned",
      evidenceRefs: [],
    },
  ],
};

function evidence(overrides = {}) {
  return {
    id: "ev-review",
    taskId: "V1-00",
    actor: "maintainer-reviewer",
    commit,
    review: {
      role: "maintainer",
      reviewId: 123456789,
      subjectActor: "implementation-agent",
      source: "github-pull-request-review",
      state: "APPROVED",
      observedCommit: commit,
      authorAssociation: "MEMBER",
      authorizationRef: "https://github.com/Clyra-AI/vetryn/pull/1#pullrequestreview-123456789",
    },
    ...overrides,
  };
}

function bootstrapEvidence(overrides = {}) {
  return evidence({
    actor: "implementation-agent",
    review: {
      role: "maintainer",
      subjectActor: "implementation-agent",
      source: "github-bootstrap-owner-comment",
      state: "APPROVED",
      authorAssociation: "OWNER",
      commentId: ownerCommentId,
      observedCommit: commit,
      authorizationBody: bootstrapBody(),
      authorizationRef: `https://github.com/Clyra-AI/vetryn/pull/5#issuecomment-${ownerCommentId}`,
    },
    ...overrides,
  });
}

function responseFor(body, status = 200) {
  return new globalThis.Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
}

function githubFetch({
  reviewHistory = [approval],
  issueComment = ownerComment,
  headSha = commit,
  merged = false,
  mergeCommitSha = null,
  pullRequestAuthor = "implementation-agent",
  comparison = {
    status: "ahead",
    merge_base_commit: { sha: commit },
    total_commits: 1,
    commits: [{ sha: "b".repeat(40) }],
    files: [
      { filename: "product/plans/oss-v1/state/V1-00.json" },
      {
        status: "added",
        filename: "product/plans/oss-v1/evidence/ev-review.json",
      },
    ],
  },
  addedEvidence = { id: "ev-review", taskId: "V1-00" },
  ledgerAtCandidate = candidateLedger,
  ledgerAtHead = candidateLedger,
  codeowners = "* @maintainer-reviewer\n/.github/ @maintainer-reviewer\n/SECURITY.md @maintainer-reviewer\n",
} = {}) {
  return vi.fn(async (input) => {
    const url = String(input);
    if (url.includes("CODEOWNERS")) return responseFor(codeowners);
    if (url.includes("acceptance-ledger.json"))
      return responseFor(url.includes(`/${commit}/`) ? ledgerAtCandidate : ledgerAtHead);
    if (url.includes("/evidence/")) return responseFor(addedEvidence);
    if (url.includes("/compare/")) return responseFor(comparison);
    if (url.includes("/issues/comments/")) return responseFor(issueComment);
    if (url.includes("/reviews?")) return responseFor(reviewHistory);
    return responseFor({
      head: { sha: headSha },
      user: { login: pullRequestAuthor },
      merged,
      merge_commit_sha: mergeCommitSha,
    });
  });
}

function authenticator({ fetchImpl = githubFetch(), checkoutCommit = commit } = {}) {
  return createGitHubReviewAuthenticator({
    fetchImpl,
    checkoutProvider: () => ({ commit: checkoutCommit }),
  });
}

describe("GitHub review authentication", () => {
  it("does not invoke a PATH-resolved evidence collector", async () => {
    const source = await readFile(
      new globalThis.URL("./github-review-auth.mjs", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("spawnSync");
    expect(source).not.toContain('"curl"');
  });

  it("accepts the latest current-head approval from a role-owning reviewer", async () => {
    const fetchImpl = githubFetch();
    const authenticate = authenticator({ fetchImpl });

    await expect(authenticate(evidence(), "maintainer", "fixture")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).not.toContain(
      "https://api.github.com/repos/Clyra-AI/vetryn/pulls/1/reviews/123456789",
    );
  });

  it("accepts an exact-head bootstrap owner comment for a named role from the PR author", async () => {
    const fetchImpl = githubFetch({
      codeowners: "* @implementation-agent\n/.github/ @implementation-agent\n",
    });
    const authenticate = authenticator({ fetchImpl });

    await expect(
      authenticate(bootstrapEvidence(), "maintainer", "fixture"),
    ).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toContain(
      `https://api.github.com/repos/Clyra-AI/vetryn/issues/comments/${ownerCommentId}`,
    );
  });

  it("accepts MEMBER association for the same exact-bound bootstrap path", async () => {
    const memberComment = { ...ownerComment, author_association: "MEMBER" };
    const memberEvidence = bootstrapEvidence({
      review: { ...bootstrapEvidence().review, authorAssociation: "MEMBER" },
    });
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        issueComment: memberComment,
        codeowners: "* @implementation-agent\n/.github/ @implementation-agent\n",
      }),
    });

    await expect(authenticate(memberEvidence, "maintainer", "fixture")).resolves.toBeUndefined();
  });

  it("accepts public CONTRIBUTOR provenance when protected-main CODEOWNERS authorizes the actor", async () => {
    const contributorComment = {
      ...ownerComment,
      id: contributorCommentId,
      author_association: "CONTRIBUTOR",
      html_url: `https://github.com/Clyra-AI/vetryn/pull/5#issuecomment-${contributorCommentId}`,
    };
    const contributorEvidence = bootstrapEvidence({
      review: {
        ...bootstrapEvidence().review,
        authorAssociation: "CONTRIBUTOR",
        commentId: contributorCommentId,
        authorizationRef: `https://github.com/Clyra-AI/vetryn/pull/5#issuecomment-${contributorCommentId}`,
      },
    });
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        issueComment: contributorComment,
        codeowners: "* @implementation-agent\n/.github/ @implementation-agent\n",
      }),
    });

    await expect(
      authenticate(contributorEvidence, "maintainer", "fixture"),
    ).resolves.toBeUndefined();
  });

  it("rejects public CONTRIBUTOR provenance when protected-main CODEOWNERS does not authorize the actor", async () => {
    const contributorComment = {
      ...ownerComment,
      id: contributorCommentId,
      author_association: "CONTRIBUTOR",
      html_url: `https://github.com/Clyra-AI/vetryn/pull/5#issuecomment-${contributorCommentId}`,
    };
    const contributorEvidence = bootstrapEvidence({
      review: {
        ...bootstrapEvidence().review,
        authorAssociation: "CONTRIBUTOR",
        commentId: contributorCommentId,
        authorizationRef: `https://github.com/Clyra-AI/vetryn/pull/5#issuecomment-${contributorCommentId}`,
      },
    });
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        issueComment: contributorComment,
        codeowners: "* @different-owner\n",
      }),
    });

    await expect(authenticate(contributorEvidence, "maintainer", "fixture")).rejects.toThrow(
      "not authorized for role maintainer by trusted main-branch CODEOWNERS",
    );
  });

  it("authenticates one bootstrap owner comment once when it authorizes multiple roles", async () => {
    const fetchImpl = githubFetch({
      codeowners: "* @implementation-agent\n/.github/ @implementation-agent\n",
    });
    const authenticate = authenticator({ fetchImpl });
    const trustEvidence = bootstrapEvidence({
      id: "ev-bootstrap-trust",
      review: { ...bootstrapEvidence().review, role: "trust-reviewer" },
    });

    await authenticate(bootstrapEvidence(), "maintainer", "maintainer fixture");
    await authenticate(trustEvidence, "trust-reviewer", "trust fixture");

    expect(
      fetchImpl.mock.calls.filter(([url]) => String(url).includes("/issues/comments/")),
    ).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["repository", bootstrapBody({ repository: "Clyra-AI/other" }), "different repository"],
    ["pull request", bootstrapBody({ pull_request: "6" }), "different repository or pull request"],
    ["task", bootstrapBody({ task_id: "V1-01" }), "different task"],
    ["candidate", bootstrapBody({ candidate_sha: "b".repeat(40) }), "different candidate"],
    ["decision", bootstrapBody({ decision: "CHANGES_REQUESTED" }), "not an APPROVED"],
    ["role", bootstrapBody({ roles: "trust-reviewer" }), "does not authorize role maintainer"],
    [
      "extra field",
      `${bootstrapBody()}\nextra=forbidden`,
      "malformed bootstrap authorization body",
    ],
  ])("rejects a bootstrap comment with the wrong %s binding", async (_name, body, expected) => {
    const bootstrap = bootstrapEvidence({
      review: { ...bootstrapEvidence().review, authorizationBody: body },
    });
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        issueComment: { ...ownerComment, body },
        codeowners: "* @implementation-agent\n/.github/ @implementation-agent\n",
      }),
    });

    await expect(authenticate(bootstrap, "maintainer", "fixture")).rejects.toThrow(expected);
  });

  it("rejects a bootstrap comment whose durable GitHub body changed", async () => {
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        issueComment: { ...ownerComment, body: bootstrapBody({ roles: "trust-reviewer" }) },
      }),
    });

    await expect(authenticate(bootstrapEvidence(), "maintainer", "fixture")).rejects.toThrow(
      "does not match the current durable comment body",
    );
  });

  it("rejects a bootstrap comment from a different actor", async () => {
    const wrongActor = authenticator({
      fetchImpl: githubFetch({
        issueComment: { ...ownerComment, user: { login: "different-owner" } },
      }),
    });

    await expect(wrongActor(bootstrapEvidence(), "maintainer", "fixture")).rejects.toThrow(
      "does not match the authenticated bootstrap owner",
    );
  });

  it.each(["COLLABORATOR", "NONE"])(
    "rejects %s association on the bootstrap path",
    async (authorAssociation) => {
      const disallowedComment = { ...ownerComment, author_association: authorAssociation };
      const disallowedEvidence = bootstrapEvidence({
        review: { ...bootstrapEvidence().review, authorAssociation },
      });
      const authenticate = authenticator({
        fetchImpl: githubFetch({ issueComment: disallowedComment }),
      });

      await expect(authenticate(disallowedEvidence, "maintainer", "fixture")).rejects.toThrow(
        "has unsupported public association provenance",
      );
    },
  );

  it("rejects a bootstrap association claim that differs from GitHub", async () => {
    const memberEvidence = bootstrapEvidence({
      review: { ...bootstrapEvidence().review, authorAssociation: "MEMBER" },
    });

    await expect(authenticator()(memberEvidence, "maintainer", "fixture")).rejects.toThrow(
      "has mismatched or unsupported public association provenance",
    );
  });

  it("rejects a bootstrap comment whose source, ID, URL, PR author, or CODEOWNER binding is wrong", async () => {
    const unsupported = bootstrapEvidence({
      review: { ...bootstrapEvidence().review, source: "github-issue-comment" },
    });
    const wrongId = bootstrapEvidence({
      review: { ...bootstrapEvidence().review, commentId: ownerCommentId + 1 },
    });
    const wrongAuthor = bootstrapEvidence({
      review: { ...bootstrapEvidence().review, subjectActor: "different-author" },
    });
    const wrongRole = bootstrapEvidence({
      review: { ...bootstrapEvidence().review, role: "trust-reviewer" },
    });
    const wrongState = bootstrapEvidence({
      review: { ...bootstrapEvidence().review, state: "CHANGES_REQUESTED" },
    });

    await expect(authenticator()(unsupported, "maintainer", "source fixture")).rejects.toThrow(
      "unsupported source",
    );
    await expect(authenticator()(wrongId, "maintainer", "ID fixture")).rejects.toThrow(
      "does not match the authenticated comment ID",
    );
    await expect(authenticator()(wrongAuthor, "maintainer", "author fixture")).rejects.toThrow(
      "does not name the authenticated candidate PR author",
    );
    await expect(authenticator()(wrongRole, "maintainer", "role fixture")).rejects.toThrow(
      "does not declare role maintainer",
    );
    await expect(authenticator()(wrongState, "maintainer", "state fixture")).rejects.toThrow(
      "is not declared APPROVED",
    );
    await expect(
      authenticator({
        fetchImpl: githubFetch({
          issueComment: {
            ...ownerComment,
            issue_url: "https://api.github.com/repos/Clyra-AI/vetryn/issues/6",
          },
        }),
      })(bootstrapEvidence(), "maintainer", "URL fixture"),
    ).rejects.toThrow("authenticated for a different pull request");
    await expect(
      authenticator({
        fetchImpl: githubFetch({ codeowners: "* @different-owner\n" }),
      })(bootstrapEvidence(), "maintainer", "CODEOWNERS fixture"),
    ).rejects.toThrow("not authorized for role maintainer");
  });

  it("keeps the ordinary pull-request review path separated from the executor", async () => {
    const selfReview = evidence({ actor: "implementation-agent" });

    await expect(authenticator()(selfReview, "maintainer", "fixture")).rejects.toThrow(
      "self-approved by the executor",
    );
  });

  it("authenticates multiple cited approvals from one bounded PR history request", async () => {
    const secondApproval = {
      ...approval,
      id: 123456790,
      user: { login: "second-reviewer" },
      html_url: "https://github.com/Clyra-AI/vetryn/pull/1#pullrequestreview-123456790",
    };
    const fetchImpl = githubFetch({
      reviewHistory: [approval, secondApproval],
      codeowners:
        "* @maintainer-reviewer @second-reviewer\n/.github/ @maintainer-reviewer @second-reviewer\n",
    });
    const authenticate = authenticator({ fetchImpl });
    const secondEvidence = evidence({
      id: "ev-review-two",
      actor: "second-reviewer",
      review: {
        ...evidence().review,
        reviewId: 123456790,
        authorizationRef: "https://github.com/Clyra-AI/vetryn/pull/1#pullrequestreview-123456790",
      },
    });

    await authenticate(evidence(), "maintainer", "fixture one");
    await authenticate(secondEvidence, "maintainer", "fixture two");

    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("/reviews?"))).toHaveLength(
      1,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails closed when GitHub history cannot authenticate the cited review", async () => {
    const authenticate = authenticator({
      fetchImpl: githubFetch({ reviewHistory: [] }),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "could not be authenticated from GitHub review history",
    );
  });

  it("rejects reviewer identity that differs from GitHub", async () => {
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        reviewHistory: [{ ...approval, user: { login: "actual-reviewer" } }],
      }),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "does not match the authenticated reviewer",
    );
  });

  it("rejects an executor identity that differs from the authenticated PR author", async () => {
    const authenticate = authenticator({
      fetchImpl: githubFetch({ pullRequestAuthor: "actual-executor" }),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "does not name the authenticated candidate PR author",
    );
  });

  it("rejects a reviewer who does not own the required protected surface", async () => {
    const authenticate = authenticator({
      fetchImpl: githubFetch({ codeowners: "* @different-reviewer\n" }),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "not authorized for role maintainer",
    );
  });

  it("rejects an approval superseded by changes requested", async () => {
    const changesRequested = {
      ...approval,
      id: 123456790,
      state: "CHANGES_REQUESTED",
      submitted_at: "2026-08-10T00:01:00Z",
    };
    const authenticate = authenticator({
      fetchImpl: githubFetch({ reviewHistory: [approval, changesRequested] }),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "superseded by the reviewer's current decision",
    );
  });

  it("accepts an approval followed only by a canonical promotion commit", async () => {
    const authenticate = authenticator({
      fetchImpl: githubFetch({ headSha: "b".repeat(40) }),
      checkoutCommit: "b".repeat(40),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).resolves.toBeUndefined();
  });

  it("accepts GitHub's authenticated synthetic merge checkout for an open PR", async () => {
    const syntheticMerge = "b".repeat(40);
    const authenticate = authenticator({
      fetchImpl: githubFetch({ mergeCommitSha: syntheticMerge }),
      checkoutCommit: syntheticMerge,
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).resolves.toBeUndefined();
  });

  it("rejects a promotion tail that changes product code", async () => {
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        headSha: "b".repeat(40),
        comparison: {
          status: "ahead",
          merge_base_commit: { sha: commit },
          total_commits: 1,
          commits: [{ sha: "b".repeat(40) }],
          files: [{ filename: "packages/core/src/index.ts" }],
        },
      }),
      checkoutCommit: "b".repeat(40),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "changes forbidden path packages/core/src/index.ts",
    );
  });

  it("rejects mutation of evidence that existed at the reviewed candidate", async () => {
    const advancedHead = "b".repeat(40);
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        headSha: advancedHead,
        comparison: {
          status: "ahead",
          merge_base_commit: { sha: commit },
          total_commits: 1,
          commits: [{ sha: advancedHead }],
          files: [
            {
              status: "modified",
              filename: "product/plans/oss-v1/evidence/ev-existing.json",
            },
          ],
        },
      }),
      checkoutCommit: advancedHead,
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "mutates existing evidence product/plans/oss-v1/evidence/ev-existing.json",
    );
  });

  it("rejects newly added evidence for another task", async () => {
    const advancedHead = "b".repeat(40);
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        headSha: advancedHead,
        addedEvidence: { id: "ev-other", taskId: "V1-01" },
        comparison: {
          status: "ahead",
          merge_base_commit: { sha: commit },
          total_commits: 1,
          commits: [{ sha: advancedHead }],
          files: [
            {
              status: "added",
              filename: "product/plans/oss-v1/evidence/ev-other.json",
            },
          ],
        },
      }),
      checkoutCommit: advancedHead,
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "adds evidence outside task V1-00",
    );
  });

  it("accepts task-scoped status and evidence changes in the promotion ledger", async () => {
    const advancedHead = "b".repeat(40);
    const promotedLedger = globalThis.structuredClone(candidateLedger);
    promotedLedger.items[0].status = "accepted";
    promotedLedger.items[0].evidenceRefs = ["ev-review"];
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        headSha: advancedHead,
        comparison: {
          status: "ahead",
          merge_base_commit: { sha: commit },
          total_commits: 1,
          commits: [{ sha: advancedHead }],
          files: [{ filename: "product/plans/oss-v1/acceptance-ledger.json" }],
        },
        ledgerAtHead: promotedLedger,
      }),
      checkoutCommit: advancedHead,
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).resolves.toBeUndefined();
  });

  it("rejects promotion ledger changes for another task", async () => {
    const advancedHead = "b".repeat(40);
    const promotedLedger = globalThis.structuredClone(candidateLedger);
    promotedLedger.items[1].status = "accepted";
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        headSha: advancedHead,
        comparison: {
          status: "ahead",
          merge_base_commit: { sha: commit },
          total_commits: 1,
          commits: [{ sha: advancedHead }],
          files: [{ filename: "product/plans/oss-v1/acceptance-ledger.json" }],
        },
        ledgerAtHead: promotedLedger,
      }),
      checkoutCommit: advancedHead,
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "changes ledger item CONTRACT-001 for another task",
    );
  });

  it("rejects promotion changes to a reviewed ledger field", async () => {
    const advancedHead = "b".repeat(40);
    const promotedLedger = globalThis.structuredClone(candidateLedger);
    promotedLedger.items[0].verification.gateId = "QG-REPO-CHECK";
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        headSha: advancedHead,
        comparison: {
          status: "ahead",
          merge_base_commit: { sha: commit },
          total_commits: 1,
          commits: [{ sha: advancedHead }],
          files: [{ filename: "product/plans/oss-v1/acceptance-ledger.json" }],
        },
        ledgerAtHead: promotedLedger,
      }),
      checkoutCommit: advancedHead,
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "changes reviewed ledger item PLAN-001",
    );
  });

  it("rejects a promotion head that does not descend from the approved candidate", async () => {
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        headSha: "b".repeat(40),
        comparison: {
          status: "diverged",
          merge_base_commit: { sha: "c".repeat(40) },
          total_commits: 1,
          commits: [{ sha: "b".repeat(40) }],
          files: [{ filename: "product/plans/oss-v1/state/V1-00.json" }],
        },
      }),
      checkoutCommit: "b".repeat(40),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "is not an ancestor of the current pull request head",
    );
  });

  it("fails closed on unsupported protected-main CODEOWNERS patterns", async () => {
    const authenticate = authenticator({
      fetchImpl: githubFetch({ codeowners: "*.md @maintainer-reviewer\n" }),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "unsupported pattern",
    );
  });

  it("rejects an open review pull request unrelated to the validated checkout", async () => {
    const authenticate = authenticator({ checkoutCommit: "b".repeat(40) });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "authenticated review pull request is unrelated to checkout",
    );
  });

  it("accepts durable evidence after its authenticated pull request is merged", async () => {
    const mergeCommit = "c".repeat(40);
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        merged: true,
        mergeCommitSha: mergeCommit,
        comparison: {
          status: "ahead",
          merge_base_commit: { sha: mergeCommit },
          total_commits: 1,
          commits: [{ sha: "d".repeat(40) }],
          files: [],
        },
      }),
      checkoutCommit: "d".repeat(40),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).resolves.toBeUndefined();
  });

  it("rejects a rename whose source is outside canonical promotion paths", async () => {
    const advancedHead = "b".repeat(40);
    const authenticate = authenticator({
      fetchImpl: githubFetch({
        headSha: advancedHead,
        comparison: {
          status: "ahead",
          merge_base_commit: { sha: commit },
          total_commits: 1,
          commits: [{ sha: advancedHead }],
          files: [
            {
              status: "renamed",
              filename: "product/plans/oss-v1/evidence/ev-review.json",
              previous_filename: "packages/core/src/index.ts",
            },
          ],
        },
      }),
      checkoutCommit: advancedHead,
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "changes forbidden path packages/core/src/index.ts",
    );
  });
});

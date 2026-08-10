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

function evidence(overrides = {}) {
  return {
    id: "ev-review",
    taskId: "V1-00",
    actor: "maintainer-reviewer",
    commit,
    review: {
      reviewId: 123456789,
      observedCommit: commit,
      authorAssociation: "MEMBER",
      authorizationRef: "https://github.com/Clyra-AI/vetryn/pull/1#pullrequestreview-123456789",
    },
    ...overrides,
  };
}

function responseFor(body, status = 200) {
  return new globalThis.Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
}

function githubFetch({
  exactReview = approval,
  reviewHistory = [approval],
  headSha = commit,
  comparison = {
    status: "ahead",
    merge_base_commit: { sha: commit },
    total_commits: 1,
    commits: [{ sha: "b".repeat(40) }],
    files: [
      { filename: "product/plans/oss-v1/state/V1-00.json" },
      { filename: "product/plans/oss-v1/evidence/ev-review.json" },
    ],
  },
  codeowners = "* @maintainer-reviewer\n/.github/ @maintainer-reviewer\n/SECURITY.md @maintainer-reviewer\n",
} = {}) {
  return vi.fn(async (input) => {
    const url = String(input);
    if (url.includes("CODEOWNERS")) return responseFor(codeowners);
    if (url.includes("/compare/")) return responseFor(comparison);
    if (url.includes("/reviews?")) return responseFor(reviewHistory);
    if (url.includes("/reviews/")) return responseFor(exactReview);
    return responseFor({ head: { sha: headSha } });
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
    const authenticate = createGitHubReviewAuthenticator({ fetchImpl });

    await expect(authenticate(evidence(), "maintainer", "fixture")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("fails closed when GitHub cannot authenticate the cited review", async () => {
    const authenticate = createGitHubReviewAuthenticator({
      fetchImpl: vi.fn(async () => responseFor("", 404)),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "could not be authenticated by GitHub",
    );
  });

  it("rejects reviewer identity that differs from GitHub", async () => {
    const authenticate = createGitHubReviewAuthenticator({
      fetchImpl: githubFetch({
        exactReview: { ...approval, user: { login: "actual-reviewer" } },
      }),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "does not match the authenticated reviewer",
    );
  });

  it("rejects a reviewer who does not own the required protected surface", async () => {
    const authenticate = createGitHubReviewAuthenticator({
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
    const authenticate = createGitHubReviewAuthenticator({
      fetchImpl: githubFetch({ reviewHistory: [approval, changesRequested] }),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "superseded by the reviewer's current decision",
    );
  });

  it("accepts an approval followed only by a canonical promotion commit", async () => {
    const authenticate = createGitHubReviewAuthenticator({
      fetchImpl: githubFetch({ headSha: "b".repeat(40) }),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).resolves.toBeUndefined();
  });

  it("rejects a promotion tail that changes product code", async () => {
    const authenticate = createGitHubReviewAuthenticator({
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
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "changes forbidden path packages/core/src/index.ts",
    );
  });

  it("rejects a promotion head that does not descend from the approved candidate", async () => {
    const authenticate = createGitHubReviewAuthenticator({
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
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "is not an ancestor of the current pull request head",
    );
  });

  it("fails closed on unsupported protected-main CODEOWNERS patterns", async () => {
    const authenticate = createGitHubReviewAuthenticator({
      fetchImpl: githubFetch({ codeowners: "*.md @maintainer-reviewer\n" }),
    });

    await expect(authenticate(evidence(), "maintainer", "fixture")).rejects.toThrow(
      "unsupported pattern",
    );
  });
});

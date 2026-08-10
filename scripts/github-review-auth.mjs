const githubRepository = "Clyra-AI/vetryn";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function fetchPublicGitHub(url, failureMessage, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "vetryn-plan-validator",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(10_000),
    });
  } catch {
    fail(failureMessage);
  }
  assert(response.ok, failureMessage);
  return response.text();
}

async function fetchPublicGitHubJson(url, failureMessage, fetchImpl) {
  const response = await fetchPublicGitHub(url, failureMessage, fetchImpl);
  try {
    return JSON.parse(response);
  } catch {
    fail(`${failureMessage}; GitHub returned invalid JSON`);
  }
}

function codeownersForPath(codeowners, targetPath) {
  let owners = [];
  for (const rawLine of codeowners.split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const [pattern, ...principals] = line.split(/\s+/);
    const supportedPattern =
      pattern === "*" ||
      (pattern.startsWith("/") &&
        !["?", "*", "[", "]"].some((token) => pattern.slice(1).includes(token)));
    assert(supportedPattern, `trusted main-branch CODEOWNERS uses unsupported pattern ${pattern}`);
    const matches =
      pattern === "*" ||
      (pattern.startsWith("/") && pattern.endsWith("/")
        ? targetPath.startsWith(pattern.slice(1))
        : pattern.startsWith("/") && targetPath === pattern.slice(1));
    if (matches) owners = principals;
  }
  return owners;
}

function isAllowedPromotionPath(filename, taskId) {
  return (
    filename === `product/plans/oss-v1/state/${taskId}.json` ||
    filename === "product/plans/oss-v1/acceptance-ledger.json" ||
    filename === "product/plans/oss-v1/progress.json" ||
    /^product\/plans\/oss-v1\/evidence\/[^/]+\.json$/.test(filename)
  );
}

function assertLedgerPromotion(candidateLedger, promotedLedger, taskId, source, evidenceId) {
  const candidateHeader = { ...candidateLedger, items: undefined };
  const promotedHeader = { ...promotedLedger, items: undefined };
  assert(
    JSON.stringify(candidateHeader) === JSON.stringify(promotedHeader),
    `${source} promotion tail for review evidence ${evidenceId} changes ledger metadata`,
  );
  assert(
    Array.isArray(candidateLedger.items) &&
      Array.isArray(promotedLedger.items) &&
      candidateLedger.items.length === promotedLedger.items.length,
    `${source} promotion tail for review evidence ${evidenceId} changes ledger membership`,
  );
  for (const [index, candidateItem] of candidateLedger.items.entries()) {
    const promotedItem = promotedLedger.items[index];
    assert(
      candidateItem.id === promotedItem?.id,
      `${source} promotion tail for review evidence ${evidenceId} reorders or replaces ledger items`,
    );
    if (candidateItem.taskId !== taskId) {
      assert(
        JSON.stringify(candidateItem) === JSON.stringify(promotedItem),
        `${source} promotion tail for review evidence ${evidenceId} changes ledger item ${candidateItem.id} for another task`,
      );
      continue;
    }
    const candidateReviewed = { ...candidateItem };
    const promotedReviewed = { ...promotedItem };
    delete candidateReviewed.status;
    delete candidateReviewed.evidenceRefs;
    delete promotedReviewed.status;
    delete promotedReviewed.evidenceRefs;
    assert(
      JSON.stringify(candidateReviewed) === JSON.stringify(promotedReviewed),
      `${source} promotion tail for review evidence ${evidenceId} changes reviewed ledger item ${candidateItem.id}`,
    );
  }
}

export function createGitHubReviewAuthenticator({
  fetchImpl = globalThis.fetch,
  checkoutProvider,
} = {}) {
  assert(typeof fetchImpl === "function", "GitHub review authentication requires built-in fetch");
  assert(
    typeof checkoutProvider === "function",
    "GitHub review authentication requires a trusted checkout provider",
  );
  const authenticatedReviews = new Map();
  const authenticatedPullRequests = new Map();
  const authenticatedPromotionTails = new Map();
  const authenticatedLedgers = new Map();
  const authenticatedReviewHistories = new Map();
  let authenticatedCodeowners;

  return async function authenticateGitHubReview(evidence, expectedRole, source) {
    const authorizationMatch = evidence.review.authorizationRef.match(
      /^https:\/\/github\.com\/Clyra-AI\/vetryn\/pull\/([0-9]+)#pullrequestreview-([0-9]+)$/,
    );
    assert(
      authorizationMatch,
      `${source} review evidence ${evidence.id} is not a Vetryn GitHub review`,
    );
    assert(
      evidence.review.observedCommit === evidence.commit,
      `review evidence ${evidence.id} observed commit differs from its evidence commit`,
    );
    const pullRequest = Number(authorizationMatch[1]);
    const reviewId = Number(authorizationMatch[2]);
    const cacheKey = `${pullRequest}:${reviewId}`;
    let authenticated = authenticatedReviews.get(cacheKey);
    if (!authenticated) {
      const apiUrl = `https://api.github.com/repos/${githubRepository}/pulls/${pullRequest}/reviews/${reviewId}`;
      authenticated = await fetchPublicGitHubJson(
        apiUrl,
        `${source} review evidence ${evidence.id} could not be authenticated by GitHub`,
        fetchImpl,
      );
      authenticatedReviews.set(cacheKey, authenticated);
    }

    assert(
      authenticated.id === evidence.review.reviewId,
      `${source} review evidence ${evidence.id} does not match the authenticated review ID`,
    );
    assert(
      authenticated.user?.login === evidence.actor,
      `${source} review evidence ${evidence.id} does not match the authenticated reviewer`,
    );
    assert(
      authenticated.author_association === evidence.review.authorAssociation,
      `${source} review evidence ${evidence.id} does not match the authenticated author association`,
    );
    assert(
      authenticated.state === "APPROVED",
      `${source} review evidence ${evidence.id} is not an authenticated approval`,
    );
    assert(
      authenticated.commit_id === evidence.commit,
      `${source} review evidence ${evidence.id} does not approve the candidate commit`,
    );
    assert(
      authenticated.html_url === evidence.review.authorizationRef &&
        authenticated.pull_request_url ===
          `https://api.github.com/repos/${githubRepository}/pulls/${pullRequest}`,
      `${source} review evidence ${evidence.id} is authenticated for a different pull request`,
    );

    let pullRequestData = authenticatedPullRequests.get(pullRequest);
    if (!pullRequestData) {
      pullRequestData = await fetchPublicGitHubJson(
        `https://api.github.com/repos/${githubRepository}/pulls/${pullRequest}`,
        `${source} could not authenticate pull request ${pullRequest}`,
        fetchImpl,
      );
      authenticatedPullRequests.set(pullRequest, pullRequestData);
    }
    const currentHead = pullRequestData.head?.sha;
    assert(
      typeof currentHead === "string" && /^[0-9a-f]{40}$/.test(currentHead),
      `${source} could not authenticate the current pull request head`,
    );
    assert(
      pullRequestData.user?.login?.toLowerCase() === evidence.review.subjectActor.toLowerCase(),
      `${source} review evidence ${evidence.id} does not name the authenticated candidate PR author`,
    );
    const checkout = checkoutProvider();
    assert(
      checkout?.commit === currentHead ||
        (pullRequestData.merged === true &&
          /^[0-9a-f]{40}$/.test(pullRequestData.merge_commit_sha ?? "") &&
          checkout?.containsCommit(pullRequestData.merge_commit_sha)),
      `${source} authenticated review pull request is unrelated to checkout ${checkout?.commit ?? "unknown"}`,
    );
    if (currentHead !== evidence.commit) {
      const promotionKey = `${evidence.commit}:${currentHead}`;
      let comparison = authenticatedPromotionTails.get(promotionKey);
      if (!comparison) {
        comparison = await fetchPublicGitHubJson(
          `https://api.github.com/repos/${githubRepository}/compare/${evidence.commit}...${currentHead}`,
          `${source} could not authenticate the promotion tail for review evidence ${evidence.id}`,
          fetchImpl,
        );
        authenticatedPromotionTails.set(promotionKey, comparison);
      }
      assert(
        comparison.status === "ahead" && comparison.merge_base_commit?.sha === evidence.commit,
        `${source} review evidence ${evidence.id} is not an ancestor of the current pull request head`,
      );
      assert(
        Number.isInteger(comparison.total_commits) &&
          comparison.total_commits > 0 &&
          comparison.total_commits < 250 &&
          comparison.commits?.length === comparison.total_commits,
        `${source} promotion tail for review evidence ${evidence.id} is incomplete or too large`,
      );
      assert(
        Array.isArray(comparison.files) && comparison.files.length < 300,
        `${source} promotion tail files for review evidence ${evidence.id} are incomplete or too large`,
      );
      const forbiddenFile = comparison.files.find((file) => {
        if (!isAllowedPromotionPath(file.filename, evidence.taskId)) return true;
        return (
          file.status === "renamed" &&
          !isAllowedPromotionPath(file.previous_filename, evidence.taskId)
        );
      });
      const forbiddenPath = forbiddenFile
        ? !isAllowedPromotionPath(forbiddenFile.filename, evidence.taskId)
          ? forbiddenFile.filename
          : forbiddenFile.previous_filename
        : null;
      assert(
        !forbiddenFile,
        `${source} promotion tail for review evidence ${evidence.id} changes forbidden path ${forbiddenPath}`,
      );
      const ledgerPath = "product/plans/oss-v1/acceptance-ledger.json";
      if (
        comparison.files.some(
          (file) => file.filename === ledgerPath || file.previous_filename === ledgerPath,
        )
      ) {
        const ledgers = [];
        for (const ref of [evidence.commit, currentHead]) {
          let ledger = authenticatedLedgers.get(ref);
          if (!ledger) {
            ledger = await fetchPublicGitHubJson(
              `https://raw.githubusercontent.com/${githubRepository}/${ref}/${ledgerPath}`,
              `${source} could not authenticate ledger at ${ref}`,
              fetchImpl,
            );
            authenticatedLedgers.set(ref, ledger);
          }
          ledgers.push(ledger);
        }
        assertLedgerPromotion(ledgers[0], ledgers[1], evidence.taskId, source, evidence.id);
      }
    }

    let reviewHistory = authenticatedReviewHistories.get(pullRequest);
    if (!reviewHistory) {
      reviewHistory = await fetchPublicGitHubJson(
        `https://api.github.com/repos/${githubRepository}/pulls/${pullRequest}/reviews?per_page=100`,
        `${source} could not authenticate pull request review history`,
        fetchImpl,
      );
      assert(
        Array.isArray(reviewHistory) && reviewHistory.length < 100,
        `${source} review history is incomplete or exceeds the unauthenticated verification limit`,
      );
      authenticatedReviewHistories.set(pullRequest, reviewHistory);
    }
    const decisiveReviews = reviewHistory
      .filter(
        (review) =>
          review.user?.login?.toLowerCase() === evidence.actor.toLowerCase() &&
          review.commit_id === evidence.commit &&
          ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state),
      )
      .sort((left, right) => {
        const submittedOrder = String(left.submitted_at).localeCompare(String(right.submitted_at));
        return submittedOrder || left.id - right.id;
      });
    const latestDecision = decisiveReviews.at(-1);
    assert(
      latestDecision?.id === evidence.review.reviewId && latestDecision.state === "APPROVED",
      `${source} review evidence ${evidence.id} is superseded by the reviewer's current decision`,
    );

    if (!authenticatedCodeowners) {
      authenticatedCodeowners = await fetchPublicGitHub(
        "https://raw.githubusercontent.com/Clyra-AI/vetryn/main/.github/CODEOWNERS",
        `${source} could not load trusted main-branch CODEOWNERS`,
        fetchImpl,
      );
    }
    const rolePaths = {
      maintainer: ".github/CODEOWNERS",
      "independent-verifier": "product/plans/oss-v1/plan.json",
      "trust-reviewer": "AGENTS.md",
      "security-reviewer": "SECURITY.md",
    };
    const protectedPath = rolePaths[expectedRole];
    assert(protectedPath, `${source} has no trusted CODEOWNERS path for role ${expectedRole}`);
    const principals = codeownersForPath(authenticatedCodeowners, protectedPath);
    assert(
      principals.some(
        (principal) => principal.toLowerCase() === `@${evidence.actor}`.toLowerCase(),
      ),
      `${source} reviewer ${evidence.actor} is not authorized for role ${expectedRole} by trusted main-branch CODEOWNERS`,
    );
  };
}

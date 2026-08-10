import { spawnSync } from "node:child_process";

const gitBinary = "/usr/bin/git";

function fail(message) {
  throw new Error(message);
}

function runGit(root, args, failureMessage, spawnSyncImpl) {
  const result = spawnSyncImpl(gitBinary, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
  });
  if (result.error || result.signal || result.status !== 0) fail(failureMessage);
  return result.stdout.trim();
}

export function createGitCheckoutProvider(root, { spawnSyncImpl = spawnSync } = {}) {
  let checkout;
  return function authenticateGitCheckout() {
    if (checkout) return checkout;
    const commit = runGit(
      root,
      ["rev-parse", "--verify", "HEAD"],
      "review evidence requires a committed Git checkout",
      spawnSyncImpl,
    );
    if (!/^[0-9a-f]{40}$/.test(commit)) fail("Git checkout HEAD is not a full commit ID");
    const status = runGit(
      root,
      ["status", "--porcelain=v1", "--untracked-files=all"],
      "review evidence requires an inspectable Git checkout",
      spawnSyncImpl,
    );
    if (status) fail("review evidence requires a clean Git checkout");
    checkout = {
      commit,
      containsCommit(ancestor) {
        const result = spawnSyncImpl(gitBinary, ["merge-base", "--is-ancestor", ancestor, commit], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
          timeout: 10_000,
        });
        if (!result.error && !result.signal && result.status === 0) return true;
        if (!result.error && !result.signal && result.status === 1) return false;
        fail(`could not inspect whether Git checkout ${commit} contains ${ancestor}`);
      },
    };
    return checkout;
  };
}

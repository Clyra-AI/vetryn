import { describe, expect, it, vi } from "vitest";

import { createGitCheckoutProvider } from "./git-checkout-auth.mjs";

const commit = "a".repeat(40);

function result(status, stdout = "") {
  return { error: undefined, signal: null, status, stdout };
}

describe("Git checkout authentication", () => {
  it("uses the absolute system Git and authenticates a clean committed checkout", () => {
    const spawnSyncImpl = vi
      .fn()
      .mockReturnValueOnce(result(0, `${commit}\n`))
      .mockReturnValueOnce(result(0, ""))
      .mockReturnValueOnce(result(0));
    const checkout = createGitCheckoutProvider("/repo", { spawnSyncImpl })();

    expect(checkout.commit).toBe(commit);
    expect(checkout.containsCommit("b".repeat(40))).toBe(true);
    expect(spawnSyncImpl).toHaveBeenNthCalledWith(
      1,
      "/usr/bin/git",
      ["rev-parse", "--verify", "HEAD"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("rejects a dirty checkout", () => {
    const spawnSyncImpl = vi
      .fn()
      .mockReturnValueOnce(result(0, `${commit}\n`))
      .mockReturnValueOnce(result(0, " M packages/core/src/index.ts\n"));
    const provider = createGitCheckoutProvider("/repo", { spawnSyncImpl });

    expect(provider).toThrow("review evidence requires a clean Git checkout");
  });

  it("reports when an authenticated merge commit is absent", () => {
    const spawnSyncImpl = vi
      .fn()
      .mockReturnValueOnce(result(0, `${commit}\n`))
      .mockReturnValueOnce(result(0, ""))
      .mockReturnValueOnce(result(1));
    const checkout = createGitCheckoutProvider("/repo", { spawnSyncImpl })();

    expect(checkout.containsCommit("b".repeat(40))).toBe(false);
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const skillPath = path.join(repositoryRoot, ".agents/skills/vetryn-golden-scenario/SKILL.md");
const planPath = path.join(repositoryRoot, "product/plans/oss-v1/plan.json");

function assertGoldenScenarioSkillContract(source) {
  const compileInstruction = "Run the active plan check and compile the `V1-02` task packet.";
  const freshPacketInstruction = "Read the fresh compiled packet.";

  expect(source.indexOf(compileInstruction)).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(freshPacketInstruction)).toBeGreaterThan(
    source.indexOf(compileInstruction),
  );
  expect(source).toContain(
    "Never make network calls, load credentials, or call a live OpenRouter or model endpoint.",
  );
  expect(source).toContain(
    "Do not mark acceptance evidence, promote the task, open a migration patch, or merge.",
  );
  expect(source).toContain("protected sentinel values");
}

describe("golden-scenario skill contract", () => {
  it("requires a fresh packet before authorizing offline fixture work", async () => {
    assertGoldenScenarioSkillContract(await readFile(skillPath, "utf8"));
  });

  it("rejects stale packet ordering and removed offline authority boundaries", async () => {
    const source = await readFile(skillPath, "utf8");
    const stalePacketOrder = source.replace(
      "2. Run the active plan check and compile the `V1-02` task packet.\n3. Read the fresh compiled packet.",
      "2. Read the fresh compiled packet.\n3. Run the active plan check and compile the `V1-02` task packet.",
    );

    expect(() => assertGoldenScenarioSkillContract(stalePacketOrder)).toThrow();
    expect(() =>
      assertGoldenScenarioSkillContract(
        source.replace(
          "Never make network calls, load credentials, or call a live OpenRouter or model endpoint.",
          "",
        ),
      ),
    ).toThrow();
  });

  it("keeps the skill task behind the accepted V1-00 foundation", async () => {
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    const task = plan.tasks.find((candidate) => candidate.id === "M0-02");

    expect(task.dependsOn).toContainEqual({ taskId: "V1-00", kind: "hard" });
  });
});

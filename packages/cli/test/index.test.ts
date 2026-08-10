import { describe, expect, it } from "vitest";

import { createProgram, getDiagnostics, VERSION } from "../src/index.js";

describe("getDiagnostics", () => {
  it("reports the CLI and runtime versions", () => {
    expect(getDiagnostics()).toMatchObject({
      node: process.version,
      version: VERSION,
    });
  });
});

describe("createProgram", () => {
  it("exposes the project name and doctor command", () => {
    const program = createProgram();

    expect(program.name()).toBe("vetryn");
    expect(program.commands.map((command) => command.name())).toContain("doctor");
  });
});

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
  it("exposes the project name, diagnostics, catalog, manifest, and scanner commands", () => {
    const program = createProgram();

    expect(program.name()).toBe("vetryn");
    expect(program.commands.map((command) => command.name())).toContain("doctor");
    expect(program.commands.map((command) => command.name())).toContain("manifest");
    expect(program.commands.map((command) => command.name())).toContain("catalog");
    expect(program.commands.map((command) => command.name())).toContain("eval");
    expect(program.commands.map((command) => command.name())).toContain("scan");
  });
});

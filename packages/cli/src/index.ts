#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { Command } from "commander";

export const VERSION = "0.0.0";

export interface Diagnostics {
  architecture: string;
  node: string;
  platform: NodeJS.Platform;
  version: string;
}

export function getDiagnostics(): Diagnostics {
  return {
    architecture: process.arch,
    node: process.version,
    platform: process.platform,
    version: VERSION,
  };
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("vetryn")
    .description("Dependabot for AI model dependencies.")
    .version(VERSION)
    .showHelpAfterError();

  program
    .command("doctor")
    .description("Print local runtime diagnostics.")
    .option("--json", "Print machine-readable JSON.")
    .action((options: { json?: boolean }) => {
      const diagnostics = getDiagnostics();

      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
        return;
      }

      process.stdout.write(
        [
          `Vetryn ${diagnostics.version}`,
          `Node ${diagnostics.node}`,
          `${diagnostics.platform} ${diagnostics.architecture}`,
        ].join("\n") + "\n",
      );
    });

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  await createProgram().parseAsync([...argv]);
}

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}

import { basename } from "node:path";

import { confirm, intro, isCancel, outro } from "@clack/prompts";

import { getPlatformConfig } from "../lib/platform.js";
import { checkPrerequisites } from "../lib/prereqs.js";
import {
  readSandboxConfigOptional,
  writeSandboxConfig,
} from "../lib/sandbox.js";
import { runInitPrompts } from "./init.js";
import { start } from "./start.js";

export async function wizard(): Promise<void> {
  const name = basename(process.cwd());
  const pc = getPlatformConfig();

  checkPrerequisites(pc);

  const existing = readSandboxConfigOptional();
  const isModify = existing !== null;

  intro(
    isModify
      ? `create-sandbox — modifying config for "${name}"`
      : `create-sandbox — setting up sandbox for "${name}"`
  );

  const config = await runInitPrompts(existing);
  if (!config) {
    outro("Cancelled.");
    process.exit(0);
  }

  writeSandboxConfig(config);
  outro("sandbox.json saved.");

  const shouldStart = await confirm({
    initialValue: true,
    message: "Start the sandbox now?",
  });

  if (isCancel(shouldStart) || !shouldStart) {
    console.log("  Run: create-sandbox start");
    return;
  }

  await start();
}

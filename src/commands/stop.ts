import { spinner } from "@clack/prompts";

import { readGlobalConfig } from "../lib/global-config.js";
import { sandboxName } from "../lib/paths.js";
import { getPlatformConfig } from "../lib/platform.js";
import { getProvider } from "../lib/providers/index.js";
import { readSandboxConfig } from "../lib/sandbox.js";

export async function stop(): Promise<void> {
  const name = sandboxName();
  const config = readSandboxConfig();
  const provider = getProvider(config, readGlobalConfig(), getPlatformConfig());

  if (!(await provider.isRunning(name))) {
    console.error(`Sandbox "${name}" is not running.`);
    process.exit(1);
  }

  const s = spinner();
  s.start("Stopping sandbox...");
  try {
    await provider.stop(name);
    s.stop(`Sandbox "${name}" stopped.`);
  } catch (error) {
    s.stop("Error during shutdown.");
    console.error(String(error));
    process.exit(1);
  }
}

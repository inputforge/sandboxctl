import { intro, outro, spinner } from "@clack/prompts";

import { readGlobalConfig } from "../lib/global-config.js";
import { sandboxName } from "../lib/paths.js";
import { getPlatformConfig } from "../lib/platform.js";
import { getProvider } from "../lib/providers/index.js";
import { createReporter } from "../lib/reporter.js";
import {
  readConfigSnapshot,
  readSandboxConfig,
  writeConfigSnapshot,
  writeState,
} from "../lib/sandbox.js";
import { buildSshTransport } from "../lib/ssh-command.js";
import { findSshKeyPair } from "../lib/ssh-key.js";
import { send } from "./send.js";

export async function start(): Promise<void> {
  const name = sandboxName();
  const config = readSandboxConfig();
  const globalConfig = readGlobalConfig();
  const pc = getPlatformConfig();
  const provider = await getProvider(config, globalConfig, pc);
  if (provider.isSupported()) {
    provider.checkPrereqs();
  }
  const snapshot = readConfigSnapshot();

  intro(`sandboxctl — starting "${name}"`);

  const reporter = createReporter();
  const { host, port } = await provider.start(config, name, snapshot, reporter);
  let identityFile: string;
  try {
    ({ privateKeyPath: identityFile } = findSshKeyPair());
  } catch (error) {
    throw new Error(
      `Failed to locate SSH key pair (generation or read error): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  writeState({ host, identityFile, port, startedAt: new Date().toISOString() });
  writeConfigSnapshot(config);

  {
    const s = spinner();
    s.start("Syncing project files...");
    try {
      await send();
      s.stop("Files synced.");
    } catch {
      s.stop("File sync skipped (rsync not available or no files to sync).");
    }
  }

  const exposed = (config.ports ?? [])
    .map((f) => `${f.guest}/${f.protocol ?? "tcp"}`)
    .join(", ");
  const sshCommand = buildSshTransport({ identityFile, port });
  outro(
    `Sandbox "${name}" is ready!\n  SSH: ${sshCommand} ${config.username}@${host}${exposed ? `\n  Exposed: ${exposed}` : ""}`
  );
}

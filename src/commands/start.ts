import { intro, outro, spinner } from "@clack/prompts";

import { readGlobalConfig } from "../lib/global-config.js";
import { sandboxName } from "../lib/paths.js";
import { getPlatformConfig } from "../lib/platform.js";
import { getProvider } from "../lib/providers/index.js";
import {
  readConfigSnapshot,
  readSandboxConfig,
  writeConfigSnapshot,
  writeState,
} from "../lib/sandbox.js";
import { send } from "./send.js";

export async function start(): Promise<void> {
  const name = sandboxName();
  const config = readSandboxConfig();
  const globalConfig = readGlobalConfig();
  const pc = getPlatformConfig();
  const provider = getProvider(config, globalConfig, pc);
  const snapshot = readConfigSnapshot();

  intro(`create-sandbox — starting "${name}"`);

  const { host, identityFile, port } = await provider.start(
    config,
    name,
    snapshot
  );

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
  outro(
    `Sandbox "${name}" is ready!\n  SSH: ssh -p ${port} ubuntu@${host}${exposed ? `\n  Exposed: ${exposed}` : ""}`
  );
}

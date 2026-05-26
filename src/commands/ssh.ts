import { execFileSync } from "node:child_process";

import { readGlobalConfig } from "../lib/global-config.js";
import { sandboxName } from "../lib/paths.js";
import { getPlatformConfig } from "../lib/platform.js";
import { getProvider } from "../lib/providers/index.js";
import { readSandboxConfig, readState } from "../lib/sandbox.js";

export async function ssh(): Promise<void> {
  const name = sandboxName();
  const config = readSandboxConfig();
  const provider = getProvider(config, readGlobalConfig(), getPlatformConfig());

  if (!(await provider.isRunning(name))) {
    console.error(
      `Sandbox "${name}" is not running. Start it first: create-sandbox start`
    );
    process.exit(1);
  }

  const state = readState();
  if (!state) {
    console.error("No state found. The sandbox may need to be restarted.");
    process.exit(1);
  }
  if (!state.host.trim()) {
    console.error("Missing SSH host in state. Restart the sandbox.");
    process.exit(1);
  }

  try {
    execFileSync(
      "ssh",
      [
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        ...(state.identityFile ? ["-i", state.identityFile] : []),
        "-p",
        String(state.port),
        `ubuntu@${state.host}`,
      ],
      { stdio: "inherit" }
    );
  } catch {
    // ssh exits non-zero on normal logout; suppress the error
  }
}

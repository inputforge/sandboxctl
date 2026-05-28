import { execFileSync, execSync } from "node:child_process";

import { readGlobalConfig } from "../lib/global-config.js";
import { sandboxName } from "../lib/paths.js";
import { getPlatformConfig } from "../lib/platform.js";
import { getProvider } from "../lib/providers/index.js";
import { isRsyncAvailable } from "../lib/rsync.js";
import { getRemotePath, readSandboxConfig, readState } from "../lib/sandbox.js";
import { buildSshTransport } from "../lib/ssh-command.js";

export async function receive(): Promise<void> {
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

  const remotePath = getRemotePath(config);
  const sshTransport = buildSshTransport({
    disableHostKeyVerification: true,
    identityFile: state.identityFile,
    port: state.port,
  });

  if (isRsyncAvailable()) {
    console.log(`Receiving from ${remotePath}...`);
    execFileSync(
      "rsync",
      [
        "-avz",
        "-e",
        sshTransport,
        `${config.username}@${state.host}:${remotePath}/`,
        "./",
      ],
      { stdio: "inherit" }
    );
  } else {
    console.log(`Receiving from ${remotePath} (via tar)...`);
    const sshCmd = `${sshTransport} ${config.username}@${state.host}`;
    execSync(`${sshCmd} 'tar czf - -C ${remotePath} .' | tar xzf -`, {
      stdio: ["pipe", "inherit", "inherit"],
    });
  }
}

import { execFileSync, execSync } from "node:child_process";

import { sandboxName, vmSockPath } from "../lib/paths.js";
import { isVmRunning } from "../lib/qemu.js";
import { getRemotePath, readSandboxConfig, readState } from "../lib/sandbox.js";

function isRsyncAvailable(): boolean {
  try {
    execSync(process.platform === "win32" ? "where rsync" : "which rsync", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export async function send(): Promise<void> {
  const name = sandboxName();

  if (!(await isVmRunning(vmSockPath()))) {
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

  const config = readSandboxConfig();
  const remotePath = getRemotePath(config);
  const port = String(state.port);

  const hasRsync = isRsyncAvailable();

  if (hasRsync) {
    console.log(`Syncing to ${remotePath}...`);
    execFileSync(
      "rsync",
      [
        "-avz",
        "--delete",
        "-e",
        `ssh -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
        "--filter=:- .gitignore",
        "--exclude=.git",
        "./",
        `ubuntu@localhost:${remotePath}/`,
      ],
      { stdio: "inherit" }
    );
  } else {
    console.log(`Syncing to ${remotePath} (via tar)...`);
    const sshCmd = `ssh -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ubuntu@localhost`;
    execSync(
      `tar czf - --exclude='.git' . | ${sshCmd} 'mkdir -p ${remotePath} && tar xzf - -C ${remotePath}'`,
      { stdio: ["pipe", "inherit", "inherit"] }
    );
  }
}

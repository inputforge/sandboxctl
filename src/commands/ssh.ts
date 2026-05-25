import { execFileSync } from "node:child_process";

import { sandboxName, vmSockPath } from "../lib/paths.js";
import { isVmRunning } from "../lib/qemu.js";
import { readState } from "../lib/sandbox.js";

export async function ssh(): Promise<void> {
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

  try {
    execFileSync(
      "ssh",
      [
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-p",
        String(state.port),
        "ubuntu@localhost",
      ],
      { stdio: "inherit" }
    );
  } catch {
    // ssh exits non-zero on normal logout; suppress the error
  }
}

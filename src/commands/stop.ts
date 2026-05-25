import { spinner } from "@clack/prompts";

import { sandboxName, vmSockPath } from "../lib/paths.js";
import {
  isVmRunning,
  sendMonitorCommand,
  waitForSockGone,
} from "../lib/qemu.js";

export async function stop(): Promise<void> {
  const name = sandboxName();
  const sockPath = vmSockPath();

  if (!(await isVmRunning(sockPath))) {
    console.error(`Sandbox "${name}" is not running.`);
    process.exit(1);
  }

  const s = spinner();
  s.start("Sending shutdown signal...");

  try {
    await sendMonitorCommand(sockPath, "system_powerdown");
    s.message("Waiting for VM to shut down...");
    await waitForSockGone(sockPath);
    s.stop(`Sandbox "${name}" stopped.`);
  } catch (error) {
    s.stop("Error during shutdown.");
    console.error(String(error));
    process.exit(1);
  }
}

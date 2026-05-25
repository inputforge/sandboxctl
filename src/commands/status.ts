import { existsSync } from "node:fs";

import { sandboxDir, sandboxName, vmSockPath } from "../lib/paths.js";
import { isVmRunning } from "../lib/qemu.js";
import { readSandboxConfig, readState } from "../lib/sandbox.js";

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}h ${m % 60}m`;
  }
  if (m > 0) {
    return `${m}m ${s % 60}s`;
  }
  return `${s}s`;
}

export async function status(): Promise<void> {
  const name = sandboxName();

  if (!existsSync(sandboxDir())) {
    console.log(`Sandbox: ${name}`);
    console.log("Status:  not initialized");
    return;
  }

  const running = await isVmRunning(vmSockPath());
  const state = readState();

  console.log(`Sandbox: ${name}`);
  console.log(`Status:  ${running ? "running" : "stopped"}`);

  if (running && state) {
    console.log(`SSH:     ssh -p ${state.port} ubuntu@localhost`);
    const uptimeMs = Date.now() - new Date(state.startedAt).getTime();
    console.log(`Uptime:  ${formatUptime(uptimeMs)}`);
    const config = readSandboxConfig();
    const exposed = config.ports ?? [];
    if (exposed.length > 0) {
      console.log(
        `Exposed: ${exposed.map((f) => `${f.guest}/${f.protocol ?? "tcp"}`).join(", ")}`
      );
    }
  }
}

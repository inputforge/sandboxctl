import { readGlobalConfig } from "../lib/global-config.js";
import { sandboxName } from "../lib/paths.js";
import { getPlatformConfig } from "../lib/platform.js";
import { getProvider } from "../lib/providers/index.js";
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
  const config = readSandboxConfig();
  const provider = getProvider(config, readGlobalConfig(), getPlatformConfig());

  if (!provider.isInitialized(name)) {
    console.log(`Sandbox: ${name}`);
    console.log("Status:  not initialized");
    return;
  }

  const running = await provider.isRunning(name);
  const state = readState();

  console.log(`Sandbox: ${name}`);
  console.log(`Status:  ${running ? "running" : "stopped"}`);

  if (running && state) {
    const identity = state.identityFile ? ` -i ${state.identityFile}` : "";
    console.log(
      `SSH:     ssh${identity} -p ${state.port} ${config.username}@${state.host}`
    );
    console.log(
      `Uptime:  ${formatUptime(Date.now() - new Date(state.startedAt).getTime())}`
    );
    const exposed = config.ports ?? [];
    if (exposed.length > 0) {
      console.log(
        `Exposed: ${exposed.map((f) => `${f.guest}/${f.protocol ?? "tcp"}`).join(", ")}`
      );
    }
  }
}

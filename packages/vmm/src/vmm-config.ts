import type { SandboxConfig } from "@inputforge/providers";

export interface VmmPortForward {
  hostPort: number;
  guestPort: number;
}

export interface VmmConfig {
  bootMode: "efi";
  cpuCount: number;
  memoryMB: number;
  disk: string;
  stateDir: string;
  extraDisks: { path: string; readOnly: true }[];
  portForwards: VmmPortForward[];
}

export function parseMemoryMB(memory: string): number {
  const match = memory.trim().match(/^(\d+)\s*(M|MB|MIB|G|GB|GIB)$/iu);
  if (!match) {
    throw new Error(
      `Unsupported memory format "${memory}". Use values like "1024M" or "1G".`
    );
  }
  const value = Number.parseInt(match[1] ?? "", 10);
  const unit = (match[2] ?? "").toUpperCase();
  return unit.startsWith("G") ? value * 1024 : value;
}

export function buildVmmConfig(
  config: SandboxConfig,
  diskPath: string,
  stateDir: string,
  seedPath: string,
  sshPort: number
): VmmConfig {
  return {
    bootMode: "efi",
    cpuCount: config.vm.cpus,
    disk: diskPath,
    extraDisks: [{ path: seedPath, readOnly: true }],
    memoryMB: parseMemoryMB(config.vm.memory),
    portForwards: [{ guestPort: 22, hostPort: sshPort }],
    stateDir,
  };
}

import type { SandboxConfig } from "@inputforge/sandboxctl-providers";

export interface VmmConfig {
  bootMode: "efi" | "linux";
  cpuCount: number;
  memoryMB: number;
  disk: string;
  macAddress?: string;
  // EFI boot
  stateDir?: string;
  // Linux direct boot
  kernel?: string;
  initrd?: string;
  cmdline?: string;
  // Extra virtio-blk disks (e.g. cloud-init seed)
  extraDisks?: { path: string; readOnly: boolean }[];
}

export function parseMemoryMB(memory: string): number {
  const match = /^(\d+)\s*(M|MB|MIB|G|GB|GIB)$/iu.exec(memory.trim());
  if (!match) {
    throw new Error(
      `Unsupported memory format "${memory}". Use values like "1024M" or "1G".`
    );
  }
  const value = Number.parseInt(match[1] ?? "", 10);
  const unit = (match[2] ?? "").toUpperCase();
  return unit.startsWith("G") ? value * 1024 : value;
}

export function buildEfiVmmConfig(
  config: SandboxConfig,
  diskPath: string,
  stateDir: string,
  seedPath: string
): VmmConfig {
  return {
    bootMode: "efi",
    cpuCount: config.vm.cpus,
    disk: diskPath,
    extraDisks: [{ path: seedPath, readOnly: true }],
    memoryMB: parseMemoryMB(config.vm.memory),
    stateDir,
  };
}

export function buildLinuxVmmConfig(
  config: SandboxConfig,
  diskPath: string,
  kernelPath: string,
  initrdPath: string,
  seedPath: string,
  mac: string
): VmmConfig {
  return {
    bootMode: "linux",
    cmdline: "console=hvc0 root=/dev/vda1 rw quiet",
    cpuCount: config.vm.cpus,
    disk: diskPath,
    extraDisks: [{ path: seedPath, readOnly: true }],
    initrd: initrdPath,
    kernel: kernelPath,
    macAddress: mac,
    memoryMB: parseMemoryMB(config.vm.memory),
  };
}

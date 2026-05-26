import type { GlobalConfig } from "../global-config.js";
import type { PlatformConfig } from "../platform.js";
import type { SandboxConfig } from "../sandbox.js";
import { createEc2Provider } from "./ec2/index.js";
import { createLimaProvider } from "./lima/index.js";
import { createQemuProvider } from "./qemu/index.js";

export interface VmStartResult {
  host: string;
  identityFile?: string;
  port: number;
}

export interface VmProvider {
  isInitialized(name: string): boolean;
  isRunning(name: string): Promise<boolean>;
  /**
   * Start the VM (first or subsequent boot). Handles all provider-specific
   * setup, boot sequencing, and waiting until SSH + provisioning are ready.
   * Returns the SSH endpoint.
   */
  start(
    config: SandboxConfig,
    name: string,
    snapshot: SandboxConfig | null
  ): Promise<VmStartResult>;
  stop(name: string): Promise<void>;
  destroy(name: string): Promise<void>;
}

interface Ec2Config {
  arch: "arm64" | "amd64";
  instanceType: string;
  region?: string;
}

function parseMemoryMiB(memory: string): number {
  const value = Number.parseInt(memory, 10);
  if (Number.isNaN(value)) {
    return Number.POSITIVE_INFINITY;
  }
  return memory.toUpperCase().endsWith("G") ? value * 1024 : value;
}

function mapInstanceType(
  cpus: number,
  memory: string,
  arch: "arm64" | "amd64"
): string {
  const family = arch === "arm64" ? "t4g" : "t3";
  const memoryMiB = parseMemoryMiB(memory);
  if (cpus <= 2 && memoryMiB <= 1024) {
    return `${family}.micro`;
  }
  if (cpus <= 2 && memoryMiB <= 2048) {
    return `${family}.small`;
  }
  if (cpus <= 2 && memoryMiB <= 4096) {
    return `${family}.medium`;
  }
  if (cpus <= 2 && memoryMiB <= 8192) {
    return `${family}.large`;
  }
  if (cpus <= 4 && memoryMiB <= 16_384) {
    return `${family}.xlarge`;
  }
  return `${family}.2xlarge`;
}

function mergeEc2Config(
  sandboxConfig: SandboxConfig,
  globalConfig: GlobalConfig,
  defaultArch: "arm64" | "amd64"
): Ec2Config {
  const arch = sandboxConfig.ec2?.arch ?? globalConfig.ec2?.arch ?? defaultArch;
  return {
    arch,
    instanceType:
      sandboxConfig.ec2?.instanceType ??
      globalConfig.ec2?.instanceType ??
      mapInstanceType(sandboxConfig.vm.cpus, sandboxConfig.vm.memory, arch),
    region: sandboxConfig.ec2?.region ?? globalConfig.ec2?.region,
  };
}

export function getProvider(
  sandboxConfig: SandboxConfig,
  globalConfig: GlobalConfig,
  pc: PlatformConfig
): VmProvider {
  const configuredProvider =
    sandboxConfig.provider ??
    globalConfig.defaultProvider ??
    (pc.platform === "macos" ? "lima" : "qemu");
  const provider =
    configuredProvider === "local" ? pc.provider : configuredProvider;

  if (provider === "ec2") {
    const ec2Config = mergeEc2Config(
      sandboxConfig,
      globalConfig,
      pc.ubuntuArch
    );
    return createEc2Provider(ec2Config, ec2Config.arch);
  }
  if (provider === "lima") {
    return createLimaProvider(pc);
  }
  return createQemuProvider(pc);
}

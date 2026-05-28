import type {
  SandboxConfig,
  VmProvider,
  VmStartResult,
} from "@inputforge/providers";

import type { GlobalConfig } from "../global-config.js";
import type { PlatformConfig } from "../platform.js";
import { createEc2Provider } from "./ec2/index.js";
import { createLimaProvider } from "./lima/index.js";
import { createQemuProvider } from "./qemu/index.js";

interface Ec2Config {
  arch: "arm64" | "amd64";
  instanceType: string;
  region?: string;
  sshCidr?: string;
}

type ResolvedProvider = "ec2" | "lima" | "qemu" | "vmm";

function parseMemoryMiB(memory: string): number {
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
    sshCidr:
      sandboxConfig.ec2?.sshCidr ??
      globalConfig.ec2?.sshCidr ??
      process.env.CREATE_SANDBOX_EC2_SSH_CIDR,
  };
}

export function providerNeedsLocalPrerequisites(
  provider: ResolvedProvider
): boolean {
  return provider === "lima" || provider === "qemu";
}

export function resolveProvider(
  sandboxConfig: SandboxConfig,
  globalConfig: GlobalConfig,
  pc: PlatformConfig
): ResolvedProvider {
  const configuredProvider =
    sandboxConfig.provider ??
    globalConfig.defaultProvider ??
    (pc.platform === "macos" ? "lima" : "qemu");
  return configuredProvider === "local" ? pc.provider : configuredProvider;
}

export async function getProvider(
  sandboxConfig: SandboxConfig,
  globalConfig: GlobalConfig,
  pc: PlatformConfig
): Promise<VmProvider> {
  const provider = resolveProvider(sandboxConfig, globalConfig, pc);

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
  if (provider === "vmm") {
    const { createVmmProvider } = await import("@inputforge/vmm");
    return createVmmProvider();
  }
  return createQemuProvider(pc);
}

export type { VmProvider, VmStartResult };

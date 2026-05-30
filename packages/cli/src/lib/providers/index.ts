import type {
  SandboxConfig,
  VmProvider,
  VmStartResult,
} from "@inputforge/providers";

import type { GlobalConfig } from "../global-config.js";

interface Ec2Config {
  arch: "arm64" | "amd64";
  instanceType: string;
  region?: string;
  sshCidr?: string;
}

export type ResolvedProvider = "ec2" | "qemu" | "vmm";

interface PlatformHint {
  provider: "qemu" | "vmm";
  ubuntuArch: "arm64" | "amd64";
}

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
  const arch =
    sandboxConfig.ec2?.arch ??
    globalConfig.ec2?.arch ??
    sandboxConfig.vm.arch ??
    defaultArch;
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
  return provider === "qemu";
}

export function resolveProvider(
  sandboxConfig: SandboxConfig,
  globalConfig: GlobalConfig,
  pc: PlatformHint
): ResolvedProvider {
  const configuredProvider =
    sandboxConfig.provider ?? globalConfig.defaultProvider ?? pc.provider;
  const provider =
    configuredProvider === "local" ? pc.provider : configuredProvider;

  // vmm only supports native arch — fall back to qemu for cross-arch requests
  if (provider === "vmm") {
    const guestArch = sandboxConfig.vm.arch ?? pc.ubuntuArch;
    if (guestArch !== pc.ubuntuArch) {
      return "qemu";
    }
  }

  return provider;
}

export async function getProvider(
  sandboxConfig: SandboxConfig,
  globalConfig: GlobalConfig,
  pc: PlatformHint
): Promise<VmProvider> {
  const provider = resolveProvider(sandboxConfig, globalConfig, pc);

  if (provider === "ec2") {
    const ec2Config = mergeEc2Config(
      sandboxConfig,
      globalConfig,
      pc.ubuntuArch
    );
    const { createEc2Provider } = await import("@inputforge/ec2");
    return createEc2Provider(ec2Config, ec2Config.arch);
  }
  if (provider === "vmm") {
    const { createVmmProvider } = await import("@inputforge/vmm");
    return createVmmProvider();
  }
  const { createQemuProvider, getPlatformConfig } =
    await import("@inputforge/qemu");
  return createQemuProvider(getPlatformConfig());
}

export type { VmProvider, VmStartResult };

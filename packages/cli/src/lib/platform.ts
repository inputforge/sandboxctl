import { arch, platform } from "node:os";

export type HostArch = "arm64" | "x86_64";
export type HostPlatform = "macos" | "linux" | "windows";

export interface PlatformConfig {
  arch: HostArch;
  platform: HostPlatform;
  provider: "qemu" | "vmm";
  qemuBin: string;
  ubuntuArch: "arm64" | "amd64";
}

export function getPlatformConfig(): PlatformConfig {
  const os = platform();
  const a = arch();
  const isArm = a === "arm64" || a === "arm";
  let p: HostPlatform;
  if (os === "darwin") {
    p = "macos";
  } else if (os === "win32") {
    p = "windows";
  } else {
    p = "linux";
  }

  if (p === "macos") {
    return {
      arch: isArm ? "arm64" : "x86_64",
      platform: "macos",
      provider: "vmm",
      qemuBin: isArm ? "qemu-system-aarch64" : "qemu-system-x86_64",
      ubuntuArch: isArm ? "arm64" : "amd64",
    };
  }
  if (p === "linux") {
    return {
      arch: isArm ? "arm64" : "x86_64",
      platform: "linux",
      provider: "qemu",
      qemuBin: isArm ? "qemu-system-aarch64" : "qemu-system-x86_64",
      ubuntuArch: isArm ? "arm64" : "amd64",
    };
  }
  // Windows
  return {
    arch: "x86_64",
    platform: "windows",
    provider: "qemu",
    qemuBin: "qemu-system-x86_64",
    ubuntuArch: "amd64",
  };
}

const UBUNTU_CODENAMES: Record<string, string> = {
  "24.04": "noble",
  "26.04": "resolute",
};

export function getUbuntuImageName(
  version: string,
  ubuntuArch: "arm64" | "amd64"
): string {
  const codename = UBUNTU_CODENAMES[version];
  if (!codename) {
    throw new Error(`Unsupported Ubuntu version: ${version}`);
  }
  return `${codename}-server-cloudimg-${ubuntuArch}.img`;
}

export function getUbuntuImageUrl(
  version: string,
  ubuntuArch: "arm64" | "amd64"
): string {
  const codename = UBUNTU_CODENAMES[version];
  if (!codename) {
    throw new Error(`Unsupported Ubuntu version: ${version}`);
  }
  const name = getUbuntuImageName(version, ubuntuArch);
  return `https://cloud-images.ubuntu.com/${codename}/current/${name}`;
}

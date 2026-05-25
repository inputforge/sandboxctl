import { arch, platform } from "node:os";

export type HostArch = "arm64" | "x86_64";
export type HostPlatform = "macos" | "linux" | "windows";

export interface PlatformConfig {
  accel: string;
  arch: HostArch;
  cpuArg: string;
  firmware: string | null;
  machine: string;
  platform: HostPlatform;
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

  if (p === "macos" && isArm) {
    return {
      accel: "hvf",
      arch: "arm64",
      cpuArg: "host",
      firmware: "/opt/homebrew/share/qemu/edk2-aarch64-code.fd",
      machine: "virt",
      platform: "macos",
      qemuBin: "qemu-system-aarch64",
      ubuntuArch: "arm64",
    };
  }
  if (p === "macos" && !isArm) {
    return {
      accel: "hvf",
      arch: "x86_64",
      cpuArg: "host",
      firmware: "/opt/homebrew/share/qemu/edk2-x86_64-code.fd",
      machine: "q35",
      platform: "macos",
      qemuBin: "qemu-system-x86_64",
      ubuntuArch: "amd64",
    };
  }
  if (p === "linux" && isArm) {
    return {
      accel: "kvm",
      arch: "arm64",
      cpuArg: "host",
      firmware: "/usr/share/qemu/edk2-aarch64-code.fd",
      machine: "virt",
      platform: "linux",
      qemuBin: "qemu-system-aarch64",
      ubuntuArch: "arm64",
    };
  }
  if (p === "linux" && !isArm) {
    return {
      accel: "kvm",
      arch: "x86_64",
      cpuArg: "host",
      firmware: null,
      machine: "q35",
      platform: "linux",
      qemuBin: "qemu-system-x86_64",
      ubuntuArch: "amd64",
    };
  }
  // Windows x86_64
  return {
    accel: "whpx",
    arch: "x86_64",
    cpuArg: "host",
    firmware: null,
    machine: "q35",
    platform: "windows",
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

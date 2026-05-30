import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { PackageConfig } from "@inputforge/providers";

const USERNAME_RE = /^[A-Za-z0-9_-]+$/u;

type InstallerFn = (
  cfg: PackageConfig,
  ubuntuArch: "arm64" | "amd64"
) => string[];

const installers: Record<string, InstallerFn> = {
  bun({ version = "latest" }, ubuntuArch) {
    const linuxArch = ubuntuArch === "arm64" ? "aarch64" : "x64";
    const tag = version === "latest" ? "latest" : `bun-v${version}`;
    const url =
      version === "latest"
        ? `https://github.com/oven-sh/bun/releases/latest/download/bun-linux-${linuxArch}.zip`
        : `https://github.com/oven-sh/bun/releases/download/${tag}/bun-linux-${linuxArch}.zip`;
    return [
      `echo "==> Bun ${version} (linux-${linuxArch})..."`,
      `curl -fsSL ${url} -o /tmp/bun.zip`,
      `python3 -c "import zipfile; zipfile.ZipFile('/tmp/bun.zip').extract('bun-linux-${linuxArch}/bun', '/tmp/')"`,
      `mv /tmp/bun-linux-${linuxArch}/bun /usr/local/bin/bun`,
      "chmod +x /usr/local/bin/bun",
      `rm -rf /tmp/bun.zip /tmp/bun-linux-${linuxArch}`,
      `echo "bun: $(bun --version)"`,
    ];
  },

  go({ version = "1.24.3" }, ubuntuArch) {
    const goArch = ubuntuArch === "arm64" ? "arm64" : "amd64";
    return [
      `echo "==> Go ${version} (linux-${goArch})..."`,
      `curl -fsSL https://go.dev/dl/go${version}.linux-${goArch}.tar.gz -o /tmp/go.tar.gz`,
      "rm -rf /usr/local/go",
      "tar -C /usr/local -xzf /tmp/go.tar.gz",
      "rm /tmp/go.tar.gz",
      `echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh`,
      `echo "go: $(/usr/local/go/bin/go version)"`,
    ];
  },

  java({ version = "21" }) {
    return [
      `echo "==> OpenJDK ${version}..."`,
      `apt-get install -y openjdk-${version}-jdk`,
      `echo "java: $(java --version 2>&1 | head -1)"`,
    ];
  },

  nodejs({ version = "22" }) {
    return [
      `echo "==> Node.js ${version}.x via NodeSource..."`,
      `curl -fsSL https://deb.nodesource.com/setup_${version}.x | bash -`,
      "apt-get install -y nodejs",
      `echo "node: $(node --version)"`,
    ];
  },

  php() {
    return [
      `echo "==> PHP..."`,
      "apt-get install -y php php-cli php-fpm php-curl php-json php-mbstring php-xml php-zip",
      `echo "php: $(php --version | head -1)"`,
    ];
  },

  python() {
    return [
      `echo "==> Python 3 (pip, venv, dev)..."`,
      "apt-get install -y python3-pip python3-venv python3-dev",
      `echo "python: $(python3 --version)"`,
    ];
  },

  ruby() {
    return [
      `echo "==> Ruby..."`,
      "apt-get install -y ruby-full",
      `echo "ruby: $(ruby --version)"`,
    ];
  },

  swift({ version = "6.0.3" }, ubuntuArch) {
    const archSuffix =
      ubuntuArch === "arm64" ? "ubuntu2404-aarch64" : "ubuntu2404";
    const tarSuffix =
      ubuntuArch === "arm64" ? "ubuntu24.04-aarch64" : "ubuntu24.04";
    return [
      `echo "==> Swift ${version} (${tarSuffix})..."`,
      "apt-get install -y binutils git gnupg2 libc6-dev libcurl4-openssl-dev libedit2 libgcc-13-dev libpython3-dev libsqlite3-dev libstdc++-13-dev libxml2-dev libz3-dev pkg-config tzdata unzip zlib1g-dev",
      `curl -fsSL https://download.swift.org/swift-${version}-release/${archSuffix}/swift-${version}-RELEASE/swift-${version}-RELEASE-${tarSuffix}.tar.gz -o /tmp/swift.tar.gz`,
      "tar -xzf /tmp/swift.tar.gz -C /opt",
      `mv /opt/swift-${version}-RELEASE-${tarSuffix} /opt/swift`,
      "rm /tmp/swift.tar.gz",
      `echo 'export PATH=$PATH:/opt/swift/usr/bin' > /etc/profile.d/swift.sh`,
      `echo "swift: $(/opt/swift/usr/bin/swift --version 2>&1 | head -1)"`,
    ];
  },
};

export function buildInstallScript(
  packages: Record<string, PackageConfig>,
  ubuntuArch: "arm64" | "amd64"
): string {
  const lines = [
    "#!/bin/bash",
    "set -euo pipefail",
    "exec > /var/log/install-tools.log 2>&1",
    "",
    "timeout 30 bash -c 'until timedatectl show -p NTPSynchronized --value | grep -q yes; do sleep 1; done' || true",
    "apt-get -o Acquire::Check-Valid-Until=false update -qq",
    "",
  ];

  for (const [name, cfg] of Object.entries(packages)) {
    if (cfg.enabled === false) {
      continue;
    }
    const builder = installers[name];
    if (!builder) {
      continue;
    }
    lines.push(...builder(cfg, ubuntuArch), "");
  }

  lines.push('echo "==> Done."');
  return lines.join("\n");
}

function yamlDq(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function buildUserData(
  pubKey: string,
  installScript: string,
  username: string
): string {
  if (!USERNAME_RE.test(username)) {
    throw new Error(
      `Invalid username "${username}": only [A-Za-z0-9_-] allowed`
    );
  }
  const scriptLines = installScript
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
  return `#cloud-config
users:
  - name: ${yamlDq(username)}
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    groups: [adm, dialout, cdrom, sudo, audio, dip, video, plugdev, netdev, lxd]
    ssh_authorized_keys:
      - ${yamlDq(pubKey)}

write_files:
  - path: /usr/local/bin/install-tools.sh
    permissions: '0755'
    content: |
${scriptLines}

runcmd:
  - /usr/local/bin/install-tools.sh
`;
}

export function buildSeedImage(
  metaData: string,
  userData: string,
  destPath: string
): void {
  // VZDiskImageStorageDeviceAttachment does not accept ISO 9660.
  // Create a raw FAT16 image (same approach as vmm's prepare-ubuntu-efi.sh).
  rmSync(destPath, { force: true });
  execFileSync(
    "dd",
    ["if=/dev/zero", `of=${destPath}`, "bs=1024", "count=4096"],
    { stdio: "ignore" }
  );

  const attachOutput = execFileSync(
    "hdiutil",
    [
      "attach",
      "-imagekey",
      "diskimage-class=CRawDiskImage",
      "-nomount",
      destPath,
    ],
    { encoding: "utf-8" }
  ).trim();
  const [device] = attachOutput.split(/\s+/u);
  if (!device) {
    throw new Error("hdiutil attach produced no device");
  }

  try {
    execFileSync("newfs_msdos", ["-v", "CIDATA", device], { stdio: "ignore" });
    execFileSync("diskutil", ["mount", device], { stdio: "ignore" });
    const info = execFileSync("diskutil", ["info", device], {
      encoding: "utf-8",
    });
    const mp = info.match(/Mount Point:\s+(.+)/u)?.[1]?.trim();
    if (!mp) {
      throw new Error("Could not determine mount point for seed disk");
    }

    writeFileSync(join(mp, "meta-data"), metaData, "utf-8");
    writeFileSync(join(mp, "user-data"), userData, "utf-8");
  } finally {
    execFileSync("hdiutil", ["detach", device], { stdio: "ignore" });
  }
}

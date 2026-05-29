import type { PackageConfig } from "@inputforge/providers";

type InstallerFn = (
  cfg: PackageConfig,
  ubuntuArch: "arm64" | "amd64"
) => string[];

const PACKAGE_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u;

function safeVersion(version: string): string {
  if (!PACKAGE_VERSION_RE.test(version)) {
    throw new Error(`Invalid package version: ${version}`);
  }
  return version;
}

const installers: Record<string, InstallerFn> = {
  bun({ version: rawVersion = "latest" }, ubuntuArch) {
    const version = safeVersion(rawVersion);
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

  go({ version: rawVersion = "1.24.3" }, ubuntuArch) {
    const version = safeVersion(rawVersion);
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

  java({ version: rawVersion = "21" }) {
    const version = safeVersion(rawVersion);
    return [
      `echo "==> OpenJDK ${version}..."`,
      `apt-get install -y openjdk-${version}-jdk`,
      `echo "java: $(java --version 2>&1 | head -1)"`,
    ];
  },

  nodejs({ version: rawVersion = "22" }) {
    const version = safeVersion(rawVersion);
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

  swift({ version: rawVersion = "6.0.3" }, ubuntuArch) {
    const version = safeVersion(rawVersion);
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
    "apt-get update -qq",
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

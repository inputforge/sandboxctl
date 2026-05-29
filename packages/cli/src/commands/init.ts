import { userInfo } from "node:os";
import { basename } from "node:path";

import {
  cancel,
  intro,
  isCancel,
  multiselect,
  outro,
  select,
  text,
} from "@clack/prompts";

import {
  readSandboxConfigOptional,
  writeSandboxConfig,
} from "../lib/sandbox.js";
import type { SandboxConfig } from "../lib/sandbox.js";

const VERSIONED_PACKAGES = new Set(["nodejs", "bun", "java", "go", "swift"]);
const SIZE_RE = /^\d+[MG]$/iu;

const PACKAGE_DEFAULTS: Record<string, string> = {
  bun: "1.3.12",
  go: "1.24.3",
  java: "21",
  nodejs: "22",
  swift: "6.0.3",
};

const ALL_PACKAGES = [
  "nodejs",
  "bun",
  "python",
  "java",
  "go",
  "ruby",
  "php",
  "swift",
];

function bail(): never {
  cancel("Cancelled.");
  process.exit(0);
}

async function collectPackageVersions(
  selectedPackages: string[],
  existing: SandboxConfig | null
): Promise<SandboxConfig["packages"] | null> {
  const packages: SandboxConfig["packages"] = {};
  for (const pkg of selectedPackages) {
    if (VERSIONED_PACKAGES.has(pkg)) {
      const existingVersion = existing?.packages[pkg]?.version;
      const ver = await text({
        initialValue: existingVersion ?? PACKAGE_DEFAULTS[pkg] ?? "latest",
        message: `${pkg} version`,
      });
      if (isCancel(ver)) {
        return null;
      }
      packages[pkg] = { enabled: true, version: ver as string };
    } else {
      packages[pkg] = { enabled: true };
    }
  }
  return packages;
}

async function collectVmResources(
  existing: SandboxConfig | null
): Promise<SandboxConfig["vm"] | null> {
  const cpusRaw = await text({
    initialValue: String(existing?.vm.cpus ?? 4),
    message: "CPUs",
    validate: (v) =>
      !Number.isInteger(Number(v)) || Number(v) < 1
        ? "Must be a positive integer"
        : undefined,
  });
  if (isCancel(cpusRaw)) {
    return null;
  }

  const memory = await text({
    initialValue: existing?.vm.memory ?? "4G",
    message: "Memory",
    placeholder: "4G",
    validate: (v) =>
      SIZE_RE.test(v ?? "") ? undefined : "Format: e.g. 4G or 2048M",
  });
  if (isCancel(memory)) {
    return null;
  }

  const disk = await text({
    initialValue: existing?.vm.disk ?? "20G",
    message: "Disk size",
    placeholder: "20G",
    validate: (v) =>
      SIZE_RE.test(v ?? "") ? undefined : "Format: e.g. 20G or 10240M",
  });
  if (isCancel(disk)) {
    return null;
  }

  return {
    cpus: Number(cpusRaw),
    disk: disk as string,
    memory: memory as string,
  };
}

async function collectEc2Config(
  existing: SandboxConfig | null
): Promise<SandboxConfig["ec2"] | null> {
  const region = await text({
    initialValue: existing?.ec2?.region ?? "",
    message: "EC2 region",
    placeholder: "us-east-1",
    validate: (v) => ((v ?? "").trim() ? undefined : "Region is required"),
  });
  if (isCancel(region)) {
    return null;
  }

  const arch = await select<"amd64" | "arm64">({
    initialValue: existing?.ec2?.arch ?? "amd64",
    message: "EC2 architecture",
    options: [
      { label: "x86_64 / amd64 (t3, m/c/r families)", value: "amd64" },
      { label: "arm64 / Graviton (t4g, m/c/r g families)", value: "arm64" },
    ],
  });
  if (isCancel(arch)) {
    return null;
  }

  const sshCidr = await text({
    initialValue: existing?.ec2?.sshCidr ?? "",
    message: "SSH allowed CIDR",
    placeholder: "203.0.113.10/32",
    validate: (v) =>
      (v ?? "").trim()
        ? undefined
        : "CIDR is required, for example your public IP with /32",
  });
  if (isCancel(sshCidr)) {
    return null;
  }

  const instanceType = await text({
    initialValue: existing?.ec2?.instanceType ?? "",
    message: "EC2 instance type",
    placeholder: "optional, mapped from CPUs/memory when blank",
  });
  if (isCancel(instanceType)) {
    return null;
  }

  const trimmedInstanceType = (instanceType as string).trim();
  return {
    arch,
    region: (region as string).trim(),
    sshCidr: (sshCidr as string).trim(),
    ...(trimmedInstanceType ? { instanceType: trimmedInstanceType } : {}),
  };
}

async function collectProviderConfig(existing: SandboxConfig | null): Promise<{
  ec2Config?: SandboxConfig["ec2"];
  provider: NonNullable<SandboxConfig["provider"]>;
} | null> {
  const provider = await select<NonNullable<SandboxConfig["provider"]>>({
    initialValue: existing?.provider ?? "local",
    message: "Provider",
    options: [
      { label: "local (QEMU)", value: "local" },
      { label: "ec2 (AWS EC2)", value: "ec2" },
      { label: "vmm (macOS Apple Silicon)", value: "vmm" },
    ],
  });
  if (isCancel(provider)) {
    return null;
  }

  if (provider !== "ec2") {
    return { provider };
  }

  const ec2Config = await collectEc2Config(existing);
  if (!ec2Config) {
    return null;
  }

  return { ec2Config, provider };
}

async function collectPackages(
  existing: SandboxConfig | null
): Promise<SandboxConfig["packages"] | null> {
  const initialSelected = existing
    ? ALL_PACKAGES.filter((pkg) => existing.packages[pkg]?.enabled === true)
    : [];

  const selectedRaw = await multiselect<string>({
    initialValues: initialSelected.length > 0 ? initialSelected : undefined,
    message: "Select packages to install",
    options: [
      { label: "Node.js", value: "nodejs" },
      { label: "Bun", value: "bun" },
      { label: "Python 3", value: "python" },
      { label: "Java (OpenJDK)", value: "java" },
      { label: "Go", value: "go" },
      { label: "Ruby", value: "ruby" },
      { label: "PHP", value: "php" },
      { label: "Swift", value: "swift" },
    ],
    required: false,
  });
  if (isCancel(selectedRaw)) {
    return null;
  }
  const selectedPackages = selectedRaw as string[];

  const packages = await collectPackageVersions(selectedPackages, existing);
  if (!packages) {
    return null;
  }

  for (const pkg of ALL_PACKAGES) {
    if (!(pkg in packages)) {
      packages[pkg] = { enabled: false };
    }
  }
  return packages;
}

export async function runInitPrompts(
  existing: SandboxConfig | null
): Promise<SandboxConfig | null> {
  const name = basename(process.cwd());

  const providerConfig = await collectProviderConfig(existing);
  if (!providerConfig) {
    return null;
  }

  const ubuntu = await select<string>({
    initialValue: existing?.ubuntu ?? "26.04",
    message: "Ubuntu version",
    options: [
      { label: "Ubuntu 26.04 LTS (Resolute Raccoon)", value: "26.04" },
      { label: "Ubuntu 24.04 LTS (Noble Numbat)", value: "24.04" },
    ],
  });
  if (isCancel(ubuntu)) {
    return null;
  }

  const vm = await collectVmResources(existing);
  if (!vm) {
    return null;
  }

  const packages = await collectPackages(existing);
  if (!packages) {
    return null;
  }

  const defaultUsername = existing?.username ?? userInfo().username;
  const remotePath = await text({
    initialValue:
      existing?.send?.remotePath ?? `/home/${defaultUsername}/${name}`,
    message: "Remote path for file sync",
  });
  if (isCancel(remotePath)) {
    return null;
  }

  return {
    ...(providerConfig.provider === "ec2" && providerConfig.ec2Config
      ? { ec2: providerConfig.ec2Config }
      : {}),
    packages,
    provider: providerConfig.provider,
    send: { remotePath: remotePath as string },
    ubuntu: ubuntu as string,
    username: defaultUsername,
    vm,
  };
}

export async function init(): Promise<void> {
  const name = basename(process.cwd());
  const existing = readSandboxConfigOptional();
  const isModify = existing !== null;

  intro(
    isModify
      ? `create-sandbox — modifying config for "${name}"`
      : `create-sandbox — initializing "${name}"`
  );

  const config = await runInitPrompts(existing);
  if (!config) {
    bail();
  }

  writeSandboxConfig(config);
  outro("sandbox.json saved. Run: create-sandbox start");
}

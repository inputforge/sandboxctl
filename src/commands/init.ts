import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  outro,
  select,
  text,
} from "@clack/prompts";

import { writeSandboxConfig } from "../lib/sandbox.js";
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

function bail(): never {
  cancel("Cancelled.");
  process.exit(0);
}

async function collectPackageVersions(
  selectedPackages: string[]
): Promise<SandboxConfig["packages"] | null> {
  const packages: SandboxConfig["packages"] = {};
  for (const pkg of selectedPackages) {
    if (VERSIONED_PACKAGES.has(pkg)) {
      const ver = await text({
        initialValue: PACKAGE_DEFAULTS[pkg] ?? "latest",
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

export async function init(): Promise<void> {
  const name = basename(process.cwd());
  intro(`create-sandbox — initializing "${name}"`);

  const sandboxJsonPath = join(process.cwd(), "sandbox.json");
  if (existsSync(sandboxJsonPath)) {
    const overwrite = await confirm({
      initialValue: false,
      message: "sandbox.json already exists. Overwrite?",
    });
    if (isCancel(overwrite) || !overwrite) {
      bail();
    }
  }

  // Ubuntu version
  const ubuntu = await select<string>({
    initialValue: "26.04",
    message: "Ubuntu version",
    options: [
      { label: "Ubuntu 26.04 LTS (Resolute Raccoon)", value: "26.04" },
      { label: "Ubuntu 24.04 LTS (Noble Numbat)", value: "24.04" },
    ],
  });
  if (isCancel(ubuntu)) {
    bail();
  }

  // VM resources
  const cpusRaw = await text({
    initialValue: "4",
    message: "CPUs",
    validate: (v) =>
      Number.isNaN(Number(v)) || Number(v) < 1
        ? "Must be a positive integer"
        : undefined,
  });
  if (isCancel(cpusRaw)) {
    bail();
  }

  const memory = await text({
    initialValue: "4G",
    message: "Memory",
    placeholder: "4G",
    validate: (v) =>
      SIZE_RE.test(v ?? "") ? undefined : "Format: e.g. 4G or 2048M",
  });
  if (isCancel(memory)) {
    bail();
  }

  const disk = await text({
    initialValue: "20G",
    message: "Disk size",
    placeholder: "20G",
    validate: (v) =>
      SIZE_RE.test(v ?? "") ? undefined : "Format: e.g. 20G or 10240M",
  });
  if (isCancel(disk)) {
    bail();
  }

  // Package selection
  const selectedRaw = await multiselect<string>({
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
    bail();
  }
  const selectedPackages = selectedRaw as string[];

  // Versions for selected versioned packages
  const packages = await collectPackageVersions(selectedPackages);
  if (!packages) {
    bail();
  }

  // Mark unselected packages as disabled
  const allPackages = [
    "nodejs",
    "bun",
    "python",
    "java",
    "go",
    "ruby",
    "php",
    "swift",
  ];
  for (const pkg of allPackages) {
    if (!(pkg in packages)) {
      packages[pkg] = { enabled: false };
    }
  }

  // Remote path
  const remotePath = await text({
    initialValue: `/home/ubuntu/${name}`,
    message: "Remote path for file sync",
  });
  if (isCancel(remotePath)) {
    bail();
  }

  const config: SandboxConfig = {
    packages,
    send: { remotePath: remotePath as string },
    ubuntu: ubuntu as string,
    vm: {
      cpus: Number(cpusRaw),
      disk: disk as string,
      memory: memory as string,
    },
  };

  writeSandboxConfig(config);
  outro("sandbox.json created. Run: create-sandbox start");
}

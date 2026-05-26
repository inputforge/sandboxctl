import { execFileSync } from "node:child_process";

import type { PlatformConfig } from "./platform.js";

interface Prereq {
  bin: string;
  installCmd: string;
  label: string;
}

function getPrereqs(pc: PlatformConfig): Prereq[] {
  if (pc.platform === "macos") {
    return [
      {
        bin: "limactl",
        installCmd: "brew install lima",
        label: "Lima (limactl)",
      },
    ];
  }
  return [
    {
      bin: pc.qemuBin,
      installCmd: "sudo apt install qemu-system",
      label: `QEMU (${pc.qemuBin})`,
    },
    {
      bin: "qemu-img",
      installCmd: "sudo apt install qemu-utils",
      label: "QEMU disk tools (qemu-img)",
    },
  ];
}

function isAvailable(bin: string): boolean {
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function checkPrerequisites(pc: PlatformConfig): void {
  for (const prereq of getPrereqs(pc)) {
    if (!isAvailable(prereq.bin)) {
      console.error(
        `Missing prerequisite: ${prereq.label}\n  Install with: ${prereq.installCmd}`
      );
      process.exit(1);
    }
  }
}

export interface PrereqResult {
  bin: string;
  installCmd: string;
  label: string;
  ok: boolean;
}

export function reportPrerequisites(pc: PlatformConfig): PrereqResult[] {
  return getPrereqs(pc).map((prereq) => ({
    ...prereq,
    ok: isAvailable(prereq.bin),
  }));
}

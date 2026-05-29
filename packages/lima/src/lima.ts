import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SandboxConfig } from "@inputforge/providers";
import { z } from "zod";

import { limaHome } from "./paths.js";
import type { PlatformConfig } from "./platform.js";
import { getUbuntuImageUrl } from "./platform.js";

const limaEnv = { ...process.env, LIMA_HOME: limaHome };

export function limaInstanceDir(name: string): string {
  return join(limaHome, name);
}

function limaYamlPath(name: string): string {
  return join(limaInstanceDir(name), "lima.yaml");
}

function toLibaSize(s: string): string {
  if (s.endsWith("G")) {
    return `${s.slice(0, -1)}GiB`;
  }
  if (s.endsWith("M")) {
    return `${s.slice(0, -1)}MiB`;
  }
  return s;
}

const LimaInstanceSchema = z.object({
  dir: z.string(),
  name: z.string(),
  sshLocalPort: z.number(),
  status: z.string(),
});

export type LimaInstance = z.infer<typeof LimaInstanceSchema>;

export function getLimaInstance(name: string): LimaInstance | null {
  try {
    const out = execFileSync("limactl", ["list", "--format", "json"], {
      encoding: "utf-8",
      env: limaEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    for (const line of out.trim().split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = LimaInstanceSchema.parse(JSON.parse(line));
        if (entry.name === name) {
          return entry;
        }
      } catch {
        // skip malformed lines
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function isLimaRunning(name: string): boolean {
  return getLimaInstance(name)?.status === "Running";
}

function indentLines(s: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return s
    .split("\n")
    .map((l) => (l.trim() ? `${pad}${l}` : ""))
    .join("\n");
}

export function buildLimaYaml(
  config: SandboxConfig,
  pc: PlatformConfig,
  installScript: string,
  pubKey: string
): string {
  const imageUrl = getUbuntuImageUrl(config.ubuntu, pc.ubuntuArch);
  const limaArch = pc.arch === "arm64" ? "aarch64" : "x86_64";

  const { username } = config;
  const sshKeyScript = [
    "#!/bin/bash",
    "set -euo pipefail",
    `mkdir -p /home/${username}/.ssh`,
    `echo '${pubKey}' >> /home/${username}/.ssh/authorized_keys`,
    `sort -u /home/${username}/.ssh/authorized_keys -o /home/${username}/.ssh/authorized_keys`,
    `chown -R ${username}:${username} /home/${username}/.ssh`,
    `chmod 700 /home/${username}/.ssh`,
    `chmod 600 /home/${username}/.ssh/authorized_keys`,
  ].join("\n");

  const portForwardLines = (config.ports ?? [])
    .map(
      (f) =>
        `  - guestPort: ${f.guest}\n    hostPort: ${f.host}\n    proto: ${f.protocol ?? "tcp"}`
    )
    .join("\n");

  const parts = [
    "vmType: vz",
    "os: Linux",
    "containerd:",
    "  system: false",
    "  user: false",
    `arch: ${limaArch}`,
    "images:",
    `  - location: "${imageUrl}"`,
    `    arch: ${limaArch}`,
    `cpus: ${config.vm.cpus}`,
    `memory: "${toLibaSize(config.vm.memory)}"`,
    `disk: "${toLibaSize(config.vm.disk)}"`,
    "user:",
    `  name: "${username}"`,
    "ssh:",
    "  localPort: 0",
    "  loadDotSSHPubKeys: true",
    "provision:",
    "  - mode: system",
    "    script: |",
    indentLines(installScript, 6),
    "  - mode: system",
    "    script: |",
    indentLines(sshKeyScript, 6),
  ];

  if (portForwardLines) {
    parts.push("portForwards:", portForwardLines);
  }

  return `${parts.join("\n")}\n`;
}

export function writeLimaYaml(name: string, yaml: string): void {
  mkdirSync(limaInstanceDir(name), { recursive: true });
  writeFileSync(limaYamlPath(name), yaml, "utf-8");
}

export function checkLimactlInstalled(): void {
  try {
    execFileSync("limactl", ["--version"], { stdio: "ignore" });
  } catch {
    console.error(
      "Lima is required on macOS. Install it with: brew install lima"
    );
    process.exit(1);
  }
}

export async function startLimaInstance(
  name: string,
  logPath: string
): Promise<void> {
  const logFd = openSync(logPath, "a");
  const child = spawn("limactl", ["start", "--tty=false", name], {
    env: limaEnv,
    stdio: ["ignore", logFd, logFd],
  });
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`limactl start exited with code ${code}`);
  }
}

export function stopLimaInstance(name: string, logPath: string): void {
  const logFd = openSync(logPath, "a");
  execFileSync("limactl", ["stop", name], {
    env: limaEnv,
    stdio: ["ignore", logFd, logFd],
  });
}

export function deleteLimaInstance(name: string, logPath: string): void {
  const logFd = openSync(logPath, "a");
  try {
    execFileSync("limactl", ["stop", "--force", name], {
      env: limaEnv,
      stdio: ["ignore", logFd, logFd],
    });
  } catch {
    // already stopped or doesn't exist
  }
  execFileSync("limactl", ["delete", "--force", name], {
    env: limaEnv,
    stdio: ["ignore", logFd, logFd],
  });
}

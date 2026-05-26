import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { configSnapshotPath, stateJsonPath } from "./paths.js";

export interface PackageConfig {
  enabled?: boolean;
  version?: string;
}

export interface PortForward {
  guest: number;
  host: number;
  protocol?: "tcp" | "udp";
}

export interface SandboxConfig {
  ec2?: {
    arch?: "arm64" | "amd64";
    instanceType?: string;
    region?: string;
  };
  packages: Record<string, PackageConfig>;
  ports?: PortForward[];
  provider?: "local" | "ec2";
  send?: {
    remotePath?: string;
  };
  ubuntu: string;
  vm: {
    cpus: number;
    memory: string;
    disk: string;
  };
}

export interface SandboxState {
  host: string;
  identityFile?: string;
  port: number;
  startedAt: string;
}

export function readSandboxConfig(cwd: string = process.cwd()): SandboxConfig {
  const p = join(cwd, "sandbox.json");
  if (!existsSync(p)) {
    console.error(
      "No sandbox.json found in current directory. Run: create-sandbox init"
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, "utf-8")) as SandboxConfig;
}

export function writeSandboxConfig(
  config: SandboxConfig,
  cwd: string = process.cwd()
): void {
  writeFileSync(
    join(cwd, "sandbox.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf-8"
  );
}

export function readState(name?: string): SandboxState | null {
  const p = stateJsonPath(name);
  if (!existsSync(p)) {
    return null;
  }
  try {
    const state = JSON.parse(readFileSync(p, "utf-8")) as Partial<SandboxState>;
    if (!state.port || !state.startedAt) {
      return null;
    }
    return {
      host: state.host ?? "127.0.0.1",
      identityFile: state.identityFile,
      port: state.port,
      startedAt: state.startedAt,
    };
  } catch {
    return null;
  }
}

export function writeState(state: SandboxState, name?: string): void {
  writeFileSync(
    stateJsonPath(name),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf-8"
  );
}

export function getRemotePath(config: SandboxConfig): string {
  return config.send?.remotePath ?? `/home/ubuntu/${basename(process.cwd())}`;
}

export function readConfigSnapshot(name?: string): SandboxConfig | null {
  const p = configSnapshotPath(name);
  if (!existsSync(p)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as SandboxConfig;
  } catch {
    return null;
  }
}

export function writeConfigSnapshot(
  config: SandboxConfig,
  name?: string
): void {
  writeFileSync(
    configSnapshotPath(name),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf-8"
  );
}

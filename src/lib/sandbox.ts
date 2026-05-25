import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { stateJsonPath, configSnapshotPath } from './paths.js';

export interface PackageConfig {
  enabled?: boolean;
  version?: string;
}

export interface PortForward {
  host: number;
  guest: number;
  protocol?: 'tcp' | 'udp';
}

export interface SandboxConfig {
  ubuntu: string;
  vm: {
    cpus: number;
    memory: string;
    disk: string;
  };
  packages: Record<string, PackageConfig>;
  send?: {
    remotePath?: string;
  };
  ports?: PortForward[];
}

export interface SandboxState {
  port: number;
  startedAt: string;
}

export function readSandboxConfig(cwd: string = process.cwd()): SandboxConfig {
  const p = join(cwd, 'sandbox.json');
  if (!existsSync(p)) {
    console.error('No sandbox.json found in current directory. Run: create-sandbox init');
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf8')) as SandboxConfig;
}

export function writeSandboxConfig(config: SandboxConfig, cwd: string = process.cwd()): void {
  writeFileSync(join(cwd, 'sandbox.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function readState(name?: string): SandboxState | null {
  const p = stateJsonPath(name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SandboxState;
  } catch {
    return null;
  }
}

export function writeState(state: SandboxState, name?: string): void {
  writeFileSync(stateJsonPath(name), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function getRemotePath(config: SandboxConfig): string {
  return config.send?.remotePath ?? `/home/ubuntu/${basename(process.cwd())}`;
}

export function readConfigSnapshot(name?: string): SandboxConfig | null {
  const p = configSnapshotPath(name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SandboxConfig;
  } catch {
    return null;
  }
}

export function writeConfigSnapshot(config: SandboxConfig, name?: string): void {
  writeFileSync(configSnapshotPath(name), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

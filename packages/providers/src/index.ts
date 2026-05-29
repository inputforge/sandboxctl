export interface VmStartResult {
  host: string;
  identityFile?: string;
  port: number;
}

export interface SpinnerHandle {
  update(message: string): void;
  stop(message?: string): void;
}

export interface ProgressHandle {
  advance(delta: number, status?: string): void;
  stop(message?: string): void;
}

export interface ProviderReporter {
  spin(label: string): SpinnerHandle;
  progress(label: string, total?: number): ProgressHandle;
  step(message: string): void;
  log(line: string): void;
}

export interface VmProvider {
  /** Fast, synchronous local existence check (e.g. filesystem). Must not perform network I/O. */
  isInitialized(name: string): boolean;
  /** Asynchronous runtime liveness probe (e.g. PID check, API call). Use when true running state is needed. */
  isRunning(name: string): Promise<boolean>;
  /**
   * Start the VM (first or subsequent boot). Handles all provider-specific
   * setup, boot sequencing, and waiting until SSH + provisioning are ready.
   * Returns the SSH endpoint.
   */
  start(
    config: SandboxConfig,
    name: string,
    snapshot: SandboxConfig | null,
    reporter: ProviderReporter
  ): Promise<VmStartResult>;
  stop(name: string, reporter: ProviderReporter): Promise<void>;
  destroy(name: string, reporter: ProviderReporter): Promise<void>;
}

export interface PackageConfig {
  enabled?: boolean;
  version?: string;
}

export interface PortForward {
  guest: number;
  host: number;
  protocol?: "tcp" | "udp";
}

export interface Ec2Config {
  arch?: "arm64" | "amd64";
  instanceType?: string;
  region?: string;
  sshCidr?: string;
}

export interface VmmHostConfig {
  boot?: "efi" | "linux";
}

export interface SandboxConfig {
  ec2?: Ec2Config;
  vmm?: VmmHostConfig;
  packages: Record<string, PackageConfig>;
  ports?: PortForward[];
  provider?: "local" | "ec2" | "vmm";
  send?: {
    remotePath?: string;
  };
  ubuntu: string;
  username: string;
  vm: {
    arch?: "arm64" | "amd64";
    cpus: number;
    disk: string;
    memory: string;
  };
}

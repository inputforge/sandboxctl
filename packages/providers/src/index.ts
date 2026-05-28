export interface VmStartResult {
  host: string;
  identityFile?: string;
  port: number;
}

export interface VmProvider {
  isInitialized(name: string): boolean;
  isRunning(name: string): Promise<boolean>;
  /**
   * Start the VM (first or subsequent boot). Handles all provider-specific
   * setup, boot sequencing, and waiting until SSH + provisioning are ready.
   * Returns the SSH endpoint.
   */
  start(
    config: SandboxConfig,
    name: string,
    snapshot: SandboxConfig | null
  ): Promise<VmStartResult>;
  stop(name: string): Promise<void>;
  destroy(name: string): Promise<void>;
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

export interface SandboxConfig {
  ec2?: Ec2Config;
  packages: Record<string, PackageConfig>;
  ports?: PortForward[];
  provider?: "local" | "ec2" | "vmm";
  send?: {
    remotePath?: string;
  };
  ubuntu: string;
  username: string;
  vm: {
    cpus: number;
    disk: string;
    memory: string;
  };
}

import { EventEmitter, once } from "node:events";
import { readFileSync } from "node:fs";

import type {
  ProgressHandle,
  ProviderReporter,
  SandboxConfig,
  SandboxHandle,
  SpinnerHandle,
  VmProvider,
} from "@inputforge/sandboxctl-providers";
import { Client } from "ssh2";
import type { ClientChannel, SFTPWrapper } from "ssh2";

import { defaultIdentity } from "./identity.js";
import type { SandboxIdentity } from "./identity.js";
import { SandboxFs } from "./sandbox-fs.js";
import { SandboxProcess } from "./sandbox-process.js";

export interface SandboxStatus {
  handle?: SandboxHandle;
  host?: string;
  port?: number;
  running: boolean;
}

interface SandboxOptions {
  config: SandboxConfig;
  identity?: SandboxIdentity;
  name: string;
  provider: VmProvider;
}

interface SandboxEvents {
  log: [line: string];
  progress: [
    detail: {
      delta: number;
      label: string;
      status?: string;
      total?: number;
    },
  ];
  step: [message: string];
}

async function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class Sandbox extends EventEmitter<SandboxEvents> {
  readonly config: SandboxConfig;
  readonly name: string;

  private readonly _provider: VmProvider;
  private readonly _identity: SandboxIdentity;
  private _handle: SandboxHandle | null = null;
  private _sshClient: Client | null = null;
  private _sftpClient: SFTPWrapper | null = null;
  private _fs: SandboxFs | null = null;

  constructor({ config, identity, name, provider }: SandboxOptions) {
    super();
    this.name = name;
    this.config = config;
    this._provider = provider;
    this._identity = identity ?? defaultIdentity();
  }

  async start(): Promise<void> {
    if (this._handle) {
      return;
    }
    const running = await this._provider.isRunning(this.name);
    if (running) {
      this._handle = await this._provider.resolve(this.name);
      return;
    }
    const reporter = this._createReporter();
    this._handle = await this._provider.start(
      this.config,
      this.name,
      null,
      reporter
    );
  }

  async stop(): Promise<void> {
    this.disconnect();
    const reporter = this._createReporter();
    await this._provider.stop(this.name, reporter);
    this._handle = null;
  }

  async destroy(): Promise<void> {
    this.disconnect();
    const reporter = this._createReporter();
    await this._provider.destroy(this.name, reporter);
    this._handle = null;
  }

  async status(): Promise<SandboxStatus> {
    const running = await this._provider.isRunning(this.name);
    if (!running) {
      return { running: false };
    }
    const handle = this._handle ?? (await this._provider.resolve(this.name));
    return {
      handle: handle ?? undefined,
      host: handle?.host,
      port: handle?.port,
      running: true,
    };
  }

  async exec(
    command: string
  ): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    const proc = this.execStreamed(command);

    const [stdout, stderr] = await Promise.all([
      collectStream(proc.stdout),
      collectStream(proc.stderr),
    ]);

    return {
      exitCode: proc.exitCode ?? 0,
      stderr: stderr.toString("utf-8"),
      stdout: stdout.toString("utf-8"),
    };
  }

  execStreamed(command: string): SandboxProcess {
    return new SandboxProcess(async () => await this._openChannel(command));
  }

  get fs(): SandboxFs {
    this._fs ??= new SandboxFs(async () => await this._ensureSftp());
    return this._fs;
  }

  disconnect(): void {
    this._fs = null;
    this._sftpClient = null;
    if (this._sshClient) {
      this._sshClient.end();
      this._sshClient = null;
    }
  }

  private async _ensureHandle(): Promise<SandboxHandle> {
    if (this._handle) {
      return this._handle;
    }
    const handle = await this._provider.resolve(this.name);
    if (!handle) {
      throw new Error(
        `Sandbox "${this.name}" is not running. Call start() first.`
      );
    }
    this._handle = handle;
    return handle;
  }

  private async _connect(): Promise<Client> {
    if (this._sshClient) {
      return this._sshClient;
    }
    const handle = await this._ensureHandle();
    const privateKey = this._resolvePrivateKey();
    const client = new Client();
    client.connect({
      host: handle.host,
      // Sandboxes use ephemeral keys; skip host verification
      hostVerifier: () => true,
      port: handle.port,
      privateKey,
      username: this.config.username,
    });
    await once(client, "ready");
    this._sshClient = client;
    return client;
  }

  private async _ensureSftp(): Promise<SFTPWrapper> {
    if (this._sftpClient) {
      return this._sftpClient;
    }
    const client = await this._connect();
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, s) => {
        if (err) {
          reject(err);
        } else {
          resolve(s);
        }
      });
    });
    this._sftpClient = sftp;
    return sftp;
  }

  private async _openChannel(command: string): Promise<ClientChannel> {
    const client = await this._connect();
    return await new Promise<ClientChannel>((resolve, reject) => {
      client.exec(command, (err, channel) => {
        if (err) {
          reject(err);
        } else {
          resolve(channel);
        }
      });
    });
  }

  private _resolvePrivateKey(): Buffer {
    if (this._identity.privateKey) {
      return Buffer.from(this._identity.privateKey, "utf-8");
    }
    if (this._identity.privateKeyPath) {
      return readFileSync(this._identity.privateKeyPath);
    }
    throw new Error(
      "SandboxIdentity must have either privateKey or privateKeyPath"
    );
  }

  private _createReporter(): ProviderReporter {
    return {
      log: (line) => void this.emit("log", line),
      progress: (label, total?): ProgressHandle => {
        this.emit("progress", { delta: 0, label, total });
        return {
          advance: (delta, status?) =>
            void this.emit("progress", { delta, label, status }),
          stop: (message?) => {
            if (message) {
              this.emit("step", message);
            }
          },
        };
      },
      spin: (label): SpinnerHandle => {
        this.emit("step", label);
        return {
          stop: (message?) => {
            if (message) {
              this.emit("step", message);
            }
          },
          update: (message) => void this.emit("step", message),
        };
      },
      step: (message) => void this.emit("step", message),
    };
  }
}

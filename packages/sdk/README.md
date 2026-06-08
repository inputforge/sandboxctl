# @inputforge/sandbox

Programmatic SDK for creating and managing sandboxctl VMs from Node.js.

## Installation

```sh
npm install @inputforge/sandbox
```

You also need a provider package for the VM backend you want to use:

| Provider                       | Package                       | Platform              |
| ------------------------------ | ----------------------------- | --------------------- |
| QEMU (cross-platform)          | `@inputforge/sandboxctl-qemu` | macOS, Linux          |
| Apple Virtualization.framework | `@inputforge/sandboxctl-vmm`  | macOS (Apple Silicon) |
| AWS EC2                        | `@inputforge/sandboxctl-ec2`  | any                   |

```sh
# macOS (Apple Silicon) — fastest option
npm install @inputforge/sandboxctl-vmm

# macOS (Intel) or Linux
npm install @inputforge/sandboxctl-qemu
```

## Quick Start

```ts
import { Sandbox } from "@inputforge/sandbox";
import { createVmmProvider } from "@inputforge/sandboxctl-vmm";

const sandbox = new Sandbox({
  name: "my-sandbox",
  provider: createVmmProvider(),
  config: {
    ubuntu: "24.04",
    username: "ubuntu",
    vm: { cpus: 2, memory: "2G", disk: "20G" },
    packages: { nodejs: { enabled: true, version: "22" } },
  },
});

await sandbox.start();

const { stdout } = await sandbox.exec("node --version");
console.log(stdout.trim()); // v22.x.x

await sandbox.stop();
```

## API

### `new Sandbox(options)`

```ts
interface SandboxOptions {
  name: string;
  provider: VmProvider;
  config: SandboxConfig;
  identity?: SandboxIdentity; // SSH key — defaults to ~/.ssh/id_ed25519 etc.
  hostVerifier?: (key: Buffer) => boolean; // defaults to in-memory TOFU
}
```

#### `sandbox.start(): Promise<void>`

Starts the VM. On first run, downloads the Ubuntu cloud image, provisions packages, and waits until SSH is ready. Subsequent calls are fast — the already-running VM is reattached if it's up.

#### `sandbox.stop(): Promise<void>`

Gracefully shuts down the VM and disconnects SSH.

#### `sandbox.destroy(): Promise<void>`

Deletes the VM and all associated disk images.

#### `sandbox.status(): Promise<SandboxStatus>`

```ts
interface SandboxStatus {
  running: boolean;
  host?: string;
  port?: number;
  handle?: SandboxHandle;
}
```

#### `sandbox.exec(command): Promise<{ stdout, stderr, exitCode }>`

Runs a command and buffers its output. Returns when the process exits.

```ts
const { stdout, stderr, exitCode } = await sandbox.exec("ls /home/ubuntu");
```

#### `sandbox.execStreamed(command): SandboxProcess`

Runs a command and returns a `SandboxProcess` with streaming stdout/stderr. Useful for long-running commands or when you want to process output incrementally.

```ts
const proc = sandbox.execStreamed("npm install");
proc.stdout.pipe(process.stdout);
proc.stderr.pipe(process.stderr);
await new Promise((resolve) => proc.on("exit", resolve));
```

#### `sandbox.fs`

Returns a `SandboxFs` instance for SFTP file operations. See [SandboxFs](#sandboxfs).

#### `sandbox.disconnect(): void`

Closes the underlying SSH connection without stopping the VM. Subsequent calls to `exec` or `fs` will reconnect automatically.

---

### `SandboxProcess`

Returned by `sandbox.execStreamed()`. Extends `EventEmitter`.

| Member          | Type             | Description                     |
| --------------- | ---------------- | ------------------------------- |
| `stdout`        | `Readable`       | Process stdout stream           |
| `stderr`        | `Readable`       | Process stderr stream           |
| `stdin`         | `Writable`       | Process stdin stream            |
| `exitCode`      | `number \| null` | Set when the process exits      |
| `kill(signal?)` | `void`           | Send a signal (default: `TERM`) |

**Events:**

- `exit(exitCode: number)` — emitted when the process exits
- `error(err: Error)` — emitted on connection or channel errors

---

### `SandboxFs`

Accessed via `sandbox.fs`. All methods are async and use SFTP under the hood.

| Method                                                 | Description                     |
| ------------------------------------------------------ | ------------------------------- |
| `read(path): Promise<Buffer>`                          | Read entire file into a buffer  |
| `write(path, data: Buffer \| Readable): Promise<void>` | Write buffer or stream to file  |
| `readdir(path): Promise<string[]>`                     | List directory entries          |
| `stat(path): Promise<Stats>`                           | Get file metadata               |
| `unlink(path): Promise<void>`                          | Delete a file                   |
| `mkdir(path): Promise<void>`                           | Create a directory              |
| `createReadStream(path): Promise<Readable>`            | Open a readable stream          |
| `createWriteStream(path): Promise<Writable>`           | Open a writable stream          |
| `raw(): Promise<SFTPWrapper>`                          | Access the raw ssh2 SFTP client |

---

### Sandbox Events

`Sandbox` extends `EventEmitter` and emits lifecycle events during `start()`, `stop()`, and `destroy()`.

```ts
sandbox.on("log", (line) => console.log(line));
sandbox.on("step", (message) => console.log(`  → ${message}`));
sandbox.on("progress", ({ label, delta, total, status }) => {
  // suitable for progress bars
});
```

| Event      | Payload                             | When                             |
| ---------- | ----------------------------------- | -------------------------------- |
| `log`      | `string`                            | Raw install log line from the VM |
| `step`     | `string`                            | A human-readable status message  |
| `progress` | `{ label, delta, total?, status? }` | Download or copy progress tick   |

---

### `SandboxIdentity`

Controls which SSH key is used to connect.

```ts
interface SandboxIdentity {
  privateKey?: string; // PEM string
  privateKeyPath?: string; // path to key file
}
```

`defaultIdentity()` walks `~/.ssh` and returns the first found key (`id_ed25519` → `id_rsa` → `id_ecdsa`).

---

### `SandboxConfig`

Full configuration shape:

```ts
interface SandboxConfig {
  ubuntu: string; // e.g. "24.04"
  username: string; // SSH user, typically "ubuntu"
  vm: {
    cpus: number;
    memory: string; // e.g. "2G", "1024M"
    disk: string; // e.g. "20G"
    arch?: "arm64" | "amd64";
  };
  packages: Record<string, { enabled?: boolean; version?: string }>;
  ports?: Array<{ host: number; guest: number; protocol?: "tcp" | "udp" }>;
  send?: { remotePath?: string };
  provider?: "local" | "ec2" | "vmm";
  ec2?: {
    arch?: "arm64" | "amd64";
    instanceType?: string;
    region?: string;
    sshCidr?: string;
  };
  vmm?: { boot?: "efi" | "linux" };
  hostVerification?: { mode?: "skip" | "tofu" | "strict" };
}
```

**Supported packages:**

| Key      | Versioned | Example version |
| -------- | --------- | --------------- |
| `nodejs` | yes       | `"22"`          |
| `bun`    | yes       | `"1.3.12"`      |
| `python` | no        | —               |
| `java`   | yes       | `"21"`          |
| `go`     | yes       | `"1.24.3"`      |
| `ruby`   | no        | —               |
| `php`    | no        | —               |
| `swift`  | yes       | `"6.0.3"`       |

---

## Examples

See the [`examples/`](./examples/) directory:

- [`basic.ts`](./examples/basic.ts) — start, exec, stop
- [`streaming.ts`](./examples/streaming.ts) — streaming exec with live output
- [`filesystem.ts`](./examples/filesystem.ts) — SFTP file operations
- [`events.ts`](./examples/events.ts) — listening to lifecycle events during boot

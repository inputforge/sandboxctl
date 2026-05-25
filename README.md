# create-sandbox

A CLI tool that spins up a Linux sandbox VM on your machine for local development. Powered by QEMU and Ubuntu cloud images — no Docker, no VirtualBox, no cloud account required.

## Requirements

- **macOS or Linux** (Windows support is experimental)
- **QEMU** — `brew install qemu` on macOS, or `apt install qemu-system-x86_64` on Linux
- **Node.js** 18+

## Installation

```sh
npm install -g @inputforge/create-sandbox
```

Or run directly in a project:

```sh
npx @inputforge/create-sandbox init
```

## Usage

```
create-sandbox <command>

Commands:
  init      Configure sandbox.json interactively
  start     Build (if needed) and boot the sandbox VM
  stop      Gracefully shut down the VM
  destroy   Delete the VM and all associated files
  status    Show sandbox name, status, SSH port, and uptime
  ssh       Open an interactive SSH session into the VM
  send      Sync project files from host → VM  (uses rsync or tar)
  receive   Sync files from VM → host
```

### Quickstart

```sh
cd my-project
create-sandbox init    # generates sandbox.json
create-sandbox start   # downloads Ubuntu, provisions, boots
create-sandbox ssh     # opens a shell inside the VM
```

On first `start`, the tool will:

1. Download the Ubuntu cloud image (cached in `~/.local/share/create-sandbox/images/`)
2. Create a QCOW2 overlay disk
3. Build a cloud-init seed image with your SSH public key and install script
4. Boot QEMU in the background
5. Stream the package install log until `==> Done.`
6. Rsync your project files into the VM

Subsequent `start` calls skip the provisioning step and boot in seconds.

## Configuration — `sandbox.json`

Running `create-sandbox init` generates this file interactively. You can also write it by hand:

```json
{
  "ubuntu": "24.04",
  "vm": {
    "cpus": 4,
    "memory": "4G",
    "disk": "20G"
  },
  "packages": {
    "nodejs": { "enabled": true, "version": "22" },
    "bun": { "enabled": false },
    "python": { "enabled": true },
    "go": { "enabled": false }
  },
  "send": {
    "remotePath": "/home/ubuntu/my-project"
  },
  "ports": [{ "host": 3000, "guest": 3000, "protocol": "tcp" }]
}
```

### Supported packages

| Package        | Versioned | Default |
| -------------- | --------- | ------- |
| Node.js        | yes       | 22      |
| Bun            | yes       | latest  |
| Python 3       | no        | —       |
| Java (OpenJDK) | yes       | 21      |
| Go             | yes       | 1.24.3  |
| Ruby           | no        | —       |
| PHP            | no        | —       |
| Swift          | yes       | 6.0.3   |

### Port forwarding

`ports` is an optional array of host↔guest port mappings forwarded through QEMU's user-mode networking. Useful for accessing a dev server running inside the VM.

### Config change rules

| Change                      | Action required     |
| --------------------------- | ------------------- |
| `ubuntu` version            | `destroy` + `start` |
| `packages`                  | `destroy` + `start` |
| `vm.disk` (grow only)       | `stop` + `start`    |
| `vm.cpus` / `vm.memory`     | `stop` + `start`    |
| `ports` / `send.remotePath` | `stop` + `start`    |

## File sync

`send` pushes your current directory to the VM (respects `.gitignore`). It uses `rsync` when available and falls back to `tar` over SSH.

```sh
create-sandbox send      # host → VM
create-sandbox receive   # VM → host
```

## Development

```sh
npm install
npm run build     # tsc
npm run dev       # tsc --watch
```

## License

MIT

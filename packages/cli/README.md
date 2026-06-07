# sandboxctl

A CLI tool that spins up a Linux sandbox VM on your machine for local development. Powered by QEMU and Ubuntu cloud images — no Docker, no VirtualBox, no cloud account required.

## Requirements

- **macOS or Linux** (Windows support is experimental)
- **QEMU** — `brew install qemu` (macOS) / `sudo apt install qemu-system qemu-utils` (Linux)
- **Node.js** 18+

## Quickstart

```sh
npx sandboxctl
```

Launches the setup wizard: checks prerequisites, configures `sandbox.json`, and optionally boots the VM.

Or install globally:

```sh
npm install -g sandboxctl
sandboxctl          # setup wizard
sandboxctl ssh      # shell inside the VM
```

## Commands

| Command | Description |
|---|---|
| `sandboxctl` | Interactive setup wizard |
| `sandboxctl init` | Configure `sandbox.json` |
| `sandboxctl start` | Build (if needed) and boot the VM |
| `sandboxctl stop` | Gracefully shut down the VM |
| `sandboxctl destroy` | Delete the VM and all associated files |
| `sandboxctl status` | Show name, status, SSH port, and uptime |
| `sandboxctl ssh` | Open an interactive SSH session |
| `sandboxctl send` | Sync project files host → VM |
| `sandboxctl receive` | Sync files VM → host |
| `sandboxctl forward [port]` | Forward a port (`<guest>` or `<host>:<guest>`) |
| `sandboxctl doctor` | Check required dependencies |

## Configuration — `sandbox.json`

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
    "python": { "enabled": true }
  },
  "send": {
    "remotePath": "/home/ubuntu/my-project"
  },
  "ports": [{ "host": 3000, "guest": 3000, "protocol": "tcp" }]
}
```

### Supported packages

| Package | Versioned |
|---|---|
| Node.js | yes |
| Bun | yes |
| Python 3 | no |
| Java (OpenJDK) | yes |
| Go | yes |
| Ruby | no |
| PHP | no |
| Swift | yes |

## Providers

sandboxctl supports multiple VM backends via the `provider` field in `sandbox.json`:

| Provider | Description | Platform |
|---|---|---|
| `local` (default) | QEMU — works everywhere | macOS, Linux |
| `vmm` | Apple Virtualization framework | macOS only |
| `ec2` | AWS EC2 | any |

## Agent Skill

sandboxctl ships an agent skill for Claude Code, Cursor, Codex, and other AI coding assistants:

```sh
npx skills add inputforge/sandboxctl
```

Ask your assistant: _"create a sandbox for this project"_ and it will run the full setup wizard inline.

## License

MIT

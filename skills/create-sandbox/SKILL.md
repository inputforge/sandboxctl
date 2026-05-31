---
name: create-sandbox
description: Create a sandbox.json config file for sandboxctl — analyzes the current project to detect runtime requirements and writes an appropriate VM configuration
version: 0.1.0
triggers:
  - create.?sandbox
  - setup.?sandbox
  - init.?sandbox
  - sandboxctl.?init
  - configure.?sandbox
  - new.?sandbox
---

# create-sandbox

Analyze the current project and write a `sandbox.json` for [sandboxctl](https://github.com/inputforge/create-sandbox), which boots a local Linux VM for development.

## Workflow

### Step 1: Check prerequisites

Detect the host platform and architecture:

```bash
uname -s   # Darwin = macOS, Linux = Linux
uname -m   # arm64 = Apple Silicon / ARM Linux, x86_64 = Intel/AMD
```

Determine the provider and what to check:

| Platform | Arch   | Provider | Prerequisite                                     |
| -------- | ------ | -------- | ------------------------------------------------ |
| macOS    | any    | `vmm`    | macOS 13 (Ventura) or later                      |
| Linux    | any    | `local`  | QEMU — `sudo apt install qemu-system qemu-utils` |
| Windows  | x86_64 | `local`  | QEMU for Windows                                 |

vmm uses Apple's Virtualization Framework and works on both Intel and Apple Silicon Macs. QEMU is only needed on Linux or when cross-architecture emulation is required.

**vmm (macOS):** Verify macOS version:

```bash
sw_vers -productVersion
```

If major version < 13, abort: "vmm requires macOS 13 (Ventura) or later."

**local/QEMU (Linux):** Check QEMU is installed:

```bash
which qemu-system-aarch64 || which qemu-system-x86_64
```

If missing, ask the user to confirm, then run `sudo apt install qemu-system qemu-utils`. Re-check after installation. If the user declines, exit.

### Step 2: Check for existing config

```bash
cat sandbox.json 2>/dev/null || echo "NOT_FOUND"
```

If `sandbox.json` already exists, ask the user whether to modify the existing config or overwrite it. Load the existing file as a base if modifying.

### Step 3: Detect project requirements

Inspect the current directory to identify languages and runtimes needed:

| Check                                                                       | Package | Note                                            |
| --------------------------------------------------------------------------- | ------- | ----------------------------------------------- |
| `bun.lockb`, `bun.lock`, or `bun` in `package.json` scripts                 | bun     | Prefer over nodejs when bun signals are present |
| `package.json` with no bun signals                                          | nodejs  |                                                 |
| `requirements.txt`, `pyproject.toml`, `setup.py`, `setup.cfg`, or `Pipfile` | python  |                                                 |
| `go.mod`                                                                    | go      |                                                 |
| `pom.xml`, `build.gradle`, or `build.gradle.kts`                            | java    |                                                 |
| `Gemfile`                                                                   | ruby    |                                                 |
| `composer.json`                                                             | php     |                                                 |
| `Package.swift`                                                             | swift   |                                                 |

When multiple runtimes are detected, list them and ask the user to confirm which to enable before continuing.

Detect port forwarding needs by scanning:

- `package.json` scripts for `--port <N>`, `-p <N>`, `PORT=<N>`
- `vite.config.*` for `server.port`
- `.env`, `.env.local`, `.env.development` for `PORT=` or `APP_PORT=`
- `Dockerfile` for `EXPOSE <N>` directives
- Framework defaults when config is absent: Next.js/CRA → 3000, Vite → 5173, Rails → 3000, Django/Flask/FastAPI/Laravel → 8000, Spring Boot → 8080

Detect the current username:

```bash
echo $USER
```

### Step 4: Determine VM resources

Defaults: 4 CPUs, 4G memory, 20G disk.

Scale up for:

- Java projects: 6 CPUs, 8G memory, 30G disk (JVM overhead)
- Large monorepos (≥10 packages): 8 CPUs, 8G memory, 40G disk
- Rust projects: 8 CPUs, 8G memory, 40G disk (compilation)
- Each additional runtime enabled beyond the first: +2G memory

Check available host memory before finalizing:

```bash
# macOS
sysctl -n hw.memsize | awk '{print $1/1073741824 " GB"}'
# Linux
free -h | awk '/^Mem:/{print $2}'
```

If the VM's requested memory exceeds 50% of host RAM, warn the user and suggest scaling down or using the `ec2` provider.

Show the planned allocation and ask the user to confirm or adjust before writing.

### Step 5: Determine package versions

Check project files for version requirements before falling back to defaults:

| Package | Where to check                                                         | Default    |
| ------- | ---------------------------------------------------------------------- | ---------- |
| nodejs  | `engines.node` in `package.json`, round up to nearest LTS (18/20/22)   | `"22"`     |
| bun     | `.bun-version` file or `packageManager` in `package.json`              | `"1.3.12"` |
| java    | `java.version` in `pom.xml` or `sourceCompatibility` in `build.gradle` | `"21"`     |
| go      | `go` directive in `go.mod`                                             | `"1.24.3"` |
| swift   | `.swift-version` file                                                  | `"6.0.3"`  |

### Step 6: Write sandbox.json

Write `sandbox.json` to the current directory. Include **all** supported packages with `enabled: false` for unused ones. Omit `version` for packages that don't support versioning (python, ruby, php).

```json
{
  "ubuntu": "26.04",
  "provider": "<vmm on macOS | local on Linux/Windows>",
  "username": "<detected-username>",
  "vm": {
    "arch": "<arm64|amd64>",
    "cpus": <cpus>,
    "memory": "<memory>",
    "disk": "<disk>"
  },
  "packages": {
    "nodejs": { "enabled": <true|false>, "version": "<version>" },
    "bun": { "enabled": <true|false>, "version": "<version>" },
    "python": { "enabled": <true|false> },
    "java": { "enabled": <true|false>, "version": "<version>" },
    "go": { "enabled": <true|false>, "version": "<version>" },
    "ruby": { "enabled": <true|false> },
    "php": { "enabled": <true|false> },
    "swift": { "enabled": <true|false>, "version": "<version>" }
  },
  "send": {
    "remotePath": "/home/<username>/<project-dir-basename>"
  },
  "ports": [
    { "host": <port>, "guest": <port>, "protocol": "tcp" }
  ]
}
```

Rules:

- `ubuntu` → `"26.04"` by default
- `provider` → auto-detected in Step 1: `"vmm"` on all macOS, `"local"` on Linux/Windows; use `"ec2"` only if the user explicitly requests it
- `vm.arch` → `"arm64"` when host is arm64, `"amd64"` when host is x86_64
- `send.remotePath` → `/home/<username>/<basename(cwd)>`
- Omit `ports` entirely if none are needed
- Only include `version` for packages that support it (nodejs, bun, java, go, swift)

### Step 7: Offer to start

After writing, summarize what was detected (runtimes enabled, ports mapped, VM size, provider), then ask:

> "Start the sandbox now? This will boot the VM — the first run downloads the Ubuntu image (~500 MB)."

If yes, run:

```bash
sandboxctl start
```

Stream the output inline. The VM is ready when provisioning completes and SSH is available.

If no, show:

```
Next steps:
  sandboxctl start   # boot the VM
  sandboxctl ssh     # open a shell inside the VM
  sandboxctl send    # sync project files into the VM
```

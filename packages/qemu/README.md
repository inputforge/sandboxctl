# @inputforge/sandboxctl-qemu

sandboxctl VM provider backed by QEMU. Works on macOS and Linux.

## Overview

This package implements the `VmProvider` interface using QEMU with Ubuntu cloud images. It handles image download, QCOW2 overlay disk creation, cloud-init seed generation, and SSH-based provisioning.

## Requirements

- QEMU: `brew install qemu` (macOS) or `sudo apt install qemu-system qemu-utils` (Linux/Debian)
- Node.js 18+

## Usage

This package is loaded automatically by the `sandboxctl` CLI when `provider` is set to `"local"` (the default) or unset. You do not need to import it directly unless building a custom integration.

```ts
import { createQemuProvider } from "@inputforge/sandboxctl-qemu";

const provider = createQemuProvider();
```

### Platform config

```ts
import { getPlatformConfig } from "@inputforge/sandboxctl-qemu";
import type { PlatformConfig } from "@inputforge/sandboxctl-qemu";

const config: PlatformConfig = getPlatformConfig();
```

`PlatformConfig` exposes the QEMU binary names and default machine type for the current host architecture (arm64 / amd64).

## How it works

1. Downloads the Ubuntu cloud image (cached in `~/.local/share/sandboxctl/images/`)
2. Creates a QCOW2 overlay disk at the configured size
3. Builds a cloud-init seed ISO with your SSH public key and install script
4. Boots QEMU in the background with host-forwarded SSH and guest ports
5. Waits for SSH and cloud-init provisioning to complete

## License

MIT

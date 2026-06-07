# @inputforge/sandboxctl-vmm

sandboxctl VM provider backed by the `vmm` Swift binary using Apple's Virtualization framework.

## Overview

This package implements the `VmProvider` interface using a native macOS Swift binary (`vmm`) that wraps the Apple Virtualization framework. It provides hardware-accelerated Linux VMs on Apple Silicon and Intel Macs — faster boot times and lower overhead than QEMU.

**macOS only.** The package declares `"os": ["darwin"]` and is a no-op on other platforms.

## Requirements

- macOS 13 (Ventura) or later
- Apple Silicon or Intel Mac
- The `vmm` binary is bundled in `dist/vmm` after building

## Usage

This package is loaded automatically by the `sandboxctl` CLI when `provider` is set to `"vmm"`. You do not need to import it directly unless building a custom integration.

```ts
import { createVmmProvider } from "@inputforge/sandboxctl-vmm";

const provider = createVmmProvider();
```

## Configuration

Set `provider: "vmm"` in `sandbox.json` and optionally configure boot mode:

```json
{
  "provider": "vmm",
  "vmm": {
    "boot": "efi"
  }
}
```

| Field | Default | Description |
|---|---|---|
| `boot` | `"efi"` | Boot mode: `"efi"` (standard) or `"linux"` (direct kernel boot) |

## How it works

1. Downloads Ubuntu cloud image, kernel, and initrd (cached in `~/.local/share/sandboxctl/`)
2. Converts the QCOW2 image to a raw disk
3. Builds a cloud-init seed ISO
4. Spawns the `vmm` binary, which creates the VM via the Apple Virtualization framework
5. Waits for SSH and provisioning to complete

## Building

The `vmm` Swift binary is built as part of `npm run build` on macOS:

```sh
npm run build
```

This runs `tsc` and then `make -C src-native sign` to compile and codesign the Swift binary.

## License

MIT

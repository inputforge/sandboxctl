# @inputforge/sandboxctl-providers

Shared TypeScript types and interfaces for sandboxctl VM providers.

## Overview

This package defines the contracts that all sandboxctl VM provider implementations must satisfy. It contains no runtime code — only type definitions.

## Interfaces

### `VmProvider`

The core interface every provider must implement:

| Method | Description |
|---|---|
| `isSupported()` | Returns `false` if the provider cannot run on this host (e.g. vmm on Linux) |
| `checkPrereqs()` | Throws if required binaries are missing |
| `reportPrereqs()` | Returns structured prerequisite check results |
| `isInitialized(name)` | Fast synchronous check — filesystem existence, no I/O |
| `isRunning(name)` | Async liveness probe — PID check, API call, etc. |
| `start(config, name, snapshot, reporter)` | Full VM lifecycle: provision + boot → returns SSH endpoint |
| `stop(name, reporter)` | Gracefully shut down the VM |
| `destroy(name, reporter)` | Delete VM and all associated files |

### `SandboxConfig`

Structured representation of `sandbox.json` — passed to `start()`.

### `ProviderReporter`

Progress reporting interface passed into provider methods for spinner, progress bar, step, and log output.

## Usage

```ts
import type { VmProvider, SandboxConfig, ProviderReporter } from "@inputforge/sandboxctl-providers";

class MyProvider implements VmProvider {
  // implement interface
}
```

## License

MIT

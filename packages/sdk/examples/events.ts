/**
 * Events example: listen to boot progress and install logs.
 *
 * Useful for showing a progress UI while the sandbox provisions.
 *
 * Run with: npx tsx examples/events.ts
 */

import { Sandbox } from "@inputforge/sandbox";
import {
  createQemuProvider,
  getPlatformConfig,
} from "@inputforge/sandboxctl-qemu";

const sandbox = new Sandbox({
  config: {
    packages: {
      nodejs: { enabled: true, version: "22" },
      python: { enabled: true },
    },
    ubuntu: "24.04",
    username: "ubuntu",
    vm: { cpus: 2, disk: "20G", memory: "2G" },
  },
  name: "example-events",
  provider: createQemuProvider(getPlatformConfig()),
});

// Human-readable step messages (e.g. "Downloading image", "Booting VM")
sandbox.on("step", (message) => {
  console.log(`  → ${message}`);
});

// Raw install log lines streamed from inside the VM
sandbox.on("log", (line) => {
  console.log(`    [vm] ${line}`);
});

// Progress ticks — suitable for a progress bar library
sandbox.on("progress", ({ label, delta, total, status }) => {
  const pct = total ? Math.round((delta / total) * 100) : "?";
  process.stdout.write(
    `\r  ${label}: ${pct}%${status ? ` (${status})` : ""}   `
  );
});

console.log("Starting sandbox (first boot may take a few minutes)...");
await sandbox.start();
console.log("\nSandbox is ready.");

const { stdout } = await sandbox.exec("node --version && python3 --version");
console.log(stdout.trim());

await sandbox.stop();

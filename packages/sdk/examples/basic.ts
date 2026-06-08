/**
 * Basic example: start a sandbox, run a command, stop.
 *
 * Run with: npx tsx examples/basic.ts
 */

import { Sandbox } from "@inputforge/sandbox";
import { createVmmProvider } from "@inputforge/sandboxctl-vmm";

const sandbox = new Sandbox({
  config: {
    packages: {
      nodejs: { enabled: true, version: "22" },
    },
    ubuntu: "24.04",
    username: "ubuntu",
    vm: { cpus: 2, disk: "20G", memory: "2G" },
  },
  name: "example-basic",
  provider: createVmmProvider(),
});

await sandbox.start();

try {
  const { stdout, exitCode } = await sandbox.exec("node --version && uname -a");
  console.log("exit:", exitCode);
  console.log(stdout.trim());
} finally {
  await sandbox.stop();
}

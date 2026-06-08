/**
 * Streaming example: run a long command and pipe output live.
 *
 * Run with: npx tsx examples/streaming.ts
 */

import { Sandbox } from "@inputforge/sandbox";
import { createVmmProvider } from "@inputforge/sandboxctl-vmm";

const sandbox = new Sandbox({
  config: {
    packages: { nodejs: { enabled: true, version: "22" } },
    ubuntu: "24.04",
    username: "ubuntu",
    vm: { cpus: 2, disk: "20G", memory: "2G" },
  },
  name: "example-streaming",
  provider: createVmmProvider(),
});

await sandbox.start();

try {
  // Pipe a long-running process directly to host stdout/stderr
  const proc = sandbox.execStreamed(
    "for i in $(seq 1 5); do echo step $i; sleep 1; done"
  );
  proc.stdout.pipe(process.stdout);
  proc.stderr.pipe(process.stderr);
  await new Promise<void>((resolve) => {
    proc.on("exit", resolve);
  });
  console.log("Done, exit code:", proc.exitCode);

  // Write to stdin — interactive commands
  const interactive = sandbox.execStreamed("cat");
  interactive.stdin.write("hello from the host\n");
  interactive.stdin.end();
  interactive.stdout.pipe(process.stdout);
  await new Promise<void>((resolve) => {
    interactive.on("exit", resolve);
  });
} finally {
  await sandbox.stop();
}

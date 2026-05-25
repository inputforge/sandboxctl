import { rmSync } from "node:fs";

import { sandboxDir, sandboxName, vmSockPath } from "../lib/paths.js";
import { isVmRunning } from "../lib/qemu.js";

export async function destroy(): Promise<void> {
  const name = sandboxName();
  const dir = sandboxDir();

  if (await isVmRunning(vmSockPath())) {
    console.error(
      `Sandbox "${name}" is running. Stop it first: create-sandbox stop`
    );
    process.exit(1);
  }

  rmSync(dir, { force: true, recursive: true });
  console.log(`Sandbox "${name}" destroyed.`);
}

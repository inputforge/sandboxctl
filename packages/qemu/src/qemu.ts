import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, openSync } from "node:fs";
import { createConnection } from "node:net";
import { setPriority } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import type { PlatformConfig } from "./platform.js";

export interface QemuStartOptions {
  cpus: number;
  logPath: string;
  memory: string;
  platform: PlatformConfig;
  port: number;
  seedImgPath: string | null;
  sockPath: string;
  vmImgPath: string;
}

export function spawnQemu(opts: QemuStartOptions): void {
  const {
    platform: pc,
    vmImgPath,
    seedImgPath,
    sockPath,
    logPath,
    port,
    cpus,
    memory,
  } = opts;

  const args: string[] = [
    "-machine",
    pc.machine,
    "-accel",
    pc.accel,
    "-cpu",
    "host",
    "-smp",
    String(cpus),
    "-m",
    memory,
  ];

  if (pc.firmware !== null) {
    args.push("-drive", `if=pflash,format=raw,readonly=on,file=${pc.firmware}`);
  }

  args.push("-drive", `if=virtio,format=qcow2,file=${vmImgPath}`);

  if (seedImgPath !== null) {
    args.push("-drive", `if=virtio,format=raw,file=${seedImgPath},readonly=on`);
  }

  const netdev = `user,id=net0,hostfwd=tcp::${port}-:22`;

  args.push(
    "-netdev",
    netdev,
    "-device",
    "virtio-net-pci,netdev=net0",
    "-device",
    "virtio-rng-pci",
    "-monitor",
    `unix:${sockPath},server,nowait`,
    "-nographic",
    ...pc.extraArgs
  );

  const logFd = openSync(logPath, "a");
  const child = spawn(pc.qemuBin, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  // QEMU's Hypervisor.framework vCPU threads spin even when the guest is idle
  // (WFI is not translated to a blocking host syscall). Lowering priority
  // prevents the spin from starving foreground processes.
  if (child.pid !== undefined) {
    setPriority(child.pid, 10);
  }
  child.unref();
}

export async function isVmRunning(sockPath: string): Promise<boolean> {
  if (!existsSync(sockPath)) {
    return false;
  }
  const socket = createConnection(sockPath);
  socket.setTimeout(1000);
  try {
    await Promise.race([
      once(socket, "connect"),
      once(socket, "timeout").then(() => {
        throw new Error("timeout");
      }),
    ]);
    socket.destroy();
    return true;
  } catch {
    socket.destroy();
    return false;
  }
}

export async function sendMonitorCommand(
  sockPath: string,
  command: string
): Promise<void> {
  const socket = createConnection(sockPath);
  socket.setTimeout(5000);
  await Promise.race([
    once(socket, "connect"),
    once(socket, "timeout").then(() => {
      throw new Error("Monitor socket connection timed out");
    }),
  ]);
  socket.write(`${command}\n`);
  await sleep(300);
  socket.destroy();
}

export async function waitForSockGone(
  sockPath: string,
  timeoutMs = 30_000
): Promise<void> {
  const start = Date.now();
  while (existsSync(sockPath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("VM did not shut down within 30 seconds");
    }
    await sleep(500);
  }
}

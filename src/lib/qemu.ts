import { spawn } from 'child_process';
import { openSync, existsSync } from 'fs';
import { createConnection } from 'net';
import type { PlatformConfig } from './platform.js';

export interface QemuStartOptions {
  platform: PlatformConfig;
  vmImgPath: string;
  seedImgPath: string | null;
  sockPath: string;
  logPath: string;
  port: number;
  cpus: number;
  memory: string;
}

export function spawnQemu(opts: QemuStartOptions): void {
  const { platform: pc, vmImgPath, seedImgPath, sockPath, logPath, port, cpus, memory } = opts;

  const args: string[] = [
    '-machine', pc.machine,
    '-accel', pc.accel,
    '-cpu', pc.cpuArg,
    '-smp', String(cpus),
    '-m', memory,
  ];

  if (pc.firmware) {
    args.push('-drive', `if=pflash,format=raw,readonly=on,file=${pc.firmware}`);
  }

  args.push('-drive', `if=virtio,format=qcow2,file=${vmImgPath}`);

  if (seedImgPath) {
    args.push('-drive', `if=virtio,format=raw,file=${seedImgPath},readonly=on`);
  }

  const netdev = `user,id=net0,hostfwd=tcp::${port}-:22`;

  args.push(
    '-netdev', netdev,
    '-device', 'virtio-net-pci,netdev=net0',
    '-device', 'virtio-rng-pci',
    '-monitor', `unix:${sockPath},server,nowait`,
    '-nographic',
  );

  const logFd = openSync(logPath, 'a');
  const child = spawn(pc.qemuBin, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
}

export function isVmRunning(sockPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(sockPath)) { resolve(false); return; }
    const socket = createConnection(sockPath);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

export function sendMonitorCommand(sockPath: string, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(sockPath);
    socket.on('connect', () => {
      socket.write(command + '\n');
      // Give QEMU a moment to process before closing
      setTimeout(() => { socket.destroy(); resolve(); }, 300);
    });
    socket.on('error', reject);
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error('Monitor socket connection timed out'));
    });
  });
}

export function waitForSockGone(sockPath: string, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = setInterval(() => {
      if (!existsSync(sockPath)) {
        clearInterval(poll);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(poll);
        reject(new Error('VM did not shut down within 30 seconds'));
      }
    }, 500);
  });
}

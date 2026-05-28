import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

function readPid(pidFile: string): number | null {
  if (!existsSync(pidFile)) {
    return null;
  }
  const pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  return Number.isFinite(pid) ? pid : null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function spawnVmm(
  vmmBin: string,
  configPath: string,
  pidFile: string,
  logPath: string
): void {
  rmSync(pidFile, { force: true });
  const logFd = openSync(logPath, "a");
  const child = spawn(vmmBin, ["run", "--pid-file", pidFile, configPath], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
}

export function isVmmRunning(pidFile: string): boolean {
  const pid = readPid(pidFile);
  return pid === null ? false : isPidAlive(pid);
}

export async function stopVmm(pidFile: string): Promise<void> {
  const pid = readPid(pidFile);
  if (pid === null) {
    return;
  }
  if (!isPidAlive(pid)) {
    rmSync(pidFile, { force: true });
    return;
  }
  process.kill(pid, "SIGTERM");

  const start = Date.now();
  while (isPidAlive(pid)) {
    if (Date.now() - start > 30_000) {
      throw new Error("VM did not shut down within 30 seconds");
    }
    await sleep(500);
  }
  rmSync(pidFile, { force: true });
}

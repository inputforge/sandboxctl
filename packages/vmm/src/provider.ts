import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { log, spinner } from "@clack/prompts";
import type { SandboxConfig, VmProvider } from "@inputforge/providers";

import {
  convertQcow2ToRaw,
  downloadUbuntuImage,
  resizeRaw,
  ubuntuImageName,
} from "./disk.js";
import {
  appDataDir,
  findSshPublicKey,
  imagesDir,
  sandboxDir,
  seedImgPath,
  vmLogPath,
  vmRawDiskPath,
  vmmConfigPath,
  vmmPidPath,
  vmmStateDirPath,
} from "./paths.js";
import { isVmmRunning, spawnVmm, stopVmm } from "./process.js";
import { buildInstallScript, buildSeedImage, buildUserData } from "./seed.js";
import { resolveVmmBinary } from "./vmm-binary.js";
import { buildVmmConfig } from "./vmm-config.js";

async function findFreePort(start = 2222, end = 2299): Promise<number> {
  for (let port = start; port <= end; port += 1) {
    const server = createServer();
    server.listen(port, "127.0.0.1");
    try {
      await once(server, "listening");
      server.close();
      return port;
    } catch {
      server.close();
    }
  }
  throw new Error(`No free port found in range ${start}-${end}`);
}

async function pollSsh(
  port: number,
  username: string,
  maxAttempts = 120
): Promise<void> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      execFileSync(
        "ssh",
        [
          "-o",
          "ConnectTimeout=3",
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "UserKnownHostsFile=/dev/null",
          "-o",
          "BatchMode=yes",
          "-p",
          String(port),
          `${username}@localhost`,
          "exit",
        ],
        { stdio: "ignore" }
      );
      return;
    } catch {
      await sleep(3000);
    }
  }
  throw new Error(
    "SSH did not become available within the timeout (6 minutes)"
  );
}

async function streamInstallLog(port: number, username: string): Promise<void> {
  const child = execFile("ssh", [
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes",
    "-p",
    String(port),
    `${username}@localhost`,
    "until [ -f /var/log/install-tools.log ]; do sleep 2; done; tail -f /var/log/install-tools.log",
  ]);

  child.stderr?.resume();

  for await (const chunk of child.stdout ?? []) {
    for (const line of (chunk as Buffer).toString().split("\n")) {
      if (!line.trim()) {
        continue;
      }
      console.log(`  ${line}`);
      if (line.includes("==> Done.")) {
        child.kill();
        return;
      }
    }
  }
}

function checkRebuildGuards(
  config: SandboxConfig,
  snapshot: SandboxConfig | null
): void {
  if (!snapshot) {
    return;
  }
  if (config.ubuntu !== snapshot.ubuntu) {
    console.error(
      `sandbox.json "ubuntu" changed (${snapshot.ubuntu} → ${config.ubuntu}).\n` +
        "This requires a full rebuild. Run: create-sandbox destroy && create-sandbox start"
    );
    process.exit(1);
  }
  if (JSON.stringify(config.packages) !== JSON.stringify(snapshot.packages)) {
    console.error(
      'sandbox.json "packages" changed.\n' +
        "This requires a full rebuild. Run: create-sandbox destroy && create-sandbox start"
    );
    process.exit(1);
  }
}

function writeConfig(config: SandboxConfig, name: string, port: number): void {
  const vmmConfig = buildVmmConfig(
    config,
    vmRawDiskPath(name),
    vmmStateDirPath(name),
    seedImgPath(name),
    port
  );
  writeFileSync(
    vmmConfigPath(name),
    `${JSON.stringify(vmmConfig, null, 2)}\n`,
    "utf-8"
  );
}

async function boot(
  vmmBin: string,
  config: SandboxConfig,
  name: string,
  port: number,
  isFirstBoot: boolean
): Promise<void> {
  {
    const s = spinner();
    s.start("Booting VM...");
    writeConfig(config, name, port);
    spawnVmm(vmmBin, vmmConfigPath(name), vmmPidPath(name), vmLogPath(name));
    s.stop("VM booting in background.");
  }

  {
    const s = spinner();
    s.start("Waiting for SSH...");
    await pollSsh(port, config.username);
    s.stop("SSH ready.");
  }

  if (isFirstBoot) {
    log.step("Streaming install log:");
    await streamInstallLog(port, config.username);
  }
}

async function firstBoot(
  vmmBin: string,
  config: SandboxConfig,
  name: string
): Promise<number> {
  mkdirSync(sandboxDir(name), { recursive: true });
  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(imagesDir, { recursive: true });

  const cachedImg = join(imagesDir, ubuntuImageName(config.ubuntu));
  if (existsSync(cachedImg)) {
    log.step("Base image already cached.");
  } else {
    await downloadUbuntuImage(config.ubuntu, cachedImg);
  }

  {
    const s = spinner();
    s.start("Creating VM disk image...");
    convertQcow2ToRaw(vmmBin, cachedImg, vmRawDiskPath(name));
    resizeRaw(vmmBin, vmRawDiskPath(name), config.vm.disk);
    s.stop("Disk image created.");
  }

  {
    const s = spinner();
    s.start("Building cloud-init seed...");
    const pubKey = findSshPublicKey();
    const installScript = buildInstallScript(config.packages, "arm64");
    buildSeedImage(
      "instance-id: sandbox-vm-1\nlocal-hostname: sandbox-vm\n",
      buildUserData(pubKey, installScript, config.username),
      seedImgPath(name)
    );
    s.stop("Seed image created.");
  }

  const port = await findFreePort();
  await boot(vmmBin, config, name, port, true);
  return port;
}

async function subsequentBoot(
  vmmBin: string,
  config: SandboxConfig,
  name: string,
  snapshot: SandboxConfig | null
): Promise<number> {
  checkRebuildGuards(config, snapshot);

  if (isVmmRunning(vmmPidPath(name))) {
    console.error(`Sandbox "${name}" is already running.`);
    process.exit(1);
  }

  const port = await findFreePort();
  await boot(vmmBin, config, name, port, false);
  return port;
}

export function createVmmProvider(): VmProvider {
  return {
    destroy: (name) => {
      if (isVmmRunning(vmmPidPath(name))) {
        console.error("Sandbox is running. Stop it first: create-sandbox stop");
        process.exit(1);
      }
      rmSync(sandboxDir(name), { force: true, recursive: true });
      return Promise.resolve();
    },

    isInitialized: (name) => existsSync(vmRawDiskPath(name)),

    isRunning: (name) => Promise.resolve(isVmmRunning(vmmPidPath(name))),

    start: async (config, name, snapshot) => {
      const vmmBin = resolveVmmBinary();
      const port = existsSync(vmRawDiskPath(name))
        ? await subsequentBoot(vmmBin, config, name, snapshot)
        : await firstBoot(vmmBin, config, name);
      return { host: "127.0.0.1", port };
    },

    stop: (name) => stopVmm(vmmPidPath(name)),
  };
}

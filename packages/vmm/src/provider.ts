import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch as hostArch } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import type {
  ProviderReporter,
  SandboxConfig,
  VmProvider,
  VmStartResult,
} from "@inputforge/providers";

import {
  convertQcow2ToRaw,
  downloadUbuntuImage,
  downloadUbuntuInitrd,
  downloadUbuntuKernel,
  resizeRaw,
  ubuntuImageName,
} from "./disk.js";
import {
  appDataDir,
  cachedInitrdPath,
  cachedVmlinuxPath,
  cachedVmlinuzPath,
  findSshKeyPair,
  imagesDir,
  sandboxDir,
  seedImgPath,
  vmLogPath,
  vmRawDiskPath,
  vmmConfigPath,
  vmmMacPath,
  vmmPidPath,
  vmmSocketPath,
  vmmStateDirPath,
} from "./paths.js";
import { isVmmRunning, spawnVmm, stopVmm } from "./process.js";
import { buildInstallScript, buildSeedImage, buildUserData } from "./seed.js";
import { resolveVmmBinary } from "./vmm-binary.js";
import { buildEfiVmmConfig, buildLinuxVmmConfig } from "./vmm-config.js";

const execFileAsync = promisify(execFile);

async function lookupArp(mac: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("arp", ["-an"], {
      encoding: "utf-8",
    });
    for (const line of stdout.split("\n")) {
      const match = line.match(/\(([^)]+)\) at ([0-9a-f:]+)/iu);
      if (match?.[2]?.toLowerCase() === mac) {
        return match[1] ?? null;
      }
    }
  } catch {
    // arp unavailable or failed
  }
  return null;
}

function ubuntuArch(): "arm64" | "amd64" {
  return hostArch() === "arm64" ? "arm64" : "amd64";
}

function generateMac(): string {
  // 0x02 = locally administered unicast (bit 1 set, bit 0 clear)
  const b = randomBytes(5);
  return ["02", ...[...b].map((x) => x.toString(16).padStart(2, "0"))].join(
    ":"
  );
}

async function pollVmIp(macPath: string, maxAttempts = 60): Promise<string> {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (existsSync(macPath)) {
      const mac = readFileSync(macPath, "utf-8").trim().toLowerCase();
      const ip = await lookupArp(mac);
      if (ip) {
        return ip;
      }
    }
    await sleep(1000);
  }
  throw new Error("VM did not obtain an IP address within 60 seconds");
}

async function pollSsh(
  host: string,
  identityFile: string,
  username: string,
  maxAttempts = 120
): Promise<void> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      await execFileAsync("ssh", [
        "-o",
        "ConnectTimeout=3",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "BatchMode=yes",
        "-i",
        identityFile,
        `${username}@${host}`,
        "exit",
      ]);
      return;
    } catch {
      await sleep(3000);
    }
  }
  throw new Error(
    "SSH did not become available within the timeout (6 minutes)"
  );
}

async function streamInstallLog(
  host: string,
  identityFile: string,
  username: string,
  logLine: (line: string) => void
): Promise<void> {
  const child = execFile("ssh", [
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes",
    "-i",
    identityFile,
    `${username}@${host}`,
    "until [ -f /var/log/install-tools.log ]; do sleep 2; done; tail -f /var/log/install-tools.log",
  ]);

  child.stderr?.resume();

  for await (const chunk of child.stdout ?? []) {
    for (const line of (chunk as Buffer).toString().split("\n")) {
      if (!line.trim()) {
        continue;
      }
      logLine(line);
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
    throw new Error(
      `sandbox.json "ubuntu" changed (${snapshot.ubuntu} -> ${config.ubuntu}).\n` +
        "This requires a full rebuild. Run: create-sandbox destroy && create-sandbox start"
    );
  }
  if (JSON.stringify(config.packages) !== JSON.stringify(snapshot.packages)) {
    throw new Error(
      'sandbox.json "packages" changed.\n' +
        "This requires a full rebuild. Run: create-sandbox destroy && create-sandbox start"
    );
  }
}

function writeConfig(
  config: SandboxConfig,
  name: string,
  linux: { kernelPath: string; initrdPath: string; mac: string } | null
): void {
  const vmmConfig = linux
    ? buildLinuxVmmConfig(
        config,
        vmRawDiskPath(name),
        linux.kernelPath,
        linux.initrdPath,
        seedImgPath(name),
        linux.mac
      )
    : buildEfiVmmConfig(
        config,
        vmRawDiskPath(name),
        vmmStateDirPath(name),
        seedImgPath(name)
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
  linux: { kernelPath: string; initrdPath: string; mac: string } | null,
  identityFile: string,
  isFirstBoot: boolean,
  reporter: ProviderReporter
): Promise<VmStartResult> {
  const macPath = linux
    ? vmmMacPath(name)
    : join(vmmStateDirPath(name), "macaddr");

  const bootSpinner = reporter.spin("Booting VM...");
  writeConfig(config, name, linux);
  spawnVmm(
    vmmBin,
    vmmConfigPath(name),
    vmmPidPath(name),
    vmLogPath(name),
    vmmSocketPath(name)
  );
  bootSpinner.stop("VM booting in background.");

  const ipSpinner = reporter.spin("Waiting for VM IP address...");
  const host = await pollVmIp(macPath, linux ? 60 : 120);
  ipSpinner.stop(`VM IP: ${host}`);

  const sshSpinner = reporter.spin("Waiting for SSH...");
  await pollSsh(host, identityFile, config.username);
  sshSpinner.stop("SSH ready.");

  if (isFirstBoot) {
    reporter.step("Streaming install log:");
    await streamInstallLog(host, identityFile, config.username, (line) =>
      reporter.log(line)
    );
  }

  return { host, identityFile, port: 22 };
}

async function firstBoot(
  vmmBin: string,
  config: SandboxConfig,
  name: string,
  reporter: ProviderReporter
): Promise<VmStartResult> {
  mkdirSync(sandboxDir(name), { recursive: true });
  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(imagesDir, { recursive: true });

  const { privateKeyPath, publicKey } = findSshKeyPair();
  const arch = ubuntuArch();

  // Disk image
  const cachedImg = join(imagesDir, ubuntuImageName(config.ubuntu, arch));
  if (existsSync(cachedImg)) {
    reporter.step("Base image already cached.");
  } else {
    const bar = reporter.progress(
      `Downloading Ubuntu ${config.ubuntu} (${arch})...`
    );
    await downloadUbuntuImage(config.ubuntu, arch, cachedImg, bar);
  }

  const diskSpinner = reporter.spin("Creating VM disk image...");
  await convertQcow2ToRaw(vmmBin, cachedImg, vmRawDiskPath(name));
  await resizeRaw(vmmBin, vmRawDiskPath(name), config.vm.disk);
  diskSpinner.stop("Disk image created.");

  const useLinux = (config.vmm?.boot ?? "linux") === "linux";

  let linuxArgs: {
    kernelPath: string;
    initrdPath: string;
    mac: string;
  } | null = null;
  if (useLinux) {
    const vmlinuzCached = cachedVmlinuzPath(config.ubuntu, imagesDir);
    const vmlinuxCached = cachedVmlinuxPath(config.ubuntu, imagesDir);
    const initrdCached = cachedInitrdPath(config.ubuntu, imagesDir);

    if (existsSync(vmlinuxCached)) {
      reporter.step("Kernel already cached.");
    } else {
      const bar = reporter.progress(
        `Downloading Ubuntu ${config.ubuntu} kernel...`
      );
      await downloadUbuntuKernel(
        config.ubuntu,
        arch,
        vmlinuzCached,
        vmlinuxCached,
        bar
      );
    }
    if (existsSync(initrdCached)) {
      reporter.step("Initrd already cached.");
    } else {
      const bar = reporter.progress(
        `Downloading Ubuntu ${config.ubuntu} initrd...`
      );
      await downloadUbuntuInitrd(config.ubuntu, arch, initrdCached, bar);
    }

    const mac = generateMac();
    writeFileSync(vmmMacPath(name), mac, "utf-8");
    linuxArgs = { initrdPath: initrdCached, kernelPath: vmlinuxCached, mac };
  }

  // Cloud-init seed
  const seedSpinner = reporter.spin("Building cloud-init seed...");
  const installScript = buildInstallScript(config.packages, arch);
  buildSeedImage(
    "instance-id: sandbox-vm-1\nlocal-hostname: sandbox-vm\n",
    buildUserData(publicKey, installScript, config.username),
    seedImgPath(name)
  );
  seedSpinner.stop("Seed image created.");

  return boot(vmmBin, config, name, linuxArgs, privateKeyPath, true, reporter);
}

function subsequentBoot(
  vmmBin: string,
  config: SandboxConfig,
  name: string,
  snapshot: SandboxConfig | null,
  reporter: ProviderReporter
): Promise<VmStartResult> {
  checkRebuildGuards(config, snapshot);

  if (isVmmRunning(vmmPidPath(name))) {
    throw new Error(`Sandbox "${name}" is already running.`);
  }

  const { privateKeyPath } = findSshKeyPair();
  const useLinux = (config.vmm?.boot ?? "linux") === "linux";
  let linuxArgs: {
    kernelPath: string;
    initrdPath: string;
    mac: string;
  } | null = null;
  if (useLinux) {
    const mac = readFileSync(vmmMacPath(name), "utf-8").trim();
    linuxArgs = {
      initrdPath: cachedInitrdPath(config.ubuntu, imagesDir),
      kernelPath: cachedVmlinuxPath(config.ubuntu, imagesDir),
      mac,
    };
  }
  return boot(vmmBin, config, name, linuxArgs, privateKeyPath, false, reporter);
}

export function createVmmProvider(): VmProvider {
  return {
    destroy: (name, _reporter) => {
      if (isVmmRunning(vmmPidPath(name))) {
        throw new Error(
          "Sandbox is running. Stop it first: create-sandbox stop"
        );
      }
      rmSync(sandboxDir(name), { force: true, recursive: true });
      return Promise.resolve();
    },

    isInitialized: (name) => existsSync(vmRawDiskPath(name)),

    isRunning: (name) => Promise.resolve(isVmmRunning(vmmPidPath(name))),

    start: (config, name, snapshot, reporter) => {
      const vmmBin = resolveVmmBinary();
      return existsSync(vmRawDiskPath(name))
        ? subsequentBoot(vmmBin, config, name, snapshot, reporter)
        : firstBoot(vmmBin, config, name, reporter);
    },

    stop: (name, _reporter) => stopVmm(vmmPidPath(name)),
  };
}

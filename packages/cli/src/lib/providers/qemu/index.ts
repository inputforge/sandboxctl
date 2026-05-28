import { execFile, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { log, progress, spinner } from "@clack/prompts";

import { buildInstallScript } from "../../installers.js";
import {
  appDataDir,
  imagesDir,
  sandboxDir,
  seedImgPath,
  vmImgPath,
  vmLogPath,
  vmSockPath,
} from "../../paths.js";
import type { PlatformConfig } from "../../platform.js";
import { getUbuntuImageName, getUbuntuImageUrl } from "../../platform.js";
import { findFreePort } from "../../port.js";
import { buildSeedImage } from "../../seed.js";
import { findSshPublicKey } from "../../ssh-key.js";
import type { VmProvider } from "../index.js";
import {
  isVmRunning,
  sendMonitorCommand,
  spawnQemu,
  waitForSockGone,
} from "./qemu.js";

function buildUserData(
  pubKey: string,
  installScript: string,
  username: string
): string {
  const scriptLines = installScript
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");
  return `#cloud-config
users:
  - name: ${username}
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    groups: [adm, dialout, cdrom, sudo, audio, dip, video, plugdev, netdev, lxd]
    ssh_authorized_keys:
      - ${pubKey}

write_files:
  - path: /usr/local/bin/install-tools.sh
    permissions: '0755'
    content: |
${scriptLines}

runcmd:
  - /usr/local/bin/install-tools.sh
`;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function formatProgress(downloaded: number, total: number): string {
  return total > 0 ? `${mb(downloaded)} / ${mb(total)}` : mb(downloaded);
}

async function downloadFile(
  url: string,
  destPath: string,
  label: string
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }

  const total = Number(res.headers.get("content-length") ?? 0);
  const bar = progress(total > 0 ? { max: total } : undefined);
  bar.start(label);

  let downloaded = 0;

  async function* trackProgress(source: AsyncIterable<Buffer>) {
    for await (const chunk of source) {
      downloaded += chunk.length;
      bar.advance(chunk.length, formatProgress(downloaded, total));
      yield chunk;
    }
  }

  try {
    const file = createWriteStream(destPath);
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      trackProgress,
      file
    );
    bar.stop("Base image downloaded.");
  } catch (error) {
    bar.stop("Download failed.");
    rmSync(destPath, { force: true });
    throw error;
  }
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

async function boot(
  pc: PlatformConfig,
  config: Parameters<VmProvider["start"]>[0],
  port: number,
  isFirstBoot: boolean
): Promise<void> {
  {
    const s = spinner();
    s.start("Booting VM...");
    spawnQemu({
      cpus: config.vm.cpus,
      logPath: vmLogPath(),
      memory: config.vm.memory,
      platform: pc,
      port,
      seedImgPath: isFirstBoot ? seedImgPath() : null,
      sockPath: vmSockPath(),
      vmImgPath: vmImgPath(),
    });
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
  pc: PlatformConfig,
  config: Parameters<VmProvider["start"]>[0]
): Promise<number> {
  mkdirSync(sandboxDir(), { recursive: true });
  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(imagesDir, { recursive: true });

  const imgName = getUbuntuImageName(config.ubuntu, pc.ubuntuArch);
  const cachedImg = join(imagesDir, imgName);
  if (existsSync(cachedImg)) {
    log.step("Base image already cached.");
  } else {
    await downloadFile(
      getUbuntuImageUrl(config.ubuntu, pc.ubuntuArch),
      cachedImg,
      `Downloading Ubuntu ${config.ubuntu} (${pc.ubuntuArch})...`
    );
  }

  {
    const s = spinner();
    s.start("Creating VM disk image...");
    execFileSync(
      "qemu-img",
      ["create", "-f", "qcow2", "-b", cachedImg, "-F", "qcow2", vmImgPath()],
      { stdio: "ignore" }
    );
    execFileSync("qemu-img", ["resize", vmImgPath(), config.vm.disk], {
      stdio: "ignore",
    });
    s.stop("Disk image created.");
  }

  {
    const s = spinner();
    s.start("Building cloud-init seed...");
    const pubKey = findSshPublicKey();
    const installScript = buildInstallScript(config.packages, pc.ubuntuArch);
    buildSeedImage(
      "instance-id: sandbox-vm-1\nlocal-hostname: sandbox-vm\n",
      buildUserData(pubKey, installScript, config.username),
      seedImgPath()
    );
    s.stop("Seed image created.");
  }

  const port = await findFreePort();
  await boot(pc, config, port, true);
  return port;
}

async function subsequentBoot(
  pc: PlatformConfig,
  config: Parameters<VmProvider["start"]>[0],
  name: string,
  snapshot: Parameters<VmProvider["start"]>[2]
): Promise<number> {
  if (snapshot) {
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

  const running = await isVmRunning(vmSockPath());

  if (running) {
    const diskChanged = snapshot && config.vm.disk !== snapshot.vm.disk;
    const vmChanged =
      snapshot &&
      (config.vm.cpus !== snapshot.vm.cpus ||
        config.vm.memory !== snapshot.vm.memory);
    if (!(snapshot && (diskChanged || vmChanged))) {
      console.error(`Sandbox "${name}" is already running.`);
      process.exit(1);
    }
    log.step("Config changed — stopping VM to apply changes...");
    await sendMonitorCommand(vmSockPath(), "system_powerdown");
    await waitForSockGone(vmSockPath());
  }

  if (snapshot && config.vm.disk !== snapshot.vm.disk) {
    const s = spinner();
    s.start(`Resizing disk from ${snapshot.vm.disk} to ${config.vm.disk}...`);
    try {
      execFileSync("qemu-img", ["resize", vmImgPath(), config.vm.disk], {
        stdio: "ignore",
      });
      s.stop(`Disk resized to ${config.vm.disk}.`);
    } catch {
      s.stop("Disk resize failed.");
      console.error(
        `Failed to resize disk from ${snapshot.vm.disk} to ${config.vm.disk}.\n` +
          "QEMU images cannot be shrunk. If you need a larger disk, set a bigger value."
      );
      process.exit(1);
    }
  }

  const port = await findFreePort();
  await boot(pc, config, port, false);
  return port;
}

export function createQemuProvider(pc: PlatformConfig): VmProvider {
  return {
    destroy: async (_name) => {
      if (await isVmRunning(vmSockPath())) {
        console.error("Sandbox is running. Stop it first: create-sandbox stop");
        process.exit(1);
      }
      rmSync(sandboxDir(), { force: true, recursive: true });
    },

    isInitialized: (_name) => existsSync(vmImgPath()),

    isRunning: (_name) => isVmRunning(vmSockPath()),

    start: async (config, name, snapshot) => {
      const port = existsSync(vmImgPath())
        ? await subsequentBoot(pc, config, name, snapshot)
        : await firstBoot(pc, config);
      return { host: "127.0.0.1", port };
    },

    stop: async (_name) => {
      await sendMonitorCommand(vmSockPath(), "system_powerdown");
      await waitForSockGone(vmSockPath());
    },
  };
}

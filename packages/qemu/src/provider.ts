import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

import type { ProviderReporter, VmProvider } from "@inputforge/providers";

import { buildInstallScript } from "./installers.js";
import {
  appDataDir,
  imagesDir,
  sandboxDir,
  seedImgPath,
  vmImgPath,
  vmLogPath,
  vmSockPath,
} from "./paths.js";
import type { PlatformConfig } from "./platform.js";
import { getUbuntuImageName, getUbuntuImageUrl } from "./platform.js";
import {
  isVmRunning,
  sendMonitorCommand,
  spawnQemu,
  waitForSockGone,
} from "./qemu.js";
import { buildSeedImage } from "./seed.js";
import { findSshPublicKey } from "./ssh-key.js";

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
  label: string,
  reporter: ProviderReporter
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }

  const total = Number(res.headers.get("content-length") ?? 0);
  const bar = reporter.progress(label, total > 0 ? total : undefined);

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

async function streamInstallLog(
  port: number,
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
      logLine(line);
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
  name: string,
  port: number,
  isFirstBoot: boolean,
  reporter: ProviderReporter
): Promise<void> {
  {
    const s = reporter.spin("Booting VM...");
    spawnQemu({
      cpus: config.vm.cpus,
      logPath: vmLogPath(name),
      memory: config.vm.memory,
      platform: pc,
      port,
      seedImgPath: isFirstBoot ? seedImgPath(name) : null,
      sockPath: vmSockPath(name),
      vmImgPath: vmImgPath(name),
    });
    s.stop("VM booting in background.");
  }

  {
    const s = reporter.spin("Waiting for SSH...");
    await pollSsh(port, config.username);
    s.stop("SSH ready.");
  }

  if (isFirstBoot) {
    reporter.step("Streaming install log:");
    await streamInstallLog(port, config.username, (line) => reporter.log(line));
  }
}

async function firstBoot(
  pc: PlatformConfig,
  config: Parameters<VmProvider["start"]>[0],
  name: string,
  reporter: ProviderReporter
): Promise<number> {
  mkdirSync(sandboxDir(name), { recursive: true });
  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(imagesDir, { recursive: true });

  const imgName = getUbuntuImageName(config.ubuntu, pc.ubuntuArch);
  const cachedImg = join(imagesDir, imgName);
  if (existsSync(cachedImg)) {
    reporter.step("Base image already cached.");
  } else {
    await downloadFile(
      getUbuntuImageUrl(config.ubuntu, pc.ubuntuArch),
      cachedImg,
      `Downloading Ubuntu ${config.ubuntu} (${pc.ubuntuArch})...`,
      reporter
    );
  }

  {
    const s = reporter.spin("Creating VM disk image...");
    execFileSync(
      "qemu-img",
      [
        "create",
        "-f",
        "qcow2",
        "-b",
        cachedImg,
        "-F",
        "qcow2",
        vmImgPath(name),
      ],
      { stdio: "ignore" }
    );
    execFileSync("qemu-img", ["resize", vmImgPath(name), config.vm.disk], {
      stdio: "ignore",
    });
    s.stop("Disk image created.");
  }

  {
    const s = reporter.spin("Building cloud-init seed...");
    const pubKey = findSshPublicKey();
    const installScript = buildInstallScript(config.packages, pc.ubuntuArch);
    buildSeedImage(
      "instance-id: sandbox-vm-1\nlocal-hostname: sandbox-vm\n",
      buildUserData(pubKey, installScript, config.username),
      seedImgPath(name)
    );
    s.stop("Seed image created.");
  }

  const port = await findFreePort();
  await boot(pc, config, name, port, true, reporter);
  return port;
}

async function subsequentBoot(
  pc: PlatformConfig,
  config: Parameters<VmProvider["start"]>[0],
  name: string,
  snapshot: Parameters<VmProvider["start"]>[2],
  reporter: ProviderReporter
): Promise<number> {
  if (snapshot) {
    if (config.ubuntu !== snapshot.ubuntu) {
      throw new Error(
        `sandbox.json "ubuntu" changed (${snapshot.ubuntu} → ${config.ubuntu}).\n` +
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

  const running = await isVmRunning(vmSockPath(name));

  if (running) {
    const diskChanged = snapshot && config.vm.disk !== snapshot.vm.disk;
    const vmChanged =
      snapshot &&
      (config.vm.cpus !== snapshot.vm.cpus ||
        config.vm.memory !== snapshot.vm.memory);
    if (!(snapshot && (diskChanged || vmChanged))) {
      throw new Error(`Sandbox "${name}" is already running.`);
    }
    reporter.step("Config changed — stopping VM to apply changes...");
    await sendMonitorCommand(vmSockPath(name), "system_powerdown");
    await waitForSockGone(vmSockPath(name));
  }

  if (snapshot && config.vm.disk !== snapshot.vm.disk) {
    const s = reporter.spin(
      `Resizing disk from ${snapshot.vm.disk} to ${config.vm.disk}...`
    );
    try {
      execFileSync("qemu-img", ["resize", vmImgPath(name), config.vm.disk], {
        stdio: "ignore",
      });
      s.stop(`Disk resized to ${config.vm.disk}.`);
    } catch {
      s.stop("Disk resize failed.");
      throw new Error(
        `Failed to resize disk from ${snapshot.vm.disk} to ${config.vm.disk}.\n` +
          "QEMU images cannot be shrunk. If you need a larger disk, set a bigger value."
      );
    }
  }

  const port = await findFreePort();
  await boot(pc, config, name, port, false, reporter);
  return port;
}

export function createQemuProvider(pc: PlatformConfig): VmProvider {
  return {
    destroy: async (name, _reporter) => {
      if (await isVmRunning(vmSockPath(name))) {
        throw new Error(
          "Sandbox is running. Stop it first: create-sandbox stop"
        );
      }
      rmSync(sandboxDir(name), { force: true, recursive: true });
    },

    isInitialized: (name) => existsSync(vmImgPath(name)),

    isRunning: (name) => isVmRunning(vmSockPath(name)),

    start: async (config, name, snapshot, reporter) => {
      const port = existsSync(vmImgPath(name))
        ? await subsequentBoot(pc, config, name, snapshot, reporter)
        : await firstBoot(pc, config, name, reporter);
      return { host: "127.0.0.1", port };
    },

    stop: async (name, _reporter) => {
      await sendMonitorCommand(vmSockPath(name), "system_powerdown");
      await waitForSockGone(vmSockPath(name));
    },
  };
}

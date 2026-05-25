import { execFile, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { intro, log, outro, spinner } from "@clack/prompts";

import { buildInstallScript } from "../lib/installers.js";
import {
  appDataDir,
  imagesDir,
  sandboxDir,
  sandboxName,
  seedImgPath,
  vmImgPath,
  vmLogPath,
  vmSockPath,
} from "../lib/paths.js";
import {
  getPlatformConfig,
  getUbuntuImageName,
  getUbuntuImageUrl,
} from "../lib/platform.js";
import { findFreePort } from "../lib/port.js";
import {
  isVmRunning,
  sendMonitorCommand,
  spawnQemu,
  waitForSockGone,
} from "../lib/qemu.js";
import {
  readConfigSnapshot,
  readSandboxConfig,
  writeConfigSnapshot,
  writeState,
} from "../lib/sandbox.js";
import { buildSeedImage } from "../lib/seed.js";
import { findSshPublicKey } from "../lib/ssh-key.js";
import { send } from "./send.js";

function buildUserData(pubKey: string, installScript: string): string {
  const scriptLines = installScript
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");
  return `#cloud-config
password: ubuntu
chpasswd:
  expire: false
ssh_pwauth: true
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

const downloadFile = async (url: string, destPath: string): Promise<void> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const file = createWriteStream(destPath);
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    file
  );
};

async function pollSsh(port: number, maxAttempts = 120): Promise<void> {
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
          "ubuntu@localhost",
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

const streamInstallLog = async (port: number): Promise<void> => {
  const child = execFile("ssh", [
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes",
    "-p",
    String(port),
    "ubuntu@localhost",
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
};

async function bootAndWait(
  config: ReturnType<typeof readSandboxConfig>,
  pc: ReturnType<typeof getPlatformConfig>,
  name: string,
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
    writeState({ port, startedAt: new Date().toISOString() });
    s.stop("VM booting in background.");
  }

  {
    const s = spinner();
    s.start("Waiting for SSH...");
    await pollSsh(port);
    s.stop("SSH ready.");
  }

  if (isFirstBoot) {
    log.step("Streaming install log:");
    await streamInstallLog(port);
  }

  {
    const s = spinner();
    s.start("Syncing project files...");
    try {
      await send();
      s.stop("Files synced.");
    } catch {
      s.stop("File sync skipped (rsync not available or no files to sync).");
    }
  }

  const exposedPorts = (config.ports ?? [])
    .map((f) => `${f.guest}/${f.protocol ?? "tcp"}`)
    .join(", ");
  const outroMsg = `Sandbox "${name}" is ready!\n  SSH: ssh -p ${port} ubuntu@localhost${exposedPorts ? `\n  Exposed: ${exposedPorts}` : ""}`;
  outro(outroMsg);
}

async function runFirstBoot(
  config: ReturnType<typeof readSandboxConfig>,
  pc: ReturnType<typeof getPlatformConfig>,
  name: string
): Promise<void> {
  const dir = sandboxDir();
  mkdirSync(dir, { recursive: true });
  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(imagesDir, { recursive: true });

  const imgName = getUbuntuImageName(config.ubuntu, pc.ubuntuArch);
  const cachedImg = join(imagesDir, imgName);
  if (existsSync(cachedImg)) {
    log.step("Base image already cached.");
  } else {
    const url = getUbuntuImageUrl(config.ubuntu, pc.ubuntuArch);
    const s = spinner();
    s.start(`Downloading Ubuntu ${config.ubuntu} (${pc.ubuntuArch})...`);
    await downloadFile(url, cachedImg);
    s.stop("Base image downloaded.");
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
    const metaData = "instance-id: sandbox-vm-1\nlocal-hostname: sandbox-vm\n";
    const userData = buildUserData(pubKey, installScript);
    buildSeedImage(metaData, userData, seedImgPath());
    s.stop("Seed image created.");
  }

  const port = await findFreePort();
  await bootAndWait(config, pc, name, port, true);
  writeConfigSnapshot(config);
}

async function runSubsequentBoot(
  config: ReturnType<typeof readSandboxConfig>,
  pc: ReturnType<typeof getPlatformConfig>,
  name: string
): Promise<void> {
  const snapshot = readConfigSnapshot();

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

  if (!snapshot) {
    writeConfigSnapshot(config);
  }

  const port = await findFreePort();
  await bootAndWait(config, pc, name, port, false);
  writeConfigSnapshot(config);
}

export async function start(): Promise<void> {
  const name = sandboxName();
  const config = readSandboxConfig();
  const pc = getPlatformConfig();

  intro(`create-sandbox — starting "${name}"`);

  const isFirstBoot = !existsSync(vmImgPath());
  await (isFirstBoot
    ? runFirstBoot(config, pc, name)
    : runSubsequentBoot(config, pc, name));
}

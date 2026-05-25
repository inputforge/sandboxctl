import * as p from '@clack/prompts';
import { existsSync, mkdirSync } from 'fs';
import { execFileSync, execFile } from 'child_process';
import { createWriteStream } from 'fs';
import { get as httpsGet } from 'https';
import { IncomingMessage } from 'http';
import { join } from 'path';
import {
  sandboxName, sandboxDir, vmImgPath, seedImgPath,
  vmSockPath, vmLogPath, stateJsonPath, imagesDir, appDataDir,
} from '../lib/paths.js';
import { readSandboxConfig, writeState, readConfigSnapshot, writeConfigSnapshot, SandboxConfig } from '../lib/sandbox.js';
import { getPlatformConfig, getUbuntuImageName, getUbuntuImageUrl } from '../lib/platform.js';
import { findSshPublicKey } from '../lib/ssh-key.js';
import { buildInstallScript } from '../lib/installers.js';
import { buildSeedImage } from '../lib/seed.js';
import { findFreePort } from '../lib/port.js';
import { spawnQemu, isVmRunning, sendMonitorCommand, waitForSockGone } from '../lib/qemu.js';
import { send } from './send.js';

export async function start(): Promise<void> {
  const name = sandboxName();
  const config = readSandboxConfig();
  const pc = getPlatformConfig();

  p.intro(`create-sandbox — starting "${name}"`);

  const isFirstBoot = !existsSync(vmImgPath());
  if (isFirstBoot) {
    await firstBoot(config, pc, name);
  } else {
    await subsequentBoot(config, pc, name);
  }
}

async function firstBoot(
  config: ReturnType<typeof readSandboxConfig>,
  pc: ReturnType<typeof getPlatformConfig>,
  name: string
): Promise<void> {
  const dir = sandboxDir();
  mkdirSync(dir, { recursive: true });
  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(imagesDir, { recursive: true });

  // 1. Download base image
  const imgName = getUbuntuImageName(config.ubuntu, pc.ubuntuArch);
  const cachedImg = join(imagesDir, imgName);
  if (!existsSync(cachedImg)) {
    const url = getUbuntuImageUrl(config.ubuntu, pc.ubuntuArch);
    const s = p.spinner();
    s.start(`Downloading Ubuntu ${config.ubuntu} (${pc.ubuntuArch})...`);
    await downloadFile(url, cachedImg);
    s.stop('Base image downloaded.');
  } else {
    p.log.step('Base image already cached.');
  }

  // 2. Create QCOW2 overlay
  {
    const s = p.spinner();
    s.start('Creating VM disk image...');
    execFileSync('qemu-img', [
      'create', '-f', 'qcow2',
      '-b', cachedImg,
      '-F', 'qcow2',
      vmImgPath(),
    ], { stdio: 'ignore' });
    execFileSync('qemu-img', ['resize', vmImgPath(), config.vm.disk], { stdio: 'ignore' });
    s.stop('Disk image created.');
  }

  // 3. Build cloud-init seed
  {
    const s = p.spinner();
    s.start('Building cloud-init seed...');
    const pubKey = findSshPublicKey();
    const installScript = buildInstallScript(config.packages, pc.ubuntuArch);

    const metaData = 'instance-id: sandbox-vm-1\nlocal-hostname: sandbox-vm\n';
    const userData = buildUserData(pubKey, installScript);

    buildSeedImage(metaData, userData, seedImgPath());
    s.stop('Seed image created.');
  }

  // 4. Boot VM
  const port = await findFreePort();
  await bootAndWait(config, pc, name, port, true);
  writeConfigSnapshot(config);
}

async function subsequentBoot(
  config: ReturnType<typeof readSandboxConfig>,
  pc: ReturnType<typeof getPlatformConfig>,
  name: string
): Promise<void> {
  const snapshot = readConfigSnapshot();

  // Changes that require a full rebuild cannot be applied regardless of running state
  if (snapshot) {
    if (config.ubuntu !== snapshot.ubuntu) {
      console.error(
        `sandbox.json "ubuntu" changed (${snapshot.ubuntu} → ${config.ubuntu}).\n` +
        'This requires a full rebuild. Run: create-sandbox destroy && create-sandbox start'
      );
      process.exit(1);
    }
    if (JSON.stringify(config.packages) !== JSON.stringify(snapshot.packages)) {
      console.error(
        'sandbox.json "packages" changed.\n' +
        'This requires a full rebuild. Run: create-sandbox destroy && create-sandbox start'
      );
      process.exit(1);
    }
  }

  const running = await isVmRunning(vmSockPath());

  if (running) {
    const diskChanged = snapshot && config.vm.disk !== snapshot.vm.disk;
    const vmChanged = snapshot && (
      config.vm.cpus !== snapshot.vm.cpus ||
      config.vm.memory !== snapshot.vm.memory
    );
    if (!snapshot || (!diskChanged && !vmChanged)) {
      console.error(`Sandbox "${name}" is already running.`);
      process.exit(1);
    }

    p.log.step('Config changed — stopping VM to apply changes...');
    await sendMonitorCommand(vmSockPath(), 'system_powerdown');
    await waitForSockGone(vmSockPath());
  }

  // Apply disk resize if needed (VM must be stopped)
  if (snapshot && config.vm.disk !== snapshot.vm.disk) {
    const s = p.spinner();
    s.start(`Resizing disk from ${snapshot.vm.disk} to ${config.vm.disk}...`);
    try {
      execFileSync('qemu-img', ['resize', vmImgPath(), config.vm.disk], { stdio: 'ignore' });
      s.stop(`Disk resized to ${config.vm.disk}.`);
    } catch {
      s.stop('Disk resize failed.');
      console.error(
        `Failed to resize disk from ${snapshot.vm.disk} to ${config.vm.disk}.\n` +
        'QEMU images cannot be shrunk. If you need a larger disk, set a bigger value.'
      );
      process.exit(1);
    }
  }

  if (!snapshot) writeConfigSnapshot(config);

  const port = await findFreePort();
  await bootAndWait(config, pc, name, port, false);
  writeConfigSnapshot(config);
}

async function bootAndWait(
  config: ReturnType<typeof readSandboxConfig>,
  pc: ReturnType<typeof getPlatformConfig>,
  name: string,
  port: number,
  firstBoot: boolean
): Promise<void> {
  // Boot QEMU
  {
    const s = p.spinner();
    s.start('Booting VM...');
    spawnQemu({
      platform: pc,
      vmImgPath: vmImgPath(),
      seedImgPath: firstBoot ? seedImgPath() : null,
      sockPath: vmSockPath(),
      logPath: vmLogPath(),
      port,
      cpus: config.vm.cpus,
      memory: config.vm.memory,
    });
    writeState({ port, startedAt: new Date().toISOString() });
    s.stop('VM booting in background.');
  }

  // Poll SSH
  {
    const s = p.spinner();
    s.start('Waiting for SSH...');
    await pollSsh(port);
    s.stop('SSH ready.');
  }

  if (firstBoot) {
    // Stream install log
    p.log.step('Streaming install log:');
    await streamInstallLog(port);
  }

  // Auto-sync project files
  {
    const s = p.spinner();
    s.start('Syncing project files...');
    try {
      await send();
      s.stop('Files synced.');
    } catch {
      s.stop('File sync skipped (rsync not available or no files to sync).');
    }
  }

  const exposedPorts = (config.ports ?? []).map(f => `${f.guest}/${f.protocol ?? 'tcp'}`).join(', ');
  const outroMsg = `Sandbox "${name}" is ready!\n  SSH: ssh -p ${port} ubuntu@localhost${exposedPorts ? `\n  Exposed: ${exposedPorts}` : ''}`;
  p.outro(outroMsg);
}

function buildUserData(pubKey: string, installScript: string): string {
  const scriptLines = installScript.split('\n').map(l => '      ' + l).join('\n');
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

async function pollSsh(port: number, maxAttempts = 120): Promise<void> {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      execFileSync('ssh', [
        '-o', 'ConnectTimeout=3',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'BatchMode=yes',
        '-p', String(port),
        'ubuntu@localhost',
        'exit',
      ], { stdio: 'ignore' });
      return;
    } catch {
      await sleep(3000);
    }
  }
  throw new Error('SSH did not become available within the timeout (6 minutes)');
}

function streamInstallLog(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Wait for the log file to appear, then tail it
    const sshArgs = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'BatchMode=yes',
      '-p', String(port),
      'ubuntu@localhost',
      "until [ -f /var/log/install-tools.log ]; do sleep 2; done; tail -f /var/log/install-tools.log",
    ];

    const child = execFile('ssh', sshArgs);
    let done = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        console.log('  ' + line);
        if (!done && line.includes('==> Done.')) {
          done = true;
          setTimeout(() => {
            child.kill();
            resolve();
          }, 200);
        }
      }
    });

    child.stderr?.on('data', () => { /* suppress SSH noise */ });

    child.on('error', (err) => {
      if (!done) reject(err);
    });

    child.on('close', (code) => {
      if (!done) {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`Install log stream exited with code ${code}`));
      }
    });
  });
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);

    function request(redirectUrl: string): void {
      httpsGet(redirectUrl, (res: IncomingMessage) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          request(res.headers.location!);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${redirectUrl}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
    }

    request(url);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

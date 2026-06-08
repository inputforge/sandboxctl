import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, promises as fsp } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ProgressHandle } from "@inputforge/sandboxctl-providers";

const GZIP_HEADER_WINDOW_BYTES = 2048;
const GZIP_DEFLATE_METHOD = 0x08;
const GZIP_RESERVED_FLAG_START = 0x20;

function isValidGzipOffset(data: Buffer, offset: number): boolean {
  if (offset < 0 || offset > GZIP_HEADER_WINDOW_BYTES) {
    return false;
  }
  if (offset + 10 > data.length) {
    return false;
  }
  return (
    data[offset] === 0x1f &&
    data[offset + 1] === 0x8b &&
    data[offset + 2] === GZIP_DEFLATE_METHOD &&
    data[offset + 3] < GZIP_RESERVED_FLAG_START
  );
}

const UBUNTU_CODENAMES: Record<string, string> = {
  "24.04": "noble",
  "26.04": "resolute",
};

const bytesToMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function formatProgress(downloaded: number, total: number): string {
  return total > 0
    ? `${bytesToMb(downloaded)} / ${bytesToMb(total)}`
    : bytesToMb(downloaded);
}

function codename(version: string): string {
  const c = UBUNTU_CODENAMES[version];
  if (!c) {
    throw new Error(`Unsupported Ubuntu version: ${version}`);
  }
  return c;
}

function getUbuntuImageName(version: string, arch: "arm64" | "amd64"): string {
  return `${codename(version)}-server-cloudimg-${arch}.img`;
}

function getUbuntuImageUrl(version: string, arch: "arm64" | "amd64"): string {
  const c = codename(version);
  return `https://cloud-images.ubuntu.com/${c}/current/${getUbuntuImageName(version, arch)}`;
}

export function ubuntuImageName(
  version: string,
  arch: "arm64" | "amd64"
): string {
  return getUbuntuImageName(version, arch);
}

export function ubuntuKernelName(
  version: string,
  arch: "arm64" | "amd64"
): string {
  return `${codename(version)}-server-cloudimg-${arch}-vmlinuz-generic`;
}

export function ubuntuInitrdName(
  version: string,
  arch: "arm64" | "amd64"
): string {
  return `${codename(version)}-server-cloudimg-${arch}-initrd-generic`;
}

export function ubuntuVmlinuxName(
  version: string,
  arch: "arm64" | "amd64"
): string {
  return `${codename(version)}-server-cloudimg-${arch}-vmlinux`;
}

async function downloadFile(
  url: string,
  destPath: string,
  bar: ProgressHandle
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading ${url}`);
  }
  if (response.body === null) {
    throw new Error(`Response body is null for ${url}`);
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  let downloaded = 0;

  async function* trackProgress(source: AsyncIterable<Uint8Array>) {
    for await (const chunk of source) {
      downloaded += chunk.length;
      bar.advance(chunk.length, formatProgress(downloaded, total));
      yield chunk;
    }
  }

  try {
    const file = createWriteStream(destPath);
    await pipeline(Readable.fromWeb(response.body), trackProgress, file);
    bar.stop("Downloaded.");
  } catch (error) {
    bar.stop("Download failed.");
    await rm(destPath, { force: true });
    throw error;
  }
}

export async function spawnToFile(
  cmd: string,
  args: string[],
  destPath: string,
  allowedExitCodes: number[] = []
): Promise<void> {
  const out = createWriteStream(destPath);
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });

  await new Promise<void>((resolve, reject) => {
    child.on("error", (err) => {
      reject(new Error(`${cmd} process error`, { cause: err }));
    });
    child.on("close", (code) => {
      if (code !== 0 && !allowedExitCodes.includes(code ?? -1)) {
        reject(new Error(`${cmd} exited with code ${code}`));
      } else {
        resolve();
      }
    });
  }).finally(() => {
    out.close();
  });
}

async function extractKernel(
  vmlinuzPath: string,
  vmlinuxPath: string
): Promise<void> {
  const data = await fsp.readFile(vmlinuzPath);

  // zstd magic — payload inside a PE wrapper (e.g. Ubuntu 26.04+) or standalone
  const zstdMagic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const zstdOffset = data.indexOf(zstdMagic);
  if (zstdOffset !== -1) {
    const zstPath = `${vmlinuxPath}.zst`;
    await fsp.writeFile(zstPath, data.subarray(zstdOffset));
    try {
      // -dc: decompress to stdout; exits non-zero on trailing bytes — that's fine
      await spawnToFile("zstd", ["-dc", zstPath], vmlinuxPath, [1]);
    } finally {
      await rm(zstPath, { force: true });
    }
    return;
  }

  // gzip magic — whole file or payload at offset (e.g. Ubuntu 24.04)
  const gzipMagic = Buffer.from([0x1f, 0x8b]);
  const gzipOffset = data.indexOf(gzipMagic);
  if (isValidGzipOffset(data, gzipOffset)) {
    const gzPath = `${vmlinuxPath}.gz`;
    await fsp.writeFile(gzPath, data.subarray(gzipOffset));
    try {
      await spawnToFile("gunzip", ["-c", gzPath], vmlinuxPath);
    } finally {
      await rm(gzPath, { force: true });
    }
    return;
  }

  // Already uncompressed ARM64 Image — copy as-is
  await fsp.copyFile(vmlinuzPath, vmlinuxPath);
}

export async function downloadUbuntuImage(
  version: string,
  arch: "arm64" | "amd64",
  destPath: string,
  bar: ProgressHandle
): Promise<void> {
  await downloadFile(getUbuntuImageUrl(version, arch), destPath, bar);
}

export async function downloadUbuntuKernel(
  version: string,
  arch: "arm64" | "amd64",
  vmlinuzPath: string,
  vmlinuxPath: string,
  bar: ProgressHandle
): Promise<void> {
  const url = `https://cloud-images.ubuntu.com/${codename(version)}/current/unpacked/${ubuntuKernelName(version, arch)}`;
  await downloadFile(url, vmlinuzPath, bar);
  await extractKernel(vmlinuzPath, vmlinuxPath);
}

export async function downloadUbuntuInitrd(
  version: string,
  arch: "arm64" | "amd64",
  destPath: string,
  bar: ProgressHandle
): Promise<void> {
  const url = `https://cloud-images.ubuntu.com/${codename(version)}/current/unpacked/${ubuntuInitrdName(version, arch)}`;
  await downloadFile(url, destPath, bar);
}

async function runQuiet(cmd: string, args: string[]): Promise<void> {
  const child = spawn(cmd, args, { stdio: "ignore" });
  await once(child, "close");
  if (child.exitCode !== null && child.exitCode !== 0) {
    throw new Error(`${cmd} exited with code ${child.exitCode}`);
  }
}

export async function convertQcow2ToRaw(
  vmmBin: string,
  src: string,
  dest: string
): Promise<void> {
  await runQuiet(vmmBin, ["disk", "convert", src, dest]);
}

export async function resizeRaw(
  vmmBin: string,
  path: string,
  size: string
): Promise<void> {
  await runQuiet(vmmBin, ["disk", "resize", path, size]);
}

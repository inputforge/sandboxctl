import { execFile, spawn } from "node:child_process";
import { createWriteStream, promises as fsp } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import type { ProgressHandle } from "@inputforge/providers";

const execFileAsync = promisify(execFile);

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
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }

  let downloaded = 0;
  const total = Number(res.headers.get("content-length") ?? 0);

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
    bar.stop("Downloaded.");
  } catch (error) {
    bar.stop("Download failed.");
    await rm(destPath, { force: true });
    throw error;
  }
}

async function spawnToFile(
  cmd: string,
  args: string[],
  destPath: string
): Promise<void> {
  const out = createWriteStream(destPath);
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
  // non-zero exit is OK (zstd exits 1 on trailing bytes) — output is still valid
  await pipeline(child.stdout as Readable, out);
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
      await spawnToFile("zstd", ["-dc", zstPath], vmlinuxPath);
    } finally {
      await rm(zstPath, { force: true });
    }
    return;
  }

  // gzip magic — whole file or payload at offset (e.g. Ubuntu 24.04)
  const gzipMagic = Buffer.from([0x1f, 0x8b]);
  const gzipOffset = data.indexOf(gzipMagic);
  if (gzipOffset !== -1) {
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

export async function convertQcow2ToRaw(
  vmmBin: string,
  src: string,
  dest: string
): Promise<void> {
  await execFileAsync(vmmBin, ["disk", "convert", src, dest], {
    stdio: "ignore",
  } as never);
}

export async function resizeRaw(
  vmmBin: string,
  path: string,
  size: string
): Promise<void> {
  await execFileAsync(vmmBin, ["disk", "resize", path, size], {
    stdio: "ignore",
  } as never);
}

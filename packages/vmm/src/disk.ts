import { execFileSync } from "node:child_process";
import { createWriteStream, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { progress } from "@clack/prompts";

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

function getUbuntuImageName(version: string): string {
  const codename = UBUNTU_CODENAMES[version];
  if (!codename) {
    throw new Error(`Unsupported Ubuntu version: ${version}`);
  }
  return `${codename}-server-cloudimg-arm64.img`;
}

function getUbuntuImageUrl(version: string): string {
  const codename = UBUNTU_CODENAMES[version];
  if (!codename) {
    throw new Error(`Unsupported Ubuntu version: ${version}`);
  }
  return `https://cloud-images.ubuntu.com/${codename}/current/${getUbuntuImageName(version)}`;
}

export function ubuntuImageName(version: string): string {
  return getUbuntuImageName(version);
}

export function convertQcow2ToRaw(
  vmmBin: string,
  src: string,
  dest: string
): void {
  execFileSync(vmmBin, ["disk", "convert", src, dest], { stdio: "ignore" });
}

export function resizeRaw(vmmBin: string, path: string, size: string): void {
  execFileSync(vmmBin, ["disk", "resize", path, size], { stdio: "ignore" });
}

export async function downloadUbuntuImage(
  version: string,
  destPath: string
): Promise<void> {
  const url = getUbuntuImageUrl(version);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }

  const total = Number(res.headers.get("content-length") ?? 0);
  const bar = progress(total > 0 ? { max: total } : undefined);
  bar.start(`Downloading Ubuntu ${version} (arm64)...`);

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

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import envPaths from "env-paths";

const paths = envPaths("create-sandbox", { suffix: "" });

export const appDataDir = paths.data;
export const imagesDir = join(appDataDir, "images");
export const sandboxesDir = join(appDataDir, "sandboxes");
export const globalKeyPath = join(appDataDir, "id_ed25519");
export const globalKeyPubPath = join(appDataDir, "id_ed25519.pub");

export function sandboxDir(name: string): string {
  return join(sandboxesDir, name);
}

export function seedImgPath(name: string): string {
  return join(sandboxDir(name), "seed.iso");
}

export function vmLogPath(name: string): string {
  return join(sandboxDir(name), "vm.log");
}

export function vmRawDiskPath(name: string): string {
  return join(sandboxDir(name), "disk.raw");
}

export function vmmPidPath(name: string): string {
  return join(sandboxDir(name), "vmm.pid");
}

export function vmmConfigPath(name: string): string {
  return join(sandboxDir(name), "vmm-config.json");
}

export function vmmStateDirPath(name: string): string {
  return join(sandboxDir(name), "efi-state");
}

const SSH_PUBLIC_KEY_CANDIDATES = [
  join(homedir(), ".ssh", "id_ed25519.pub"),
  join(homedir(), ".ssh", "id_rsa.pub"),
  join(homedir(), ".ssh", "id_ecdsa.pub"),
];

function generateSshKey(): string {
  mkdirSync(appDataDir, { recursive: true });
  execSync(
    `ssh-keygen -t ed25519 -f "${globalKeyPath}" -N "" -C "create-sandbox"`,
    { stdio: "ignore" }
  );
  return readFileSync(globalKeyPubPath, "utf-8").trim();
}

export function findSshPublicKey(): string {
  for (const candidate of SSH_PUBLIC_KEY_CANDIDATES) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf-8").trim();
    }
  }
  return generateSshKey();
}

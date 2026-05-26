import { basename, join } from "node:path";

import envPaths from "env-paths";

const paths = envPaths("create-sandbox", { suffix: "" });

export const appDataDir = paths.data;
export const limaHome = join(appDataDir, "lima");
export const imagesDir = join(appDataDir, "images");
export const sandboxesDir = join(appDataDir, "sandboxes");
export const globalConfigPath = join(appDataDir, "config.json");
export const globalKeyPath = join(appDataDir, "id_ed25519");
export const globalKeyPubPath = join(appDataDir, "id_ed25519.pub");

export function sandboxName(): string {
  return basename(process.cwd());
}

export function sandboxDir(name?: string): string {
  return join(sandboxesDir, name ?? sandboxName());
}

export function vmImgPath(name?: string): string {
  return join(sandboxDir(name), "ubuntu-vm.img");
}

export function seedImgPath(name?: string): string {
  return join(sandboxDir(name), "seed.iso");
}

export function vmSockPath(name?: string): string {
  return join(sandboxDir(name), "vm.sock");
}

export function vmLogPath(name?: string): string {
  return join(sandboxDir(name), "vm.log");
}

export function stateJsonPath(name?: string): string {
  return join(sandboxDir(name), "state.json");
}

export function configSnapshotPath(name?: string): string {
  return join(sandboxDir(name), "sandbox.snapshot.json");
}

export function ec2InstancePath(name?: string): string {
  return join(sandboxDir(name), "ec2-instance.json");
}

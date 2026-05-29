import { join } from "node:path";

import envPaths from "env-paths";

const paths = envPaths("create-sandbox", { suffix: "" });

export const appDataDir = paths.data;
export const sandboxesDir = join(appDataDir, "sandboxes");
export const globalKeyPath = join(appDataDir, "id_ed25519");
export const globalKeyPubPath = join(appDataDir, "id_ed25519.pub");

export function sandboxDir(name: string): string {
  return join(sandboxesDir, name);
}

export function ec2InstancePath(name: string): string {
  return join(sandboxDir(name), "ec2-instance.json");
}

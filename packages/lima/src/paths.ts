import { join } from "node:path";

import envPaths from "env-paths";

const paths = envPaths("sandboxctl", { suffix: "" });

export const appDataDir = paths.data;
export const limaHome = join(appDataDir, "lima");
export const sandboxesDir = join(appDataDir, "sandboxes");
export const globalKeyPath = join(appDataDir, "id_ed25519");
export const globalKeyPubPath = join(appDataDir, "id_ed25519.pub");

export function sandboxDir(name: string): string {
  return join(sandboxesDir, name);
}

export function vmLogPath(name: string): string {
  return join(sandboxDir(name), "vm.log");
}

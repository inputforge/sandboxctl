import { execSync } from "node:child_process";

export function isRsyncAvailable(): boolean {
  try {
    execSync(process.platform === "win32" ? "where rsync" : "which rsync", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

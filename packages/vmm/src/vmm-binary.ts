import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";

export function resolveVmmBinary(): string {
  if (platform() !== "darwin" || arch() !== "arm64") {
    throw new Error("vmm provider requires macOS on Apple Silicon");
  }
  return fileURLToPath(new URL("vmm", import.meta.url));
}

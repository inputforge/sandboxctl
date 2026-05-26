import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { globalConfigPath } from "./paths.js";

export interface GlobalConfig {
  defaultProvider?: "local" | "ec2";
  ec2?: {
    arch?: "arm64" | "amd64";
    instanceType?: string;
    region?: string;
  };
}

export function readGlobalConfig(): GlobalConfig {
  if (!existsSync(globalConfigPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(globalConfigPath, "utf-8")) as GlobalConfig;
  } catch {
    return {};
  }
}

export function writeGlobalConfig(cfg: GlobalConfig): void {
  mkdirSync(dirname(globalConfigPath), { recursive: true });
  writeFileSync(globalConfigPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf-8");
}

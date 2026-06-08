import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import { globalConfigPath } from "./paths.js";

const GlobalConfigSchema = z.object({
  defaultProvider: z.enum(["local", "ec2", "vmm"]).optional(),
  ec2: z
    .object({
      arch: z.enum(["arm64", "amd64"]).optional(),
      instanceType: z.string().optional(),
      region: z.string().optional(),
      sshCidr: z.string().optional(),
    })
    .optional(),
  version: z.number().int().positive().default(1),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export function readGlobalConfig(): GlobalConfig {
  if (!existsSync(globalConfigPath)) {
    return GlobalConfigSchema.parse({});
  }
  try {
    return GlobalConfigSchema.parse(
      JSON.parse(readFileSync(globalConfigPath, "utf-8"))
    );
  } catch {
    return GlobalConfigSchema.parse({});
  }
}

export function writeGlobalConfig(cfg: GlobalConfig): void {
  mkdirSync(dirname(globalConfigPath), { recursive: true });
  writeFileSync(globalConfigPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf-8");
}

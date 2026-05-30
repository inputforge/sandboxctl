import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, join } from "node:path";

import type { SandboxConfig } from "@inputforge/providers";
import { z } from "zod";

import { configSnapshotPath, stateJsonPath } from "./paths.js";

export type { SandboxConfig } from "@inputforge/providers";

const PACKAGE_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u;

const PackageConfigSchema = z.object({
  enabled: z.boolean().optional(),
  version: z
    .string()
    .regex(
      PACKAGE_VERSION_RE,
      "Package version may only contain letters, numbers, dots, pluses, underscores, and hyphens"
    )
    .optional(),
});

const PortForwardSchema = z.object({
  guest: z.number(),
  host: z.number(),
  protocol: z.enum(["tcp", "udp"]).optional(),
});

const Ec2ConfigSchema = z.object({
  arch: z.enum(["arm64", "amd64"]).optional(),
  instanceType: z.string().optional(),
  region: z.string().optional(),
  sshCidr: z.string().optional(),
});

const VmmHostConfigSchema = z.object({
  boot: z.enum(["efi", "linux"]).optional(),
});

const SandboxConfigSchema = z.object({
  ec2: Ec2ConfigSchema.optional(),
  packages: z.record(z.string(), PackageConfigSchema),
  ports: z.array(PortForwardSchema).optional(),
  provider: z.enum(["local", "ec2", "vmm"]).optional(),
  send: z
    .object({
      remotePath: z.string().optional(),
    })
    .optional(),
  ubuntu: z.string(),
  username: z.string().default(() => userInfo().username),
  vm: z.object({
    arch: z.enum(["arm64", "amd64"]).optional(),
    cpus: z.number(),
    disk: z.string(),
    memory: z.string(),
  }),
  vmm: VmmHostConfigSchema.optional(),
});

type AssertAssignable<T extends U, U> = T;
type _SchemaMatchesSandboxConfig = AssertAssignable<
  z.infer<typeof SandboxConfigSchema>,
  SandboxConfig
>;
type _SandboxConfigMatchesSchema = AssertAssignable<
  SandboxConfig,
  z.infer<typeof SandboxConfigSchema>
>;

const SandboxStateSchema = z.object({
  host: z.string().trim().min(1).default("127.0.0.1"),
  identityFile: z.string().optional(),
  port: z.number().int().min(1).max(65_535),
  startedAt: z
    .string()
    .refine(
      (value) => !Number.isNaN(new Date(value).getTime()),
      "Invalid startedAt"
    ),
});

export type PackageConfig = z.infer<typeof PackageConfigSchema>;
export type PortForward = z.infer<typeof PortForwardSchema>;
export type SandboxState = z.infer<typeof SandboxStateSchema>;

export function readSandboxConfig(cwd: string = process.cwd()): SandboxConfig {
  const p = join(cwd, "sandbox.json");
  if (!existsSync(p)) {
    console.error(
      "No sandbox.json found in current directory. Run: create-sandbox init"
    );
    process.exit(1);
  }
  return SandboxConfigSchema.parse(JSON.parse(readFileSync(p, "utf-8")));
}

export function readSandboxConfigOptional(
  cwd: string = process.cwd()
): SandboxConfig | null {
  const p = join(cwd, "sandbox.json");
  if (!existsSync(p)) {
    return null;
  }
  try {
    const content = readFileSync(p, "utf-8");
    return SandboxConfigSchema.parse(JSON.parse(content));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export function writeSandboxConfig(
  config: SandboxConfig,
  cwd: string = process.cwd()
): void {
  writeFileSync(
    join(cwd, "sandbox.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf-8"
  );
}

export function readState(name?: string): SandboxState | null {
  const p = stateJsonPath(name);
  if (!existsSync(p)) {
    return null;
  }
  try {
    return SandboxStateSchema.parse(JSON.parse(readFileSync(p, "utf-8")));
  } catch {
    return null;
  }
}

export function writeState(state: SandboxState, name?: string): void {
  writeFileSync(
    stateJsonPath(name),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf-8"
  );
}

export function getRemotePath(config: SandboxConfig): string {
  return (
    config.send?.remotePath ??
    `/home/${config.username}/${basename(process.cwd())}`
  );
}

export function readConfigSnapshot(name?: string): SandboxConfig | null {
  const p = configSnapshotPath(name);
  if (!existsSync(p)) {
    return null;
  }
  try {
    return SandboxConfigSchema.parse(JSON.parse(readFileSync(p, "utf-8")));
  } catch {
    return null;
  }
}

export function writeConfigSnapshot(
  config: SandboxConfig,
  name?: string
): void {
  writeFileSync(
    configSnapshotPath(name),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf-8"
  );
}

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { appDataDir, globalKeyPath, globalKeyPubPath } from "./paths.js";

const CANDIDATES = [
  join(homedir(), ".ssh", "id_ed25519.pub"),
  join(homedir(), ".ssh", "id_rsa.pub"),
  join(homedir(), ".ssh", "id_ecdsa.pub"),
];

function generateSshKey(): string {
  mkdirSync(appDataDir, { recursive: true });
  execFileSync(
    "ssh-keygen",
    ["-t", "ed25519", "-f", globalKeyPath, "-N", "", "-C", "sandboxctl"],
    { stdio: "ignore" }
  );
  return readFileSync(globalKeyPubPath, "utf-8").trim();
}

export function findSshKeyPair(): {
  privateKeyPath: string;
  publicKey: string;
} {
  for (const candidate of CANDIDATES) {
    const privateKeyPath = candidate.replace(/\.pub$/u, "");
    if (existsSync(candidate) && existsSync(privateKeyPath)) {
      return {
        privateKeyPath,
        publicKey: readFileSync(candidate, "utf-8").trim(),
      };
    }
  }

  if (!existsSync(globalKeyPubPath) || !existsSync(globalKeyPath)) {
    generateSshKey();
  }

  return {
    privateKeyPath: globalKeyPath,
    publicKey: readFileSync(globalKeyPubPath, "utf-8").trim(),
  };
}

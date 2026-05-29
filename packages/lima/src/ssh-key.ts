import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { appDataDir, globalKeyPath, globalKeyPubPath } from "./paths.js";

const SSH_PUBLIC_KEY_CANDIDATES = [
  join(homedir(), ".ssh", "id_ed25519.pub"),
  join(homedir(), ".ssh", "id_rsa.pub"),
  join(homedir(), ".ssh", "id_ecdsa.pub"),
];

function generateSshKey(): string {
  mkdirSync(appDataDir, { recursive: true });
  execFileSync(
    "ssh-keygen",
    ["-t", "ed25519", "-f", globalKeyPath, "-N", "", "-C", "create-sandbox"],
    { stdio: "ignore" }
  );
  return readFileSync(globalKeyPubPath, "utf-8").trim();
}

export function findSshPublicKey(): string {
  if (existsSync(globalKeyPubPath)) {
    return readFileSync(globalKeyPubPath, "utf-8").trim();
  }

  for (const candidate of SSH_PUBLIC_KEY_CANDIDATES) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf-8").trim();
    }
  }
  return generateSshKey();
}

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SandboxIdentity {
  privateKey?: string;
  privateKeyPath?: string;
}

const SSH_CANDIDATES = [
  join(homedir(), ".ssh", "id_ed25519"),
  join(homedir(), ".ssh", "id_rsa"),
  join(homedir(), ".ssh", "id_ecdsa"),
];

export function defaultIdentity(): SandboxIdentity {
  for (const candidate of SSH_CANDIDATES) {
    if (existsSync(candidate)) {
      return { privateKeyPath: candidate };
    }
  }
  throw new Error(
    "No SSH key found in ~/.ssh. Generate one with: ssh-keygen -t ed25519"
  );
}

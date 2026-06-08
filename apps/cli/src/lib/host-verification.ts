import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { HostVerificationConfig } from "@inputforge/sandboxctl-providers";

import { sandboxesDir } from "./paths.js";

export function knownHostsPath(): string {
  return `${sandboxesDir}/known_hosts`;
}

/**
 * Parse the key-type string from an OpenSSH wire-format key buffer.
 * Wire format: 4-byte big-endian length + key-type string + ...
 * Returns false if the buffer is too short or otherwise malformed.
 */
function keyType(key: Buffer): string | false {
  if (key.length < 4) {
    return false;
  }
  const len = key.readUInt32BE(0);
  if (key.length < 4 + len) {
    return false;
  }
  return key.subarray(4, 4 + len).toString("utf-8");
}

/** Encode a wire-format key as "<key-type> <base64>" — the known_hosts token pair. */
function encodeKey(key: Buffer): string | false {
  const type = keyType(key);
  if (type === false) {
    return false;
  }
  return `${type} ${key.toString("base64")}`;
}

/**
 * Parse an OpenSSH known_hosts file into a Map of hostname → "keytype base64".
 * Comment and blank lines are preserved but not returned.
 */
function loadKnownHosts(path: string): Map<string, string> {
  const entries = new Map<string, string>();
  if (!existsSync(path)) {
    return entries;
  }
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("@")) {
      continue;
    }
    const spaceIdx = line.search(/\s/u);
    if (spaceIdx === -1) {
      continue;
    }
    const host = line.slice(0, spaceIdx);
    const rest = line.slice(spaceIdx).trimStart();
    // rest = "<keytype> <base64>" — keep the two-token key entry
    entries.set(host, rest);
  }
  return entries;
}

function saveKnownHosts(path: string, entries: Map<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    `# sandboxctl managed — edit with ssh-keygen -R <name> -f ${path}`,
  ];
  for (const [name, entry] of entries) {
    lines.push(`${name} ${entry}`);
  }
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
}

/**
 * Build a host key verifier for use with `new Sandbox({ hostVerifier })`.
 *
 * The known_hosts file at `knownHostsPath()` uses standard OpenSSH format so it
 * can be inspected or managed with ssh-keygen.
 *
 * Modes:
 *  - "skip"   — accept all keys (default when no config supplied)
 *  - "tofu"   — trust-on-first-use: persist the first key seen for each sandbox
 *               and reject if it later changes
 *  - "strict" — reject unless a key was already persisted via a prior tofu connection
 */
export function createHostVerifier(
  sandboxName: string,
  cfg?: HostVerificationConfig
): (key: Buffer) => boolean {
  const mode = cfg?.mode ?? "skip";

  if (mode === "skip") {
    return () => true;
  }

  const storePath = knownHostsPath();

  return (key: Buffer): boolean => {
    const incoming = encodeKey(key);
    if (incoming === false) {
      console.error(
        `[sandboxctl] Received malformed host key for "${sandboxName}" — rejecting`
      );
      return false;
    }
    const entries = loadKnownHosts(storePath);
    const stored = entries.get(sandboxName);

    if (!stored) {
      if (mode === "strict") {
        console.error(
          `[sandboxctl] Strict host verification: no stored key for "${sandboxName}". ` +
            `Connect once with mode "tofu" to register the key, or add it manually with:\n` +
            `  ssh-keyscan <host> >> ${storePath}`
        );
        return false;
      }
      // tofu: persist and accept
      entries.set(sandboxName, incoming);
      saveKnownHosts(storePath, entries);
      return true;
    }

    if (stored !== incoming) {
      console.error(
        `[sandboxctl] Host key mismatch for "${sandboxName}"!\n` +
          `  Stored:   ${stored}\n` +
          `  Received: ${incoming}\n` +
          `If the VM was rebuilt, remove the entry with:\n` +
          `  ssh-keygen -R ${sandboxName} -f ${storePath}`
      );
      return false;
    }

    return true;
  };
}

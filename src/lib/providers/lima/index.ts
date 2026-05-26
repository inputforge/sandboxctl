import { mkdirSync, readFileSync, rmSync } from "node:fs";

import { spinner } from "@clack/prompts";

import { buildInstallScript } from "../../installers.js";
import { sandboxDir, vmLogPath } from "../../paths.js";
import type { PlatformConfig } from "../../platform.js";
import { findSshPublicKey } from "../../ssh-key.js";
import type { VmProvider } from "../index.js";
import {
  buildLimaYaml,
  checkLimactlInstalled,
  deleteLimaInstance,
  getLimaInstance,
  isLimaRunning,
  startLimaInstance,
  stopLimaInstance,
  writeLimaYaml,
} from "./lima.js";

export function createLimaProvider(pc: PlatformConfig): VmProvider {
  return {
    destroy: (name) => {
      deleteLimaInstance(name, vmLogPath(name));
      rmSync(sandboxDir(), { force: true, recursive: true });
      return Promise.resolve();
    },

    isInitialized: (name) => getLimaInstance(name) !== null,

    isRunning: (name) => Promise.resolve(isLimaRunning(name)),

    start: async (config, name, snapshot) => {
      checkLimactlInstalled();

      const instance = getLimaInstance(name);
      const isFirstBoot = instance === null;

      if (!isFirstBoot && instance.status === "Running") {
        if (snapshot) {
          if (config.ubuntu !== snapshot.ubuntu) {
            console.error(
              `sandbox.json "ubuntu" changed (${snapshot.ubuntu} → ${config.ubuntu}).\n` +
                "This requires a full rebuild. Run: create-sandbox destroy && create-sandbox start"
            );
            process.exit(1);
          }
          if (
            JSON.stringify(config.packages) !==
            JSON.stringify(snapshot.packages)
          ) {
            console.error(
              'sandbox.json "packages" changed.\n' +
                "This requires a full rebuild. Run: create-sandbox destroy && create-sandbox start"
            );
            process.exit(1);
          }
        }
        console.error(`Sandbox "${name}" is already running.`);
        process.exit(1);
      }

      const pubKey = findSshPublicKey();
      const installScript = buildInstallScript(config.packages, pc.ubuntuArch);
      const yaml = buildLimaYaml(config, pc, installScript, pubKey);

      mkdirSync(sandboxDir(), { recursive: true });
      writeLimaYaml(name, yaml);

      const label = isFirstBoot
        ? "Creating and provisioning sandbox (this may take a few minutes)..."
        : "Starting sandbox...";

      const s = spinner();
      s.start(label);

      const logPath = vmLogPath();
      const startedAt = Date.now();
      const logTail = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        const elapsedStr =
          elapsed >= 60
            ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s`
            : `${elapsed}s`;
        try {
          const lines = readFileSync(logPath, "utf-8")
            .trimEnd()
            .split("\n")
            .filter(Boolean);
          const last = lines.at(-1);
          const msg = last ? (last.match(/msg="([^"]+)"/u)?.[1] ?? last) : "";
          s.message(`${label} [${elapsedStr}]\n  ${msg.slice(0, 100)}`);
        } catch {
          s.message(`${label} [${elapsedStr}]`);
        }
      }, 1000);

      try {
        await startLimaInstance(name, logPath);
      } catch (error) {
        clearInterval(logTail);
        s.stop("Failed to start sandbox.");
        throw error;
      }
      clearInterval(logTail);

      const started = getLimaInstance(name);
      if (!started) {
        s.stop("Lima instance did not start.");
        process.exit(1);
      }

      s.stop(isFirstBoot ? "Sandbox provisioned." : "Sandbox started.");
      return {
        host: "127.0.0.1",
        port: started.sshLocalPort,
      };
    },

    stop: (name) => {
      stopLimaInstance(name, vmLogPath(name));
      return Promise.resolve();
    },
  };
}

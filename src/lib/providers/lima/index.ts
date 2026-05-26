import { mkdirSync, rmSync } from "node:fs";

import { log } from "@clack/prompts";

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
      deleteLimaInstance(name);
      rmSync(sandboxDir(), { force: true, recursive: true });
      return Promise.resolve();
    },

    isInitialized: (name) => getLimaInstance(name) !== null,

    isRunning: (name) => Promise.resolve(isLimaRunning(name)),

    start: (config, name, snapshot) => {
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

      log.step(
        isFirstBoot
          ? "Creating and provisioning sandbox (this may take a few minutes)..."
          : "Starting sandbox..."
      );
      startLimaInstance(name, vmLogPath());

      const started = getLimaInstance(name);
      if (!started) {
        console.error("Lima instance did not start.");
        process.exit(1);
      }

      return Promise.resolve({
        host: "127.0.0.1",
        port: started.sshLocalPort,
      });
    },

    stop: (name) => {
      stopLimaInstance(name);
      return Promise.resolve();
    },
  };
}

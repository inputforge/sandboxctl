import { mkdirSync, readFileSync, rmSync } from "node:fs";

import type { VmProvider } from "@inputforge/providers";

import { buildInstallScript } from "./installers.js";
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
import { sandboxDir, vmLogPath } from "./paths.js";
import type { PlatformConfig } from "./platform.js";
import { findSshPublicKey } from "./ssh-key.js";

export function createLimaProvider(pc: PlatformConfig): VmProvider {
  return {
    destroy: (name, _reporter) => {
      deleteLimaInstance(name, vmLogPath(name));
      rmSync(sandboxDir(name), { force: true, recursive: true });
      return Promise.resolve();
    },

    isInitialized: (name) => getLimaInstance(name) !== null,

    isRunning: (name) => Promise.resolve(isLimaRunning(name)),

    start: async (config, name, snapshot, reporter) => {
      checkLimactlInstalled();

      const instance = getLimaInstance(name);
      const isFirstBoot = instance === null;

      if (!isFirstBoot && instance.status === "Running") {
        if (snapshot) {
          if (config.ubuntu !== snapshot.ubuntu) {
            throw new Error(
              `sandbox.json "ubuntu" changed (${snapshot.ubuntu} → ${config.ubuntu}).\n` +
                "This requires a full rebuild. Run: sandboxctl destroy && sandboxctl start"
            );
          }
          if (
            JSON.stringify(config.packages) !==
            JSON.stringify(snapshot.packages)
          ) {
            throw new Error(
              'sandbox.json "packages" changed.\n' +
                "This requires a full rebuild. Run: sandboxctl destroy && sandboxctl start"
            );
          }
        }
        throw new Error(`Sandbox "${name}" is already running.`);
      }

      const pubKey = findSshPublicKey();
      const installScript = buildInstallScript(config.packages, pc.ubuntuArch);
      const yaml = buildLimaYaml(config, pc, installScript, pubKey);

      mkdirSync(sandboxDir(name), { recursive: true });
      writeLimaYaml(name, yaml);

      const label = isFirstBoot
        ? "Creating and provisioning sandbox (this may take a few minutes)..."
        : "Starting sandbox...";

      const s = reporter.spin(label);

      const logPath = vmLogPath(name);
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
          s.update(`${label} [${elapsedStr}]\n  ${msg.slice(0, 100)}`);
        } catch {
          s.update(`${label} [${elapsedStr}]`);
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
        throw new Error("Lima instance did not start.");
      }

      s.stop(isFirstBoot ? "Sandbox provisioned." : "Sandbox started.");
      return {
        host: "127.0.0.1",
        port: started.sshLocalPort,
      };
    },

    stop: (name, _reporter) => {
      stopLimaInstance(name, vmLogPath(name));
      return Promise.resolve();
    },
  };
}

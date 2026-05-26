import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { EC2Client } from "@aws-sdk/client-ec2";
import { SSMClient } from "@aws-sdk/client-ssm";
import { log, spinner } from "@clack/prompts";

import { buildUserData } from "../../cloud-init.js";
import { buildInstallScript } from "../../installers.js";
import { ec2InstancePath, sandboxDir } from "../../paths.js";
import { findSshKeyPair } from "../../ssh-key.js";
import type { VmProvider } from "../index.js";
import type { Ec2InstanceState } from "./ec2.js";
import {
  deleteKeyPair,
  deleteSecurityGroup,
  describeInstance,
  ensureKeyPair,
  ensureSecurityGroup,
  launchInstance,
  pollSshReady,
  resolveUbuntuAmi,
  startInstance,
  stopInstance,
  streamInstallLog,
  terminateInstance,
  waitForState,
} from "./ec2.js";

interface Ec2ProviderConfig {
  instanceType: string;
  region?: string;
}

function createClients(region: string): {
  ec2Client: EC2Client;
  ssmClient: SSMClient;
} {
  return {
    ec2Client: new EC2Client({ region }),
    ssmClient: new SSMClient({ region }),
  };
}

function requireRegion(config: Ec2ProviderConfig): string {
  if (!config.region) {
    throw new Error(
      'EC2 provider requires a region. Add "ec2.region" to sandbox.json or global config.'
    );
  }
  return config.region;
}

function readEc2State(name: string): Ec2InstanceState | null {
  const path = ec2InstancePath(name);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Ec2InstanceState;
  } catch {
    return null;
  }
}

function writeEc2State(name: string, state: Ec2InstanceState): void {
  mkdirSync(sandboxDir(name), { recursive: true });
  writeFileSync(ec2InstancePath(name), `${JSON.stringify(state, null, 2)}\n`);
}

function requirePublicIp(publicIp: string, instanceId: string): string {
  if (!publicIp) {
    throw new Error(`EC2 instance ${instanceId} does not have a public IP`);
  }
  return publicIp;
}

export function createEc2Provider(
  providerConfig: Ec2ProviderConfig,
  arch: "arm64" | "amd64"
): VmProvider {
  return {
    destroy: async (name) => {
      const region = requireRegion(providerConfig);
      const state = readEc2State(name);
      if (!state) {
        rmSync(sandboxDir(name), { force: true, recursive: true });
        return;
      }

      const { ec2Client } = createClients(region);
      const s = spinner();
      s.start("Terminating EC2 instance...");
      await terminateInstance(ec2Client, state.instanceId);
      await waitForState(ec2Client, state.instanceId, "terminated");
      s.stop("EC2 instance terminated.");

      await deleteKeyPair(ec2Client, state.keyPairName);
      await deleteSecurityGroup(ec2Client, state.securityGroupId);
      rmSync(sandboxDir(name), { force: true, recursive: true });
    },

    isInitialized: (name) => existsSync(ec2InstancePath(name)),

    isRunning: async (name) => {
      const region = requireRegion(providerConfig);
      const state = readEc2State(name);
      if (!state) {
        return false;
      }
      const { ec2Client } = createClients(region);
      const instance = await describeInstance(ec2Client, state.instanceId);
      return instance.state === "running";
    },

    start: async (config, name) => {
      const region = requireRegion(providerConfig);
      const { ec2Client, ssmClient } = createClients(region);
      const { privateKeyPath, publicKey } = findSshKeyPair();
      const keyPairName = `create-sandbox-${name}`;
      const securityGroupName = `create-sandbox-${name}`;
      const existing = readEc2State(name);

      if (existing) {
        const instance = await describeInstance(ec2Client, existing.instanceId);
        const s = spinner();
        s.start(
          instance.state === "running"
            ? "EC2 instance already running."
            : "Starting EC2 instance..."
        );
        if (
          instance.state === "terminated" ||
          instance.state === "shutting-down"
        ) {
          s.stop("EC2 instance cannot be restarted.");
          throw new Error(
            `EC2 instance ${existing.instanceId} is ${instance.state}. Run create-sandbox destroy and start again.`
          );
        }
        if (instance.state !== "running" && instance.state !== "pending") {
          await startInstance(ec2Client, existing.instanceId);
        }
        const publicIp = requirePublicIp(
          await waitForState(ec2Client, existing.instanceId, "running"),
          existing.instanceId
        );
        s.stop("EC2 instance running.");

        const ssh = spinner();
        ssh.start("Waiting for SSH...");
        await pollSshReady(publicIp, privateKeyPath);
        ssh.stop("SSH ready.");

        return { host: publicIp, identityFile: privateKeyPath, port: 22 };
      }

      mkdirSync(sandboxDir(name), { recursive: true });

      const s = spinner();
      s.start(`Resolving Ubuntu ${config.ubuntu} AMI...`);
      const amiId = await resolveUbuntuAmi(
        ssmClient,
        region,
        config.ubuntu,
        arch
      );
      s.stop(`Resolved AMI ${amiId}.`);

      await ensureKeyPair(ec2Client, keyPairName, publicKey);
      const securityGroupId = await ensureSecurityGroup(
        ec2Client,
        securityGroupName
      );
      const installScript = buildInstallScript(config.packages, arch);
      const userData = buildUserData(publicKey, installScript);

      const launch = spinner();
      launch.start(`Launching EC2 ${providerConfig.instanceType}...`);
      const instanceId = await launchInstance(ec2Client, {
        amiId,
        instanceType: providerConfig.instanceType,
        keyPairName,
        securityGroupId,
        userData,
      });
      const publicIp = requirePublicIp(
        await waitForState(ec2Client, instanceId, "running"),
        instanceId
      );
      writeEc2State(name, {
        instanceId,
        keyPairName,
        securityGroupId,
      });
      launch.stop("EC2 instance running.");

      const ssh = spinner();
      ssh.start("Waiting for SSH...");
      await pollSshReady(publicIp, privateKeyPath);
      ssh.stop("SSH ready.");

      log.step("Streaming install log:");
      await streamInstallLog(publicIp, privateKeyPath);

      return { host: publicIp, identityFile: privateKeyPath, port: 22 };
    },

    stop: async (name) => {
      const region = requireRegion(providerConfig);
      const state = readEc2State(name);
      if (!state) {
        return;
      }
      const { ec2Client } = createClients(region);
      await stopInstance(ec2Client, state.instanceId);
      await waitForState(ec2Client, state.instanceId, "stopped");
    },
  };
}

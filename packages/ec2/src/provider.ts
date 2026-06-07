import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { EC2Client } from "@aws-sdk/client-ec2";
import { SSMClient } from "@aws-sdk/client-ssm";
import type {
  PrereqResult,
  ProviderReporter,
  SandboxConfig,
  VmProvider,
} from "@inputforge/sandboxctl-providers";

import { buildUserData } from "./cloud-init.js";
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
import { buildInstallScript } from "./installers.js";
import { ec2InstancePath, sandboxDir } from "./paths.js";
import { findSshKeyPair } from "./ssh-key.js";

interface Ec2ProviderConfig {
  instanceType: string;
  region?: string;
  sshCidr?: string;
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

function requireSshCidr(config: Ec2ProviderConfig): string {
  if (!config.sshCidr) {
    throw new Error(
      'EC2 provider requires an SSH allowlist CIDR. Add "ec2.sshCidr" to sandbox.json or set CREATE_SANDBOX_EC2_SSH_CIDR.'
    );
  }
  return config.sshCidr;
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
    checkPrereqs(): void {
      // EC2 prerequisites (credentials, region) are validated at start time by the SDK
    },

    destroy: async (name, reporter) => {
      const region = requireRegion(providerConfig);
      const state = readEc2State(name);
      if (!state) {
        rmSync(sandboxDir(name), { force: true, recursive: true });
        return;
      }

      const { ec2Client } = createClients(region);
      const s = reporter.spin("Terminating EC2 instance...");
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

    isSupported(): boolean {
      return true;
    },

    reportPrereqs(): PrereqResult[] {
      return [];
    },

    start: async (
      config: SandboxConfig,
      name: string,
      _snapshot,
      reporter: ProviderReporter
    ) => {
      const region = requireRegion(providerConfig);
      const { ec2Client, ssmClient } = createClients(region);
      const { privateKeyPath, publicKey } = findSshKeyPair();
      const keyPairName = `sandboxctl-${name}`;
      const securityGroupName = `sandboxctl-${name}`;
      const existing = readEc2State(name);

      if (existing) {
        const instance = await describeInstance(ec2Client, existing.instanceId);
        const s = reporter.spin(
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
            `EC2 instance ${existing.instanceId} is ${instance.state}. Run sandboxctl destroy and start again.`
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

        const ssh = reporter.spin("Waiting for SSH...");
        await pollSshReady(publicIp, privateKeyPath);
        ssh.stop("SSH ready.");

        return { host: publicIp, identityFile: privateKeyPath, port: 22 };
      }

      mkdirSync(sandboxDir(name), { recursive: true });
      const sshCidr = requireSshCidr(providerConfig);

      const amiSpinner = reporter.spin(
        `Resolving Ubuntu ${config.ubuntu} AMI...`
      );
      const amiId = await resolveUbuntuAmi(
        ssmClient,
        region,
        config.ubuntu,
        arch
      );
      amiSpinner.stop(`Resolved AMI ${amiId}.`);

      await ensureKeyPair(ec2Client, keyPairName, publicKey);
      const securityGroupId = await ensureSecurityGroup(
        ec2Client,
        securityGroupName,
        sshCidr
      );
      const installScript = buildInstallScript(config.packages, arch);
      const userData = buildUserData(publicKey, installScript);

      const launch = reporter.spin(
        `Launching EC2 ${providerConfig.instanceType}...`
      );
      const instanceId = await launchInstance(ec2Client, {
        amiId,
        instanceType: providerConfig.instanceType,
        keyPairName,
        securityGroupId,
        userData,
      });
      writeEc2State(name, {
        instanceId,
        keyPairName,
        securityGroupId,
      });
      const publicIp = requirePublicIp(
        await waitForState(ec2Client, instanceId, "running"),
        instanceId
      );
      launch.stop("EC2 instance running.");

      const ssh = reporter.spin("Waiting for SSH...");
      await pollSshReady(publicIp, privateKeyPath);
      ssh.stop("SSH ready.");

      reporter.step("Streaming install log:");
      await streamInstallLog(publicIp, privateKeyPath, (line) =>
        reporter.log(line)
      );

      return { host: publicIp, identityFile: privateKeyPath, port: 22 };
    },

    stop: async (name, reporter) => {
      const region = requireRegion(providerConfig);
      const state = readEc2State(name);
      if (!state) {
        return;
      }
      const { ec2Client } = createClients(region);
      const s = reporter.spin("Stopping EC2 instance...");
      await stopInstance(ec2Client, state.instanceId);
      await waitForState(ec2Client, state.instanceId, "stopped");
      s.stop("EC2 instance stopped.");
    },
  };
}

import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

import {
  AuthorizeSecurityGroupIngressCommand,
  CreateSecurityGroupCommand,
  DeleteKeyPairCommand,
  DeleteSecurityGroupCommand,
  DescribeInstancesCommand,
  DescribeKeyPairsCommand,
  DescribeSecurityGroupsCommand,
  ImportKeyPairCommand,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
} from "@aws-sdk/client-ec2";
import type {
  _InstanceType,
  EC2Client,
  InstanceStateName,
} from "@aws-sdk/client-ec2";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import type {
  GetParameterCommandOutput,
  SSMClient as SSMClientType,
} from "@aws-sdk/client-ssm";

export interface Ec2InstanceState {
  instanceId: string;
  keyPairName: string;
  securityGroupId: string;
}

export interface LaunchInstanceOptions {
  amiId: string;
  instanceType: string;
  keyPairName: string;
  securityGroupId: string;
  userData: string;
}

const IPV4_CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/u;

function getErrorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function isAwsError(error: unknown, name: string): boolean {
  return getErrorName(error) === name;
}

function getUbuntuVolumeType(ubuntuVersion: string): "ebs-gp2" | "ebs-gp3" {
  const [majorRaw, minorRaw = "0"] = ubuntuVersion.split(".");
  const major = Number.parseInt(majorRaw ?? "", 10);
  const minor = Number.parseInt(minorRaw, 10);
  if (Number.isNaN(major) || Number.isNaN(minor)) {
    return "ebs-gp3";
  }
  return major > 23 || (major === 23 && minor >= 10) ? "ebs-gp3" : "ebs-gp2";
}

export async function describeInstance(
  ec2Client: EC2Client,
  instanceId: string
): Promise<{
  publicIpAddress?: string;
  state?: InstanceStateName;
}> {
  const res = await ec2Client.send(
    new DescribeInstancesCommand({ InstanceIds: [instanceId] })
  );
  const instance = res.Reservations?.[0]?.Instances?.[0];
  return {
    publicIpAddress: instance?.PublicIpAddress,
    state: instance?.State?.Name,
  };
}

export async function resolveUbuntuAmi(
  ssmClient: SSMClientType,
  region: string,
  ubuntuVersion: string,
  arch: "arm64" | "amd64"
): Promise<string> {
  const volumeType = getUbuntuVolumeType(ubuntuVersion);
  const path = `/aws/service/canonical/ubuntu/server/${ubuntuVersion}/stable/current/${arch}/hvm/${volumeType}/ami-id`;
  let res: GetParameterCommandOutput;
  try {
    res = await ssmClient.send(new GetParameterCommand({ Name: path }));
  } catch (error) {
    if (isAwsError(error, "ParameterNotFound")) {
      throw new Error(
        `Ubuntu ${ubuntuVersion} ${arch} AMI was not found in ${region}. Tried SSM parameter: ${path}`,
        { cause: error }
      );
    }
    throw error;
  }
  const amiId = res.Parameter?.Value;
  if (!amiId) {
    throw new Error(
      `Could not resolve Ubuntu ${ubuntuVersion} ${arch} AMI in ${region}`
    );
  }
  return amiId;
}

export async function ensureKeyPair(
  ec2Client: EC2Client,
  keyPairName: string,
  publicKey: string
): Promise<void> {
  try {
    await ec2Client.send(
      new DescribeKeyPairsCommand({ KeyNames: [keyPairName] })
    );
    return;
  } catch (error) {
    if (!isAwsError(error, "InvalidKeyPair.NotFound")) {
      throw error;
    }
  }

  await ec2Client.send(
    new ImportKeyPairCommand({
      KeyName: keyPairName,
      PublicKeyMaterial: Buffer.from(publicKey),
    })
  );
}

export async function deleteKeyPair(
  ec2Client: EC2Client,
  keyPairName: string
): Promise<void> {
  try {
    await ec2Client.send(new DeleteKeyPairCommand({ KeyName: keyPairName }));
  } catch (error) {
    if (!isAwsError(error, "InvalidKeyPair.NotFound")) {
      throw error;
    }
  }
}

function validateSshCidr(cidr: string): void {
  if (!IPV4_CIDR_RE.test(cidr)) {
    throw new Error(
      `Invalid EC2 SSH CIDR "${cidr}". Use an IPv4 CIDR like "203.0.113.10/32".`
    );
  }
  const [address, prefixRaw] = cidr.split("/");
  const prefix = Number.parseInt(prefixRaw ?? "", 10);
  const octets = (address ?? "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  const hasInvalidOctet = octets.some((octet) => octet < 0 || octet > 255);
  if (hasInvalidOctet || prefix < 1 || prefix > 32) {
    throw new Error(
      `Invalid EC2 SSH CIDR "${cidr}". Use an IPv4 CIDR like "203.0.113.10/32".`
    );
  }
}

export async function ensureSecurityGroup(
  ec2Client: EC2Client,
  groupName: string,
  sshCidr: string
): Promise<string> {
  validateSshCidr(sshCidr);
  let groupId: string | undefined;
  try {
    const existing = await ec2Client.send(
      new DescribeSecurityGroupsCommand({ GroupNames: [groupName] })
    );
    groupId = existing.SecurityGroups?.[0]?.GroupId;
  } catch (error) {
    if (!isAwsError(error, "InvalidGroup.NotFound")) {
      throw error;
    }
  }

  if (!groupId) {
    const created = await ec2Client.send(
      new CreateSecurityGroupCommand({
        Description: "create-sandbox SSH access",
        GroupName: groupName,
      })
    );
    groupId = created.GroupId;
    if (!groupId) {
      throw new Error(`Failed to create security group ${groupName}`);
    }
  }

  try {
    await ec2Client.send(
      new AuthorizeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: [
          {
            FromPort: 22,
            IpProtocol: "tcp",
            IpRanges: [{ CidrIp: sshCidr }],
            ToPort: 22,
          },
        ],
      })
    );
  } catch (error) {
    if (!isAwsError(error, "InvalidPermission.Duplicate")) {
      throw error;
    }
  }

  return groupId;
}

export async function deleteSecurityGroup(
  ec2Client: EC2Client,
  groupId: string
): Promise<void> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await ec2Client.send(
        new DeleteSecurityGroupCommand({ GroupId: groupId })
      );
      return;
    } catch (error) {
      if (isAwsError(error, "InvalidGroup.NotFound")) {
        return;
      }
      if (!isAwsError(error, "DependencyViolation") || attempt === 20) {
        throw error;
      }
      await sleep(3000);
    }
  }
}

export async function launchInstance(
  ec2Client: EC2Client,
  opts: LaunchInstanceOptions
): Promise<string> {
  const res = await ec2Client.send(
    new RunInstancesCommand({
      ImageId: opts.amiId,
      InstanceType: opts.instanceType as _InstanceType,
      KeyName: opts.keyPairName,
      MaxCount: 1,
      MinCount: 1,
      SecurityGroupIds: [opts.securityGroupId],
      UserData: Buffer.from(opts.userData, "utf-8").toString("base64"),
    })
  );
  const instanceId = res.Instances?.[0]?.InstanceId;
  if (!instanceId) {
    throw new Error("EC2 did not return an instance id");
  }
  return instanceId;
}

export async function startInstance(
  ec2Client: EC2Client,
  instanceId: string
): Promise<void> {
  await ec2Client.send(
    new StartInstancesCommand({ InstanceIds: [instanceId] })
  );
}

export async function stopInstance(
  ec2Client: EC2Client,
  instanceId: string
): Promise<void> {
  await ec2Client.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
}

export async function terminateInstance(
  ec2Client: EC2Client,
  instanceId: string
): Promise<void> {
  await ec2Client.send(
    new TerminateInstancesCommand({ InstanceIds: [instanceId] })
  );
}

export async function waitForState(
  ec2Client: EC2Client,
  instanceId: string,
  targetState: InstanceStateName
): Promise<string> {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const instance = await describeInstance(ec2Client, instanceId);
    if (instance.state === targetState) {
      return instance.publicIpAddress ?? "";
    }
    await sleep(5000);
  }
  throw new Error(`EC2 instance ${instanceId} did not reach ${targetState}`);
}

export async function pollSshReady(
  host: string,
  identityFile: string,
  maxAttempts = 120
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      execFileSync(
        "ssh",
        [
          "-i",
          identityFile,
          "-o",
          "ConnectTimeout=3",
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "UserKnownHostsFile=/dev/null",
          "-o",
          "BatchMode=yes",
          `ubuntu@${host}`,
          "exit",
        ],
        { stdio: "ignore" }
      );
      return;
    } catch {
      await sleep(3000);
    }
  }
  throw new Error(
    "SSH did not become available within the timeout (6 minutes)"
  );
}

export async function streamInstallLog(
  host: string,
  identityFile: string
): Promise<void> {
  const child = spawn("ssh", [
    "-i",
    identityFile,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes",
    `ubuntu@${host}`,
    "until [ -f /var/log/install-tools.log ]; do sleep 2; done; tail -f /var/log/install-tools.log",
  ]);
  let seenDone = false;
  let stdoutBuffer = "";
  let stderr = "";

  const closePromise = once(child, "close") as Promise<
    [number | null, NodeJS.Signals | null]
  >;
  const errorPromise = (async () => {
    const [error] = await once(child, "error");
    throw error instanceof Error ? error : new Error(String(error));
  })();
  const stderrDone = (async () => {
    for await (const chunk of child.stderr) {
      stderr += (chunk as Buffer).toString();
    }
  })();

  for await (const chunk of child.stdout) {
    stdoutBuffer += (chunk as Buffer).toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      console.log(`  ${line}`);
      if (line.includes("==> Done.")) {
        seenDone = true;
        child.kill();
        break;
      }
    }
    if (seenDone) {
      break;
    }
  }

  const [code, signal] = await Promise.race([closePromise, errorPromise]);
  await stderrDone;
  if (!seenDone) {
    const detail = stderr.trim() ? ` stderr: ${stderr.trim()}` : "";
    throw new Error(
      `Install log stream ended before completion marker. Exit code: ${code ?? "unknown"}, signal: ${signal ?? "none"}.${detail}`
    );
  }
}

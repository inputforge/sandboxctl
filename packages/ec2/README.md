# @inputforge/sandboxctl-ec2

sandboxctl VM provider backed by AWS EC2.

## Overview

This package implements the `VmProvider` interface using AWS EC2. It provisions an Ubuntu EC2 instance, configures SSH access, and runs the same cloud-init provisioning as the local QEMU provider — so the sandbox behaves identically regardless of where it runs.

## Requirements

- AWS credentials configured (`~/.aws/credentials`, environment variables, or IAM role)
- Permissions to create/terminate EC2 instances, manage key pairs, and describe SSM parameters

## Configuration

Set `provider: "ec2"` in `sandbox.json` and optionally tune EC2-specific settings:

```json
{
  "provider": "ec2",
  "ec2": {
    "region": "us-east-1",
    "instanceType": "t4g.medium",
    "arch": "arm64",
    "sshCidr": "0.0.0.0/0"
  }
}
```

| Field | Default | Description |
|---|---|---|
| `region` | `AWS_DEFAULT_REGION` / `us-east-1` | AWS region |
| `instanceType` | `t4g.medium` | EC2 instance type |
| `arch` | `arm64` | AMI architecture (`arm64` or `amd64`) |
| `sshCidr` | `0.0.0.0/0` | CIDR allowed for SSH ingress |

Ubuntu AMI IDs are resolved automatically via SSM Parameter Store (`/aws/service/canonical/...`).

## Usage

```ts
import { createEc2Provider } from "@inputforge/sandboxctl-ec2";

const provider = createEc2Provider();
```

## License

MIT

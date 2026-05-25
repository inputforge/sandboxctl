import { spawnSync } from 'child_process';
import { readState, readSandboxConfig } from '../lib/sandbox.js';
import { sandboxName } from '../lib/paths.js';

export async function forward(portArg: string | undefined): Promise<void> {
  const name = sandboxName();
  const state = readState(name);
  if (!state) {
    console.error(`Sandbox "${name}" is not running. Run: create-sandbox start`);
    process.exit(1);
  }

  if (!portArg) {
    const config = readSandboxConfig();
    const exposed = config.ports ?? [];
    if (exposed.length === 0) {
      console.error('No ports exposed in sandbox.json. Usage: create-sandbox forward <host-port>:<guest-port>');
    } else {
      console.error(`Exposed ports: ${exposed.map(f => `${f.guest}/${f.protocol ?? 'tcp'}`).join(', ')}`);
      console.error('Usage: create-sandbox forward <guest-port>  or  create-sandbox forward <host-port>:<guest-port>');
    }
    process.exit(1);
  }

  let hostPort: number;
  let guestPort: number;

  if (portArg.includes(':')) {
    const [h, g] = portArg.split(':');
    hostPort = parseInt(h, 10);
    guestPort = parseInt(g, 10);
  } else {
    guestPort = parseInt(portArg, 10);
    hostPort = guestPort;
  }

  if (isNaN(hostPort) || isNaN(guestPort) || hostPort < 1 || guestPort < 1) {
    console.error(`Invalid port specification: "${portArg}"`);
    process.exit(1);
  }

  console.log(`Forwarding localhost:${hostPort} → sandbox:${guestPort} (Ctrl+C to stop)`);

  spawnSync('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ExitOnForwardFailure=yes',
    '-N',
    '-L', `${hostPort}:localhost:${guestPort}`,
    '-p', String(state.port),
    'ubuntu@localhost',
  ], { stdio: 'inherit' });
}

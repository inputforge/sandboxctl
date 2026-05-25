#!/usr/bin/env node
import { parse } from '@bomb.sh/args';
import { init } from './commands/init.js';
import { start } from './commands/start.js';
import { stop } from './commands/stop.js';
import { destroy } from './commands/destroy.js';
import { status } from './commands/status.js';
import { ssh } from './commands/ssh.js';
import { send } from './commands/send.js';
import { receive } from './commands/receive.js';
import { forward } from './commands/forward.js';

const args = parse(process.argv.slice(2), {
  boolean: ['help'],
  alias: { h: 'help' },
});

const command = args._[0] as string | undefined;

if (args['help'] || !command) {
  console.log(`
create-sandbox — Linux VM sandbox manager

Usage:
  create-sandbox <command>

Commands:
  init              Configure sandbox.json interactively
  start             Build (if needed) and boot the sandbox VM
  stop              Gracefully shut down the VM
  destroy           Delete the VM and all associated files
  status            Show sandbox name, status, SSH port, and uptime
  ssh               Open an interactive SSH session into the VM
  send              Sync project files from host → VM
  receive           Sync files from VM → host
  forward [port]    Forward a port: <guest-port> or <host-port>:<guest-port>
`);
  process.exit(command ? 1 : 0);
}

const commands: Record<string, () => Promise<void>> = {
  init, start, stop, destroy, status, ssh, send, receive,
  forward: () => forward(args._[1] as string | undefined),
};

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command: "${command}". Run with --help for usage.`);
  process.exit(1);
}

handler().catch((err: unknown) => {
  console.error(String(err));
  process.exit(1);
});

#!/usr/bin/env node
import { parse } from "@bomb.sh/args";

import { destroy } from "./commands/destroy.js";
import { doctor } from "./commands/doctor.js";
import { forward } from "./commands/forward.js";
import { init } from "./commands/init.js";
import { receive } from "./commands/receive.js";
import { send } from "./commands/send.js";
import { ssh } from "./commands/ssh.js";
import { start } from "./commands/start.js";
import { status } from "./commands/status.js";
import { stop } from "./commands/stop.js";
import { wizard } from "./commands/wizard.js";

const args = parse(process.argv.slice(2), {
  alias: { h: "help" },
  boolean: ["help"],
});

const command = args._[0] as string | undefined;

if (args.help) {
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
  doctor            Check that required dependencies are installed
`);
  process.exit(0);
}

if (!command) {
  await wizard();
  process.exit(0);
}

const commands: Record<string, () => Promise<unknown>> = {
  destroy,
  doctor: () => Promise.resolve(doctor()),
  forward: () => Promise.resolve(forward(args._[1] as string | undefined)),
  init,
  receive,
  send,
  ssh,
  start,
  status,
  stop,
};

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command: "${command}". Run with --help for usage.`);
  process.exit(1);
}

try {
  const code = await handler();
  if (typeof code === "number" && code !== 0) {
    process.exit(code);
  }
} catch (error: unknown) {
  console.error(String(error));
  process.exit(1);
}

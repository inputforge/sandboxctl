/**
 * Filesystem example: read, write, list, and stream files over SFTP.
 *
 * Run with: npx tsx examples/filesystem.ts
 */

import { createReadStream } from "node:fs";

import { Sandbox } from "@inputforge/sandbox";
import { createVmmProvider } from "@inputforge/sandboxctl-vmm";

const sandbox = new Sandbox({
  config: {
    packages: {},
    ubuntu: "24.04",
    username: "ubuntu",
    vm: { cpus: 2, disk: "20G", memory: "2G" },
  },
  name: "example-filesystem",
  provider: createVmmProvider(),
});

await sandbox.start();

const { fs } = sandbox;

// Write a file
await fs.write("/home/ubuntu/hello.txt", Buffer.from("Hello from the host!\n"));

// Read it back
const content = await fs.read("/home/ubuntu/hello.txt");
console.log("Read:", content.toString());

// List a directory
const entries = await fs.readdir("/home/ubuntu");
console.log("Files in /home/ubuntu:", entries);

// Stat a file
const stats = await fs.stat("/home/ubuntu/hello.txt");
console.log("Size:", stats.size, "bytes");

// Upload a local file using a stream
const localStream = createReadStream("./package.json");
await fs.write("/home/ubuntu/package.json", localStream);
console.log("Uploaded package.json");

// Download a file using a stream — pipe to stdout
const remoteStream = await fs.createReadStream("/home/ubuntu/hello.txt");
process.stdout.write("Streaming: ");
remoteStream.pipe(process.stdout);
await new Promise<void>((resolve) => {
  remoteStream.on("end", resolve);
});

// Clean up
await fs.unlink("/home/ubuntu/hello.txt");
await fs.unlink("/home/ubuntu/package.json");

await sandbox.stop();

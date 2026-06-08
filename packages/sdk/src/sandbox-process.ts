import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Readable, Writable } from "node:stream";

import type { ClientChannel } from "ssh2";

interface SandboxProcessEvents {
  error: [error: Error];
  exit: [exitCode: number];
}

export class SandboxProcess extends EventEmitter<SandboxProcessEvents> {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly stdin: Writable;
  exitCode: number | null = null;

  private _channel: ClientChannel | null = null;

  constructor(starter: () => Promise<ClientChannel>) {
    super();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();

    this.stdout = stdout;
    this.stderr = stderr;
    this.stdin = stdin;

    void (async () => {
      try {
        const channel = await starter();
        this._channel = channel;
        stdin.pipe(channel);
        channel.pipe(stdout);
        channel.stderr.pipe(stderr);
        channel.on("close", (code: number | null) => {
          this.exitCode = code ?? 0;
          stdout.end();
          stderr.end();
          this.emit("exit", this.exitCode);
        });
        channel.on("error", (error: Error) => {
          this.emit("error", error);
        });
      } catch (error) {
        stdout.end();
        stderr.end();
        this.exitCode = 1;
        this.emit("exit", 1);
        // Defer to avoid unhandled exception when no listener is attached yet
        process.nextTick(() => {
          this.emit(
            "error",
            error instanceof Error ? error : new Error(String(error))
          );
        });
      }
    })();
  }

  kill(signal = "TERM"): void {
    this._channel?.signal(signal.replace(/^SIG/u, ""));
  }
}

import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import { promisify } from "node:util";

import type { SFTPWrapper, Stats } from "ssh2";

export class SandboxFs {
  private readonly _getSftp: () => Promise<SFTPWrapper>;

  constructor(getSftp: () => Promise<SFTPWrapper>) {
    this._getSftp = getSftp;
  }

  async read(path: string): Promise<Buffer> {
    const sftp = await this._getSftp();
    const chunks: Buffer[] = [];
    for await (const chunk of sftp.createReadStream(path)) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      }
    }
    return Buffer.concat(chunks);
  }

  async write(path: string, data: Buffer | Readable): Promise<void> {
    const sftp = await this._getSftp();
    const stream = sftp.createWriteStream(path);
    if (Buffer.isBuffer(data)) {
      stream.end(data);
    } else {
      data.pipe(stream);
    }
    await once(stream, "finish");
  }

  async readdir(path: string): Promise<string[]> {
    const sftp = await this._getSftp();
    const list = await promisify(sftp.readdir.bind(sftp))(path);
    return list.map((entry) => entry.filename);
  }

  async stat(path: string): Promise<Stats> {
    const sftp = await this._getSftp();
    return await promisify(sftp.stat.bind(sftp))(path);
  }

  async unlink(path: string): Promise<void> {
    const sftp = await this._getSftp();
    await promisify(sftp.unlink.bind(sftp))(path);
  }

  async mkdir(path: string): Promise<void> {
    const sftp = await this._getSftp();
    await promisify(sftp.mkdir.bind(sftp))(path);
  }

  async createReadStream(path: string): Promise<Readable> {
    const sftp = await this._getSftp();
    return sftp.createReadStream(path);
  }

  async createWriteStream(path: string): Promise<Writable> {
    const sftp = await this._getSftp();
    return sftp.createWriteStream(path);
  }

  async raw(): Promise<SFTPWrapper> {
    return await this._getSftp();
  }
}

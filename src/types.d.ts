declare module "@gcu/iso9660" {
  export class ISOWriter {
    constructor(opts: { volumeId?: string });
    add(path: string, content: Uint8Array | Buffer): void;
    toUint8Array(): Uint8Array;
  }
  // eslint-disable-next-line max-classes-per-file
  export class ISOReader {
    constructor(buf: ArrayBuffer);
    list(): Iterable<{ path: string; size: number }>;
  }
}

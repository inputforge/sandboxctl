import { writeFileSync } from "node:fs";

import { ISOWriter } from "@gcu/iso9660";

export function buildSeedImage(
  metaData: string,
  userData: string,
  destPath: string
): void {
  const writer = new ISOWriter({ volumeId: "cidata" });
  writer.add("/meta-data", Buffer.from(metaData, "utf-8"));
  writer.add("/user-data", Buffer.from(userData, "utf-8"));
  writeFileSync(destPath, Buffer.from(writer.toUint8Array()));
}

import { once } from "node:events";
import { createServer } from "node:net";

async function isPortFree(port: number): Promise<boolean> {
  const server = createServer();
  server.listen(port, "127.0.0.1");
  try {
    await once(server, "listening");
    server.close();
    return true;
  } catch {
    return false;
  }
}

export async function findFreePort(start = 2222, end = 2299): Promise<number> {
  for (let port = start; port <= end; port += 1) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(`No free port found in range ${start}–${end}`);
}

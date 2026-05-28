import { readGlobalConfig } from "../lib/global-config.js";
import { sandboxName } from "../lib/paths.js";
import { getPlatformConfig } from "../lib/platform.js";
import { getProvider } from "../lib/providers/index.js";
import { readSandboxConfig } from "../lib/sandbox.js";

export async function destroy(): Promise<void> {
  const name = sandboxName();
  const config = readSandboxConfig();
  const provider = getProvider(config, readGlobalConfig(), getPlatformConfig());
  await provider.destroy(name);
  console.log(`Sandbox "${name}" destroyed.`);
}

import { intro, outro } from "@clack/prompts";

import { getPlatformConfig } from "../lib/platform.js";
import type { VmProvider } from "../lib/providers/index.js";

async function loadAllProviders(): Promise<
  { name: string; provider: VmProvider }[]
> {
  const results: { name: string; provider: VmProvider }[] = [];

  try {
    const { createVmmProvider } = await import("@inputforge/sandboxctl-vmm");
    results.push({ name: "vmm", provider: createVmmProvider() });
  } catch {
    // optional package not installed
  }

  try {
    const { createQemuProvider, getPlatformConfig: getQemuPlatformConfig } =
      await import("@inputforge/sandboxctl-qemu");
    results.push({
      name: "qemu",
      provider: createQemuProvider(getQemuPlatformConfig()),
    });
  } catch {
    // optional package not installed
  }

  return results;
}

export async function doctor(): Promise<number> {
  const pc = getPlatformConfig();
  intro(`sandboxctl doctor — ${pc.platform} / ${pc.arch}`);

  const all = await loadAllProviders();
  const supported = all.filter(({ provider }) => provider.isSupported());

  let anyOk = false;

  for (const { name, provider } of supported) {
    const results = provider.reportPrereqs();
    if (results.length === 0) {
      continue;
    }
    const allOk = results.every((r) => r.ok);
    if (allOk) {
      anyOk = true;
    }
    console.log(`\n  ${name}:`);
    for (const r of results) {
      if (r.ok) {
        console.log(`    ✓  ${r.label}`);
      } else {
        console.log(`    ✗  ${r.label}  →  ${r.installCmd}`);
      }
    }
  }

  if (anyOk) {
    outro("Prerequisites satisfied.");
    return 0;
  }
  outro(
    "No provider prerequisites satisfied. Install one of the options above."
  );
  return 1;
}

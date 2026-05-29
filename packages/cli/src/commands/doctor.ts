import { intro, outro } from "@clack/prompts";

import { getPlatformConfig } from "../lib/platform.js";
import { reportPrerequisites } from "../lib/prereqs.js";

export function doctor(): number {
  const pc = getPlatformConfig();
  intro(`create-sandbox doctor — ${pc.platform} / ${pc.arch}`);

  const results = reportPrerequisites(pc);
  let allOk = true;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓  ${r.label}`);
    } else {
      console.log(`  ✗  ${r.label}  →  ${r.installCmd}`);
      allOk = false;
    }
  }

  if (allOk) {
    outro("All prerequisites satisfied.");
    return 0;
  }
  outro("Install missing prerequisites, then re-run.");
  return 1;
}

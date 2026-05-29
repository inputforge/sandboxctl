import { log, progress, spinner } from "@clack/prompts";
import type {
  ProgressHandle,
  ProviderReporter,
  SpinnerHandle,
} from "@inputforge/providers";

export function createReporter(): ProviderReporter {
  return {
    log(line: string) {
      log.message(line);
    },

    progress(label: string, total?: number): ProgressHandle {
      const bar = progress(total === undefined ? undefined : { max: total });
      bar.start(label);
      return {
        advance(delta: number, status?: string) {
          bar.advance(delta, status);
        },
        stop(message?: string) {
          bar.stop(message ?? label);
        },
      };
    },

    spin(label: string): SpinnerHandle {
      const s = spinner();
      s.start(label);
      return {
        stop(message?: string) {
          s.stop(message ?? label);
        },
        update(message: string) {
          s.message(message);
        },
      };
    },

    step(message: string) {
      log.step(message);
    },
  };
}

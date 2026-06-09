import { availableParallelism, cpus } from "node:os";

/** CPU cores available for parallel workers (respects cgroup/affinity limits when set). */
export function defaultWorkerConcurrency(): number {
  try {
    return Math.max(1, availableParallelism());
  } catch {
    return Math.max(1, cpus().length);
  }
}

import pLimit from "p-limit";

export interface TaskRow {
  key: string;
  status: string;
  archives_present: number;
  archives_downloaded: number;
  gaps: number;
  fallback_rows: number;
  gap_records: Record<string, unknown>[];
  exchange: string;
  instrument_type?: string;
  symbol_native?: string;
  interval?: string;
  error_reason?: string;
}

export interface ParallelRunState {
  stats: Record<string, number>;
  perExchange: Record<string, Record<string, number>>;
  gapRecords: Record<string, unknown>[];
  rows: TaskRow[];
  completed: number;
}

export function isSeriesFetchComplete(status: string): boolean {
  return status === "complete";
}

export async function runTasksParallel<T>(
  tasks: T[],
  workerFn: (task: T) => Promise<TaskRow>,
  opts: {
    workers: number;
    onProgress?: (done: number, total: number, task: T, row: TaskRow) => void;
  },
): Promise<ParallelRunState> {
  const state: ParallelRunState = {
    stats: {},
    perExchange: {},
    gapRecords: [],
    rows: [],
    completed: 0,
  };
  const total = tasks.length;
  if (total === 0) return state;

  const limit = pLimit(Math.max(1, Math.min(opts.workers, total)));
  const results = await Promise.all(
    tasks.map((task) => limit(() => workerFn(task))),
  );

  let done = 0;
  for (let i = 0; i < results.length; i++) {
    const row = results[i]!;
    const task = tasks[i]!;
    state.stats[row.status] = (state.stats[row.status] ?? 0) + 1;
    if (!state.perExchange[row.exchange]) state.perExchange[row.exchange] = {};
    state.perExchange[row.exchange]![row.status] =
      (state.perExchange[row.exchange]![row.status] ?? 0) + 1;
    state.gapRecords.push(...row.gap_records);
    state.rows.push(row);
    done += 1;
    if (opts.onProgress) opts.onProgress(done, total, task, row);
  }
  state.completed = done;
  return state;
}

import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { observePerformanceEvent } from './index.js';

let directory: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it('측정 모드가 꺼지면 기록하지 않고 켜진 세션에서 발생 시각과 기록 오버헤드를 분리한다', async () => {
  await mkdir('.workbench/fixtures', { recursive: true });
  directory = await mkdtemp(
    path.resolve('.workbench/fixtures/server-observer-'),
  );
  vi.stubEnv('CODOCS_PERFORMANCE_EVENTS_DIR', undefined);
  observePerformanceEvent('server-start');
  expect(await readdir(directory)).toEqual([]);
  vi.stubEnv('CODOCS_PERFORMANCE_EVENTS_DIR', directory);
  vi.stubEnv('CODOCS_PERFORMANCE_SESSION_ID', 'test/session');
  vi.stubEnv('CODOCS_PERFORMANCE_WINDOW_ID', 'window-1');
  observePerformanceEvent('server-start', { folder: directory });
  const event = JSON.parse(
    (
      await readFile(
        path.join(directory, `events-${process.pid}.jsonl`),
        'utf8',
      )
    ).trim(),
  ) as { occurred: { timeOrigin: number; monotonicMs: number } };
  const overhead = JSON.parse(
    (
      await readFile(
        path.join(directory, `observer-overhead-${process.pid}.jsonl`),
        'utf8',
      )
    ).trim(),
  ) as { primaryRecordOverheadMs: number };
  expect(event).toMatchObject({
    kind: 'server-start',
    sessionId: 'test/session',
    windowId: 'window-1',
    detail: { folder: directory },
    occurred: { pid: process.pid },
  });
  expect(
    event.occurred.timeOrigin + event.occurred.monotonicMs,
  ).toBeGreaterThan(0);
  expect(overhead.primaryRecordOverheadMs).toBeGreaterThanOrEqual(0);
});

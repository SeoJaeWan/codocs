import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseRunnerArgs,
  readPerformanceConfig,
  resolveStableVersion,
} from '../../../packages/vscode/test-runner/cli.mjs';
import {
  createCorpus,
  writeCorpus,
} from '../../../packages/vscode/src/integration/test-support/performance/corpus.mjs';
import {
  createPerformanceReport,
  recordPerformanceSample,
  persistPerformanceReport,
  reconcileInterruptedScenario,
} from './performance-report.mjs';

test('인자가 없으면 기존 기능 모드와 고정 버전을 선택한다', /** 기존 기본 호출을 보존한다. */ () => {
  assert.deepEqual(parseRunnerArgs([]), {
    mode: 'functional',
    version: '1.100.0',
    scenario: 'all',
    config: null,
    resolveVersion: null,
  });
});

test('성능 시나리오와 정확한 버전을 선택하고 잘못된 조합은 준비 전에 거부한다', /** 입력을 실제 실행 전에 검증한다. */ () => {
  assert.equal(
    parseRunnerArgs([
      '--mode',
      'performance',
      '--scenario',
      'save',
      '--vscode-version',
      '1.139.0',
    ]).scenario,
    'save',
  );
  assert.throws(() => parseRunnerArgs(['--scenario', 'save']), /성능 모드/);
  assert.throws(
    () => parseRunnerArgs(['--mode', 'performance', '--scenario', 'unknown']),
    /알 수 없는/,
  );
  assert.throws(
    () => parseRunnerArgs(['--vscode-version', 'latest']),
    /정확한/,
  );
  assert.throws(
    () => parseRunnerArgs(['--mode', 'performance', '--mode', 'functional']),
    /중복/,
  );
  assert.throws(
    () =>
      parseRunnerArgs(['--resolve-version', 'stable', '--mode', 'performance']),
    /단독/,
  );
});

test('공식 stable 응답이 정확한 버전 목록이면 한 버전만 반환한다', /** 공식 응답 형식을 대조한다. */ async () => {
  const version = await resolveStableVersion(
    /** 응답 순서와 선택 결과를 확인한다. */
    async (url) => {
      assert.match(url, /released=true/u);
      /** 공식 목록을 제공한다. */
      async function json() {
        return ['1.139.0', '1.138.1'];
      }
      return {
        ok: true,
        json,
      };
    },
  );
  assert.equal(version, '1.139.0');
});

test('생성한 천 문서는 배타적이고 파일과 기대 결과 및 요청 순서가 재현된다', /** 파일·기대값·해시를 독립 확인한다. */ async () => {
  const corpus = createCorpus();
  const again = createCorpus();
  assert.equal(corpus.sha256, again.sha256);
  assert.deepEqual(
    corpus.manifest.documents.reduce(
      /** 각 문서를 한 유형에만 센다. */
      (counts, doc) => {
        counts[doc.category] = (counts[doc.category] ?? 0) + 1;
        return counts;
      },
      {},
    ),
    { normal: 800, long: 100, references: 50, errors: 30, duplicate: 20 },
  );
  assert.equal(
    new Set(corpus.manifest.documents.map((doc) => doc.relative)).size,
    1000,
  );
  assert.equal(corpus.manifest.requests.length, 1000);
  assert.notDeepEqual(
    corpus.manifest.requests.map((request) => request.documentIndex),
    Array.from({ length: 1000 }, (_, i) => i),
  );
  const duplicateIds = corpus.manifest.documents
    .filter((doc) => doc.category === 'duplicate')
    .map((doc) => doc.id);
  assert.equal(new Set(duplicateIds).size, 10);
  for (const id of new Set(duplicateIds))
    assert.equal(
      duplicateIds.filter((candidate) => candidate === id).length,
      2,
    );
  for (const [relative, content] of Object.entries(corpus.files))
    assert.equal(
      corpus.manifest.fileHashes[relative],
      createHash('sha256').update(content).digest('hex'),
    );
  assert.equal(
    createCorpus({ ...corpus.manifest.settings, seed: 123 }).sha256 ===
      corpus.sha256,
    false,
  );
  const root = await mkdtemp(path.join(os.tmpdir(), 'codocs-corpus-'));
  try {
    await writeCorpus(root, corpus);
    const manifest = JSON.parse(
      await readFile(path.join(root, 'corpus-manifest.json'), 'utf8'),
    );
    assert.equal(manifest.sha256, corpus.sha256);
    await assert.rejects(writeCorpus(root, corpus), { code: 'EEXIST' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('취소와 실패는 완료 시간을 꾸미지 않고 JSON과 한국어 부분 보고서에 보존한다', /** 종료 전 부분 표본을 검사한다. */ async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codocs-report-'));
  try {
    const report = createPerformanceReport({
      runId: 'test',
      version: '1.139.0',
      settings: { targets: { api: 2 } },
      command: 'pnpm test:vscode -- --mode performance',
    });
    recordPerformanceSample(report, 'api', {
      status: 'completed',
      durationMs: 42,
      requestId: 'a',
    });
    recordPerformanceSample(report, 'api', {
      status: 'cancelled',
      requestId: 'b',
    });
    recordPerformanceSample(report, 'api', {
      status: 'incorrect',
      durationMs: 77,
      requestId: 'c',
    });
    assert.throws(
      /** 실패 요청의 가짜 완료 시간을 거부한다. */
      () =>
        recordPerformanceSample(report, 'api', {
          status: 'failed',
          durationMs: 5,
        }),
      /완료 시간/,
    );
    assert.equal(report.scenarios.api.missing, 1);
    await persistPerformanceReport(report, root);
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'performance.json'), 'utf8'))
        .scenarios.api.cancelled,
      1,
    );
    assert.match(
      await readFile(path.join(root, 'performance.md'), 'utf8'),
      /IDE 성능 측정 보고서/u,
    );
    assert.match(
      await readFile(path.join(root, 'performance.md'), 'utf8'),
      /\| api \| 3 \| 1 \| 1 \| 0 \| 1 \| 0 \| 1 \| 42 \| 42 \| 42 \|/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('대기 중 자식 종료와 취소는 마지막 진행과 미완료 표본을 보존한다', /** 관측 경과를 성공 지연으로 해석하지 않는다. */ () => {
  const progress = {
    scenario: 'api',
    state: 'running',
    phase: 'performance-api',
    startedAt: '2026-09-24T00:00:00.000Z',
    observedAt: '2026-09-24T00:00:05.000Z',
    elapsedMs: 5000,
  };
  for (const cancelled of [false, true]) {
    const report = createPerformanceReport({
      runId: 'interrupted',
      version: '1.100.0',
      settings: { targets: { api: 2 } },
    });
    reconcileInterruptedScenario(report, progress, cancelled, 'child exit');
    assert.equal(report.progress, progress);
    assert.equal(report.scenarios.api.attempted, 1);
    assert.equal(
      report.scenarios.api[cancelled ? 'cancelled' : 'incomplete'],
      1,
    );
    assert.equal(report.scenarios.api.samples[0].durationMs, undefined);
    assert.equal(
      report.scenarios.api.samples[0].elapsedAtLastObservationMs,
      5000,
    );
  }
});

test('조회 간격 변경에 근거가 없으면 설정 파일을 거부한다', /** 실제 설정 파일 검증을 확인한다. */ async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codocs-config-'));
  const config = path.join(root, 'config.json');
  try {
    await writeFile(config, JSON.stringify({ propagationPollMs: 25 }));
    await assert.rejects(readPerformanceConfig(config), /changeReason/u);
    await writeFile(
      config,
      JSON.stringify({ propagationPollMs: 25, changeReason: '장비 관측' }),
    );
    assert.equal((await readPerformanceConfig(config)).propagationPollMs, 25);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const exec = promisify(execFile);
const fixtureParent = path.resolve(
  fileURLToPath(new URL('../../.workbench/fixtures', import.meta.url)),
);
const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));

/** 완료·실패·중단된 Hover 보고서의 한국어 설명을 확인한다. */
async function verifyKoreanReports() {
  await mkdir(fixtureParent, { recursive: true });
  const directory = await mkdtemp(
    path.join(fixtureParent, 'codocs-hover-report-'),
  );
  try {
    for (const status of ['completed', 'partial', 'interrupted']) {
      const reportPath = path.join(directory, `${status}.json`);
      const report = {
        status,
        vscode: { version: '1.136.1' },
        fixture: {
          seed: 16018,
          projectDocumentCount: 1_000,
          queryableDocumentCount: 980,
        },
        artifacts: { sourceCommit: 'candidate', vsixSha256: 'abc' },
        environment: {
          runnerNode: process.version,
          platform: process.platform,
          release: 'test',
          architecture: process.arch,
        },
        performance: {
          passed: status === 'completed',
          progressIntegrity: status === 'partial' ? 'corrupt' : 'complete',
          warmupRuns: 100,
          queryRuns: 1_000,
          readiness: [{ durationMilliseconds: 12_000, success: true }],
          warmups: [{ durationMilliseconds: 11_600, success: true }],
          samples:
            status === 'completed'
              ? [{ durationMilliseconds: 11_800, success: true }]
              : [],
          accuracyFailureCount: status === 'partial' ? 1 : 0,
          p95Milliseconds: status === 'completed' ? 11_800 : null,
          targetMilliseconds: 100,
          eventLoopDelay: {
            phases: {
              'before-readiness': { count: 0, p95Milliseconds: null },
              'after-readiness': { count: 12, p95Milliseconds: 12.5 },
              'after-warmup': { count: 15, p95Milliseconds: 14.5 },
            },
          },
          pending:
            status === 'partial'
              ? {
                  phase: 'performance:measured-request-start',
                  elapsedWaitingMs: 5_000,
                }
              : null,
          failure:
            status === 'partial'
              ? 'Hover 내용 불일치'
              : status === 'interrupted'
                ? 'SIGINT'
                : null,
        },
      };
      await writeFile(reportPath, `${JSON.stringify(report)}\n`);
      await exec(process.execPath, [
        runner,
        '--render-existing-performance',
        reportPath,
      ]);
      const markdown = await readFile(
        path.join(directory, `${status}.md`),
        'utf8',
      );
      assert.match(markdown, /COD-16 실제 VS Code Hover 성능 관찰 보고서/u);
      assert.match(markdown, /첫 워밍업 요청: 11600\.000 ms/u);
      assert.match(markdown, /준비 전 이벤트 루프 표본 0회·p95: 미측정 ms/u);
      assert.match(
        markdown,
        /워밍업 후 이벤트 루프 표본 15회·p95: 14\.500 ms/u,
      );
      if (status === 'partial') {
        assert.match(markdown, /부분 완료/u);
        assert.match(markdown, /정확성: 실패/u);
        assert.match(markdown, /오류 이유: Hover 내용 불일치/u);
        assert.match(markdown, /현재 대기 요청: 본 측정/u);
        assert.match(markdown, /진행 기록 무결성: 손상된 중간 기록 있음/u);
      } else if (status === 'interrupted') {
        assert.match(markdown, /실행 상태: 중단됨/u);
        assert.match(markdown, /정확성: 미확인/u);
        assert.match(
          markdown,
          /오류 이유: 사용자 SIGINT 신호로 측정을 중단했습니다/u,
        );
      } else {
        assert.match(markdown, /실행 상태: 완료/u);
        assert.match(markdown, /정확성: 통과/u);
      }
    }
    const crashPath = path.join(directory, 'child-crash.json');
    await writeFile(
      crashPath,
      JSON.stringify({
        status: 'partial',
        performance: {
          warmupRuns: 100,
          queryRuns: 1_000,
          failure: 'VS Code exited with null (SIGKILL)\nRAW INTERNAL LOG',
        },
      }),
    );
    await exec(process.execPath, [
      runner,
      '--render-existing-performance',
      crashPath,
    ]);
    const crashMarkdown = await readFile(
      path.join(directory, 'child-crash.md'),
      'utf8',
    );
    assert.match(
      crashMarkdown,
      /VS Code 자식 프로세스가 SIGKILL 신호로 비정상 종료/u,
    );
    assert.doesNotMatch(crashMarkdown, /RAW INTERNAL LOG/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  '완료·실패·중단된 Hover 보고서를 한국어로 렌더링한다',
  verifyKoreanReports,
);

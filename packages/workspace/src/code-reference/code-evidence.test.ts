import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalog,
  extractCodeReferences,
  parseYaml,
  scanStatuses,
} from '@codocs/core';
import { createFakeCodeWatch } from '../test-support/code-watch.js';
import {
  WorkspaceCodeReferenceIndex,
  codeCollectionStatuses,
  codeFileReasons,
  collectWorkspaceCodeEvidence,
  projectWorkspaceCodeDiagnostics,
} from './index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

let project: string;
const indexes: WorkspaceCodeReferenceIndex[] = [];
const targetPath = '.codocs/target.yaml';
const targetText =
  '_codocs:\n  id: target\n  name: 대상\ndefinition: 본문\n업무: 값\n';

beforeEach(async () => {
  project = await mkdtemp(path.join(tmpdir(), 'codocs-evidence-'));
  vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(project));
  await mkdir(path.join(project, '.codocs'));
  await writeFile(path.join(project, targetPath), targetText);
});

afterEach(async () => {
  await Promise.all(indexes.splice(0).map((index) => index.close()));
  vi.unstubAllEnvs();
  await rmWithRetry(project, { recursive: true, force: true });
});

describe('collectWorkspaceCodeEvidence: 디스크 원문의 쓰기 보호 근거', () => {
  it('적격 코드 파일의 저장 원문과 표기를 새로 읽어 complete로 돌려준다', async () => {
    await writeFile(
      path.join(project, 'source.ts'),
      '// @codocs [[대상:업무]]',
    );
    const evidence = await collectWorkspaceCodeEvidence(project);
    expect(evidence).toMatchObject({ complete: true, failures: [] });
    expect(
      evidence.files.find((file) => file.path === 'source.ts'),
    ).toMatchObject({
      text: '// @codocs [[대상:업무]]',
      markers: [{ name: '대상', section: '업무' }],
    });
  });

  it('호출할 때마다 디스크를 다시 읽어 직전에 바뀐 원문을 반영한다', async () => {
    const source = path.join(project, 'source.ts');
    await writeFile(source, '// 참조 없음');
    const before = await collectWorkspaceCodeEvidence(project);
    await writeFile(source, '// @codocs [[대상:업무]] 그리고 더 긴 원문');
    const after = await collectWorkspaceCodeEvidence(project);
    expect(
      before.files.find((file) => file.path === 'source.ts')?.markers,
    ).toHaveLength(0);
    expect(
      after.files.find((file) => file.path === 'source.ts')?.markers,
    ).toHaveLength(1);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    '읽지 못한 파일이 있으면 complete가 아니며 실패 경로를 알려준다',
    async () => {
      const source = path.join(project, 'locked.ts');
      await writeFile(source, '// @codocs [[대상:업무]]');
      await chmod(source, 0o000);
      try {
        const evidence = await collectWorkspaceCodeEvidence(project);
        expect(evidence.complete).toBe(false);
        expect(evidence.failures).toEqual([
          expect.objectContaining({
            path: 'locked.ts',
            reason: codeFileReasons.read,
          }),
        ]);
      } finally {
        await chmod(source, 0o600);
      }
    },
  );
});

describe('WorkspaceCodeReferenceIndex.settledDiskObservation: 대기 변경을 반영한 저장 원문', () => {
  it('감시 신호가 아직 지연 중이어도 바뀐 파일을 바로 다시 읽어 반영한다', async () => {
    const watch = createFakeCodeWatch();
    const source = path.join(project, 'source.ts');
    await writeFile(source, '// 참조 없음');
    const index = new WorkspaceCodeReferenceIndex(project, {
      createWatcher: watch.createWatcher,
      schedule: watch.schedule,
    });
    indexes.push(index);
    await index.ready();
    await writeFile(source, '// @codocs [[대상:업무]] 바뀐 원문');
    watch.connections[0]?.changed([source]);
    const observation = await index.settledDiskObservation();
    expect(observation.complete).toBe(true);
    expect(
      observation.files.find((file) => file.path === 'source.ts')?.markers,
    ).toHaveLength(1);
  });

  it('IDE 편집 buffer는 저장 원문 관측에 섞지 않는다', async () => {
    const watch = createFakeCodeWatch();
    await writeFile(path.join(project, 'source.ts'), '// 참조 없음');
    const index = new WorkspaceCodeReferenceIndex(project, {
      createWatcher: watch.createWatcher,
      schedule: watch.schedule,
    });
    indexes.push(index);
    await index.ready();
    await index.updateBuffer({
      sourcePath: 'source.ts',
      text: '// @codocs [[대상:업무]]',
      documentVersion: 1,
    });
    const observation = await index.settledDiskObservation();
    expect(
      observation.files.find((file) => file.path === 'source.ts')?.markers,
    ).toHaveLength(0);
  });

  it('감시 연결이 깨져 복구 전이면 완전한 관측으로 돌려주지 않는다', async () => {
    const watch = createFakeCodeWatch();
    await writeFile(path.join(project, 'source.ts'), '// 참조 없음');
    const index = new WorkspaceCodeReferenceIndex(project, {
      createWatcher: watch.createWatcher,
      schedule: watch.schedule,
    });
    indexes.push(index);
    await index.ready();
    watch.behavior.failRegistrations = 1;
    watch.connections[0]?.failed(new Error('감시 손상'));
    const observation = await index.settledDiskObservation();
    expect(observation).toMatchObject({
      complete: false,
      status: codeCollectionStatuses.incomplete,
    });
  });
});

describe('projectWorkspaceCodeDiagnostics: 코드 표기의 확정 오류 투영', () => {
  const catalog = buildCatalog({
    status: scanStatuses.complete,
    observations: [{ path: targetPath, parsed: parseYaml(targetText) }],
  });

  it.each([
    ['@codocs [[없는 문서]]', 'codocs.codeReference.missing', 'error'],
    [
      '@codocs [[대상:없는 섹션]]',
      'codocs.codeReference.missing_section',
      'error',
    ],
    ['@codocs [[대상', 'codocs.codeReference.invalid', 'error'],
  ])(
    '%s는 %s 진단을 코드 경로와 표기 위치로 만든다',
    (text, code, severity) => {
      const file = {
        path: 'source.ts',
        text,
        revision: 'r',
        markers: extractCodeReferences(text),
      };
      const diagnostics = projectWorkspaceCodeDiagnostics(catalog, [file]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        code,
        severity,
        path: 'source.ts',
      });
      expect(diagnostics[0]?.range).toEqual(file.markers[0]?.range);
    },
  );

  it('문서를 지정하면 그 문서가 해석 후보인 표기의 진단만 돌려준다', () => {
    const files = [
      {
        path: 'related.ts',
        text: '@codocs [[대상:없는 섹션]]',
        revision: 'r',
        markers: extractCodeReferences('@codocs [[대상:없는 섹션]]'),
      },
      {
        path: 'unrelated.ts',
        text: '@codocs [[없는 문서]]',
        revision: 'r',
        markers: extractCodeReferences('@codocs [[없는 문서]]'),
      },
    ];
    const diagnostics = projectWorkspaceCodeDiagnostics(
      catalog,
      files,
      targetPath,
    );
    expect(diagnostics.map((item) => item.path)).toEqual(['related.ts']);
  });
});

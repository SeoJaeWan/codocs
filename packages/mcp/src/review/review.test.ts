import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  queryDiagnosticCodes,
  reviewDiagnosticCodes,
  type ReviewFinding,
} from '@codocs/core';
import type { WorkspaceQuerySession } from '@codocs/workspace';
import { afterEach, describe, expect, it } from 'vitest';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';
import { createCodocsQueryHandlers } from '../query/index.js';
import { createStartupSession } from '../server/index.js';
import {
  createCodocsWriteReviewer,
  defaultReviewModel,
  loadReviewSettings,
  reviewSystemPrompt,
  type ReviewModelProvider,
  type ReviewModelRequest,
} from './index.js';

/** 사례마다 연 세션과 임시 프로젝트를 정리한다. */
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** 이 테스트의 기본 문서다. 커밋 규칙과 배포 문서가 있다. */
const baseFiles = {
  '.codocs/git.yaml':
    '_codocs:\n  id: git\n  name: Git 규칙\n커밋: |\n  - 커밋 작성자는 저장소 주인 계정으로 하고 AI가 만든 커밋도 같다.\n',
  '.codocs/deploy.yaml':
    '_codocs:\n  id: deploy\n  name: 배포\nCI: |\n  - 작업은 매시 17분(UTC)에 돈다. 실패하면 다음 시각에 다시 돈다.\n',
};

/** 임시 프로젝트에 파일을 쓰고 실제 세션을 연다. */
async function openProject(
  files: Record<string, string>,
): Promise<{ project: string; session: WorkspaceQuerySession }> {
  await mkdir('.workbench', { recursive: true });
  const project = await mkdtemp(path.resolve('.workbench/review-'));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, name)), { recursive: true });
    await writeFile(path.join(project, name), text);
  }
  const session = createStartupSession({ cwd: project, project: '.' });
  cleanups.push(async () => {
    await session.close();
    await rmWithRetry(project, { recursive: true, force: true });
  });
  return { project, session };
}

/** 받은 요청을 기록하고 정한 답을 돌려주는 가짜 제공자다. Error를 돌려주면 그 오류를 던진다. */
function fakeProvider(
  answer: (request: ReviewModelRequest) => ReviewFinding[] | Error,
): { provider: ReviewModelProvider; calls: ReviewModelRequest[] } {
  const calls: ReviewModelRequest[] = [];
  return {
    calls,
    provider: {
      findOverlaps(request) {
        calls.push(request);
        const result = answer(request);
        return result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result);
      },
    },
  };
}

/** 키가 있는 환경이다. */
const keyEnv = { CODOCS_REVIEW_API_KEY: 'test-key' };

/** 커밋 규칙을 옮겨 적은 새 문서를 만드는 요청이다. */
function createCopy(sentence: string): Record<string, unknown> {
  return {
    mode: 'create',
    path: '.codocs/ci.yaml',
    document: { _codocs: { id: 'ci', name: 'CI 안내' }, 규칙: sentence },
  };
}

/** 모델이 커밋 규칙과 겹친다고 답하는 항목이다. */
function commitFinding(newQuote: string): ReviewFinding {
  return {
    candidate: 'Git 규칙:커밋',
    newQuote,
    candidateQuote:
      '커밋 작성자는 저장소 주인 계정으로 하고 AI가 만든 커밋도 같다.',
  };
}

/** 파일이 있는지 확인한다. */
async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

describe('createCodocsWriteReviewer: 키가 없을 때', () => {
  it('환경 변수에 키가 없으면 탐지를 만들지 않는다', () => {
    expect(createCodocsWriteReviewer({ env: {} })).toBeUndefined();
  });

  it('탐지 없이 만든 codocs_write는 reviewToken 입력을 invalid_input으로 거부한다', async () => {
    const { session } = await openProject(baseFiles);
    const handlers = createCodocsQueryHandlers(session);
    const result = await handlers.codocsWrite({
      ...createCopy('새 문장이다.'),
      reviewToken: 'x',
    });
    expect(result.success).toBe(false);
    expect('error' in result && result.error.code).toBe(
      queryDiagnosticCodes.invalidInput,
    );
  });

  it('탐지 없이 저장한 결과에는 탐지 관련 필드가 없다', async () => {
    const { session } = await openProject(baseFiles);
    const handlers = createCodocsQueryHandlers(session);
    const result = await handlers.codocsWrite(
      createCopy('커밋 작성자는 저장소 주인 계정으로 한다.'),
    );
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('overlaps');
    expect(result).not.toHaveProperty('reviewToken');
  });
});

describe('codocs_write 저장 전 중복 탐지', () => {
  it('새 문장이 다른 문서와 겹치고 방향을 모르면 저장하지 않고 겹치는 문장 쌍과 확인 값을 돌려준다', async () => {
    const { project, session } = await openProject(baseFiles);
    const fake = fakeProvider(() => [
      commitFinding('커밋 작성자는 저장소 주인 계정으로 한다.'),
    ]);
    const handlers = createCodocsQueryHandlers(session, {
      reviewer: createCodocsWriteReviewer({
        env: keyEnv,
        createProvider: () => fake.provider,
        readConfig: () => Promise.resolve(undefined),
      })!,
    });
    const result = await handlers.codocsWrite(
      createCopy('커밋 작성자는 저장소 주인 계정으로 한다.'),
    );
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      error: { code: reviewDiagnosticCodes.duplicateContent },
      overlaps: [
        {
          section: 'CI 안내:규칙',
          sentence: '커밋 작성자는 저장소 주인 계정으로 한다.',
          address: 'Git 규칙:커밋',
          matchedSentence:
            '커밋 작성자는 저장소 주인 계정으로 하고 AI가 만든 커밋도 같다.',
        },
      ],
    });
    expect(result).toHaveProperty('reviewToken');
    expect(
      (result as unknown as { overlaps: object[] }).overlaps[0],
    ).not.toHaveProperty('copiedBy');
    expect(await exists(path.join(project, '.codocs/ci.yaml'))).toBe(false);
  });

  it('모델에는 프로토타입의 판정 기준과 기본 모델, 새 문장과 후보 섹션을 보낸다', async () => {
    const { session } = await openProject(baseFiles);
    const fake = fakeProvider(() => []);
    const handlers = createCodocsQueryHandlers(session, {
      reviewer: createCodocsWriteReviewer({
        env: keyEnv,
        createProvider: () => fake.provider,
        readConfig: () => Promise.resolve(undefined),
      })!,
    });
    await handlers.codocsWrite(
      createCopy('커밋 작성자는 저장소 주인 계정으로 한다.'),
    );
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      model: defaultReviewModel,
      system: reviewSystemPrompt,
    });
    expect(fake.calls[0]?.addresses).toContain('Git 규칙:커밋');
    expect(fake.calls[0]?.prompt).toContain(
      '# 새로 쓴 글\n들어갈 곳: CI 안내:규칙\n\n커밋 작성자는 저장소 주인 계정으로 한다.',
    );
    expect(fake.calls[0]?.prompt).toContain('## Git 규칙:커밋');
  });

  it('겹침이 없으면 지금과 같은 결과로 저장한다', async () => {
    const { project, session } = await openProject(baseFiles);
    const fake = fakeProvider(() => []);
    const handlers = createCodocsQueryHandlers(session, {
      reviewer: createCodocsWriteReviewer({
        env: keyEnv,
        createProvider: () => fake.provider,
        readConfig: () => Promise.resolve(undefined),
      })!,
    });
    const result = await handlers.codocsWrite(
      createCopy('커밋 작성자는 저장소 주인 계정으로 한다.'),
    );
    expect(result).toMatchObject({ success: true, saved: true });
    expect(result).not.toHaveProperty('overlaps');
    expect(await exists(path.join(project, '.codocs/ci.yaml'))).toBe(true);
  });

  describe('링크로 정한 방향에 따른 처리', () => {
    it('새 문장만 상대 문서를 가리키면 저장하지 않고 copiedBy new로 알린다', async () => {
      const { session } = await openProject(baseFiles);
      const sentence = '커밋 작성자는 저장소 주인 계정으로 한다([[Git 규칙]]).';
      const fake = fakeProvider(() => [commitFinding(sentence)]);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const result = await handlers.codocsWrite(createCopy(sentence));
      expect(result).toMatchObject({
        success: false,
        overlaps: [{ copiedBy: 'new' }],
      });
    });

    it('상대 문서만 이 문서를 가리키면 저장하고 copiedBy existing으로 알린다', async () => {
      const { project, session } = await openProject({
        ...baseFiles,
        '.codocs/git.yaml':
          '_codocs:\n  id: git\n  name: Git 규칙\n커밋: |\n  - 커밋 작성자는 저장소 주인 계정으로 하고 AI가 만든 커밋도 같다([[CI 안내]]).\n',
      });
      const sentence = '커밋 작성자는 저장소 주인 계정으로 한다.';
      const fake = fakeProvider(() => [commitFinding(sentence)]);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const result = await handlers.codocsWrite(createCopy(sentence));
      expect(result).toMatchObject({
        success: true,
        saved: true,
        overlaps: [{ address: 'Git 규칙:커밋', copiedBy: 'existing' }],
      });
      expect(result).not.toHaveProperty('reviewToken');
      expect(await exists(path.join(project, '.codocs/ci.yaml'))).toBe(true);
    });
  });

  describe('새 문장이 없는 요청은 모델을 부르지 않음', () => {
    it.each([
      [
        '문장을 조금 고친 edit',
        { edit: [{ section: 'CI', old: '다시 돈다', new: '다시 실행된다' }] },
      ],
      ['섹션을 지우는 unset', { unset: ['참고'] }],
      ['섹션 순서만 바꾸는 position', { position: { 참고: { before: 'CI' } } }],
    ])('%s 요청은 모델을 부르지 않고 저장한다', async (_, change) => {
      const { session } = await openProject({
        ...baseFiles,
        '.codocs/deploy.yaml':
          '_codocs:\n  id: deploy\n  name: 배포\nCI: |\n  - 작업은 매시 17분(UTC)에 돈다. 실패하면 다음 시각에 다시 돈다.\n참고: |\n  - 배포 기록은 남긴다.\n',
      });
      const fake = fakeProvider(() => []);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const got = await handlers.codocsGet({ addresses: ['배포'] });
      const revision = (got as unknown as { results: { revision: string }[] })
        .results[0]!.revision;
      const result = await handlers.codocsWrite({
        mode: 'update',
        id: 'deploy',
        revision,
        ...change,
      });
      expect(result).toMatchObject({ success: true, saved: true });
      expect(fake.calls).toHaveLength(0);
    });

    it('기존 줄 끝에 덧붙인 문장은 새 문장으로 보내 탐지한다', async () => {
      const { session } = await openProject(baseFiles);
      const fake = fakeProvider(() => []);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const got = await handlers.codocsGet({ addresses: ['배포'] });
      const revision = (got as unknown as { results: { revision: string }[] })
        .results[0]!.revision;
      await handlers.codocsWrite({
        mode: 'update',
        id: 'deploy',
        revision,
        edit: [
          {
            section: 'CI',
            old: '다시 돈다.',
            new: '다시 돈다. 커밋 작성자는 저장소 주인 계정으로 한다.',
          },
        ],
      });
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.prompt).toContain(
        '들어갈 곳: 배포:CI\n\n커밋 작성자는 저장소 주인 계정으로 한다.',
      );
    });
  });

  describe('확인 값', () => {
    it('막힌 요청에 받은 확인 값을 붙여 같은 내용을 다시 보내면 모델을 부르지 않고 저장한다', async () => {
      const { project, session } = await openProject(baseFiles);
      const request = createCopy('커밋 작성자는 저장소 주인 계정으로 한다.');
      const fake = fakeProvider(() => [
        commitFinding('커밋 작성자는 저장소 주인 계정으로 한다.'),
      ]);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const blocked = await handlers.codocsWrite(request);
      const reviewToken = (blocked as { reviewToken: string }).reviewToken;
      const saved = await handlers.codocsWrite({ ...request, reviewToken });
      expect(saved).toMatchObject({ success: true, saved: true });
      expect(fake.calls).toHaveLength(1);
      expect(await exists(path.join(project, '.codocs/ci.yaml'))).toBe(true);
    });

    it('내용을 바꾼 요청에 이전 확인 값을 붙이면 인정하지 않고 다시 탐지한다', async () => {
      const { project, session } = await openProject(baseFiles);
      const fake = fakeProvider(() => [
        commitFinding('커밋 작성자는 저장소 주인 계정으로 한다.'),
      ]);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const blocked = await handlers.codocsWrite(
        createCopy('커밋 작성자는 저장소 주인 계정으로 한다.'),
      );
      const reviewToken = (blocked as { reviewToken: string }).reviewToken;
      const again = await handlers.codocsWrite({
        ...createCopy('커밋 작성자는 언제나 저장소 주인 계정으로 한다.'),
        reviewToken,
      });
      expect(again).toMatchObject({ success: false, saved: false });
      expect(fake.calls).toHaveLength(2);
      expect(await exists(path.join(project, '.codocs/ci.yaml'))).toBe(false);
    });

    it('서버가 만들지 않은 확인 값은 인정하지 않고 다시 탐지한다', async () => {
      const { session } = await openProject(baseFiles);
      const fake = fakeProvider(() => [
        commitFinding('커밋 작성자는 저장소 주인 계정으로 한다.'),
      ]);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const result = await handlers.codocsWrite({
        ...createCopy('커밋 작성자는 저장소 주인 계정으로 한다.'),
        reviewToken: 'made-up-token',
      });
      expect(result).toMatchObject({ success: false, saved: false });
      expect(fake.calls).toHaveLength(1);
    });

    it('다른 탐지(서버 재시작)가 만든 확인 값은 인정하지 않는다', async () => {
      const { session } = await openProject(baseFiles);
      const request = createCopy('커밋 작성자는 저장소 주인 계정으로 한다.');
      const fake = fakeProvider(() => [
        commitFinding('커밋 작성자는 저장소 주인 계정으로 한다.'),
      ]);
      const before = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const blocked = await before.codocsWrite(request);
      const reviewToken = (blocked as { reviewToken: string }).reviewToken;
      const restarted = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const result = await restarted.codocsWrite({ ...request, reviewToken });
      expect(result).toMatchObject({ success: false, saved: false });
      expect(fake.calls).toHaveLength(2);
    });
  });

  describe('여러 문서를 한 번에 바꾸는 요청', () => {
    it('changes의 항목 하나가 막히면 아무것도 저장하지 않고 겹침에 항목 순번을 담는다', async () => {
      const { project, session } = await openProject(baseFiles);
      const fake = fakeProvider((request) =>
        request.prompt.includes('들어갈 곳: CI 안내:규칙')
          ? [commitFinding('커밋 작성자는 저장소 주인 계정으로 한다.')]
          : [],
      );
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const result = await handlers.codocsWrite({
        changes: [
          {
            mode: 'create',
            path: '.codocs/other.yaml',
            document: {
              _codocs: { id: 'other', name: '다른 문서' },
              개요: '휴지통 비우기는 확인 상자를 띄운다.',
            },
          },
          createCopy('커밋 작성자는 저장소 주인 계정으로 한다.'),
        ],
      });
      expect(result).toMatchObject({
        success: false,
        saved: false,
        changes: [],
        error: { code: reviewDiagnosticCodes.duplicateContent },
        overlaps: [{ index: 1, section: 'CI 안내:규칙' }],
      });
      expect(await exists(path.join(project, '.codocs/other.yaml'))).toBe(
        false,
      );
      expect(await exists(path.join(project, '.codocs/ci.yaml'))).toBe(false);
    });
  });

  describe('제외 경로', () => {
    it('제외 경로의 문서는 후보로 보내지 않는다', async () => {
      const { session } = await openProject({
        ...baseFiles,
        '.codocs/discussions/d1.yaml':
          '_codocs:\n  id: d1\n  name: 논의 1\n결정: |\n  - 커밋 작성자는 저장소 주인 계정으로 한다.\n',
      });
      const fake = fakeProvider(() => []);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () =>
            Promise.resolve(
              'review:\n  exclude:\n    - .codocs/discussions/\n',
            ),
        })!,
      });
      await handlers.codocsWrite(
        createCopy('커밋 작성자는 저장소 주인 계정으로 한다.'),
      );
      expect(fake.calls[0]?.addresses).not.toContain('논의 1:결정');
    });

    it('제외 경로의 문서에 쓰는 글은 탐지하지 않는다', async () => {
      const { session } = await openProject(baseFiles);
      const fake = fakeProvider(() => []);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () =>
            Promise.resolve(
              'review:\n  exclude:\n    - .codocs/discussions/\n',
            ),
        })!,
      });
      const result = await handlers.codocsWrite({
        mode: 'create',
        path: '.codocs/discussions/d2.yaml',
        document: {
          _codocs: { id: 'd2', name: '논의 2' },
          결정: '커밋 작성자는 저장소 주인 계정으로 한다.',
        },
      });
      expect(result).toMatchObject({ success: true, saved: true });
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe('탐지하지 못했을 때', () => {
    it('모델 호출이 실패하면 저장하고 review_failed 경고로 알린다', async () => {
      const { project, session } = await openProject(baseFiles);
      const fake = fakeProvider(() => new Error('시간 초과'));
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const result = await handlers.codocsWrite(
        createCopy('커밋 작성자는 저장소 주인 계정으로 한다.'),
      );
      expect(result).toMatchObject({
        success: true,
        saved: true,
        warnings: [
          {
            code: reviewDiagnosticCodes.reviewFailed,
            severity: 'warning',
            suggestion: '시간 초과',
            path: '.codocs/ci.yaml',
          },
        ],
      });
      expect(await exists(path.join(project, '.codocs/ci.yaml'))).toBe(true);
    });

    it('설정 파일이 잘못되면 모델을 부르지 않고 저장하며 review_failed 경고로 원인을 알린다', async () => {
      const { project, session } = await openProject(baseFiles);
      const fake = fakeProvider(() => []);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve('review:\n  unknown: 1\n'),
        })!,
      });
      const result = await handlers.codocsWrite(
        createCopy('커밋 작성자는 저장소 주인 계정으로 한다.'),
      );
      expect(result).toMatchObject({
        success: true,
        saved: true,
        warnings: [{ code: reviewDiagnosticCodes.reviewFailed }],
      });
      expect(fake.calls).toHaveLength(0);
      expect(await exists(path.join(project, '.codocs/ci.yaml'))).toBe(true);
    });
  });

  describe('기존 검증에 걸리는 요청', () => {
    it.each([
      [
        '이미 있는 이름으로 만드는 요청',
        {
          mode: 'create',
          path: '.codocs/ci.yaml',
          document: {
            _codocs: { id: 'ci', name: '배포' },
            규칙: '커밋 작성자는 저장소 주인 계정으로 한다.',
          },
        },
      ],
      [
        'revision이 다른 수정 요청',
        {
          mode: 'update',
          id: 'deploy',
          revision: 'stale',
          set: { 규칙: '커밋 작성자는 저장소 주인 계정으로 한다.' },
        },
      ],
    ])('%s은 모델을 부르지 않고 기존처럼 실패한다', async (_, request) => {
      const { session } = await openProject(baseFiles);
      const fake = fakeProvider(() => []);
      const handlers = createCodocsQueryHandlers(session, {
        reviewer: createCodocsWriteReviewer({
          env: keyEnv,
          createProvider: () => fake.provider,
          readConfig: () => Promise.resolve(undefined),
        })!,
      });
      const result = await handlers.codocsWrite(request);
      expect(result.success).toBe(false);
      expect('error' in result && result.error.code).not.toBe(
        reviewDiagnosticCodes.duplicateContent,
      );
      expect(fake.calls).toHaveLength(0);
    });
  });
});

describe('loadReviewSettings: 설정 읽기', () => {
  it('파일과 환경 변수가 없으면 기본값을 쓴다', async () => {
    expect(
      await loadReviewSettings({}, '/p', () => Promise.resolve(undefined)),
    ).toEqual({
      success: true,
      settings: {
        provider: 'anthropic',
        model: defaultReviewModel,
        exclude: [],
      },
    });
  });

  it('파일의 값을 쓰고 환경 변수가 있으면 환경 변수 값이 대신한다', async () => {
    const file =
      'review:\n  model: file-model\n  exclude:\n    - .codocs/a/\n    - .codocs/b/\n';
    const env = {
      CODOCS_REVIEW_MODEL: 'env-model',
      CODOCS_REVIEW_EXCLUDE: ' .codocs/c/ , .codocs/d/ ',
    };
    expect(
      await loadReviewSettings(env, '/p', () => Promise.resolve(file)),
    ).toEqual({
      success: true,
      settings: {
        provider: 'anthropic',
        model: 'env-model',
        exclude: ['.codocs/c/', '.codocs/d/'],
      },
    });
  });

  it('파일만 있으면 파일의 제외 경로를 쓴다', async () => {
    const file = 'review:\n  exclude:\n    - .codocs/a/\n';
    const result = await loadReviewSettings({}, '/p', () =>
      Promise.resolve(file),
    );
    expect(result.success && result.settings.exclude).toEqual(['.codocs/a/']);
  });

  it.each([
    ['YAML로 해석할 수 없는 파일', 'review: [', 'YAML로 해석하지 못했습니다'],
    ['모르는 항목', 'review:\n  unknown: 1\n', 'unknown'],
    ['파일에 넣은 API 키', 'review:\n  apiKey: x\n', 'CODOCS_REVIEW_API_KEY'],
    ['지원하지 않는 제공자', 'review:\n  provider: other\n', 'review.provider'],
  ])('%s은 실패하고 원인을 알린다', async (_, file, cause) => {
    const result = await loadReviewSettings({}, '/p', () =>
      Promise.resolve(file),
    );
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toContain(cause);
  });

  it('환경 변수의 제공자가 지원하지 않는 값이면 실패한다', async () => {
    const result = await loadReviewSettings(
      { CODOCS_REVIEW_PROVIDER: 'other' },
      '/p',
      () => Promise.resolve(undefined),
    );
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toContain(
      'CODOCS_REVIEW_PROVIDER',
    );
  });
});

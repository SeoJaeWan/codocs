import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCodocsGuideHandler, guideTopics } from './index.js';

const assets = pathToFileURL(path.resolve('docs/guide') + path.sep);

describe('createCodocsGuideHandler', () => {
  it('주제를 생략하면 overview 원문과 여섯 주제를 반환한다', async () => {
    const guide = createCodocsGuideHandler(assets);
    const result = await guide();
    expect(result).toEqual({
      success: true,
      topic: 'overview',
      topics: [
        'overview',
        'schema',
        'writing',
        'examples',
        'updating',
        'validation',
      ],
      content: await readFile(new URL('README.md', assets), 'utf8'),
    });
  });

  it.each([
    [guideTopics.overview, 'README.md'],
    [guideTopics.schema, 'schema.md'],
    [guideTopics.writing, 'writing.md'],
    [guideTopics.examples, 'examples.md'],
    [guideTopics.updating, 'updating.md'],
    [guideTopics.validation, 'validation.md'],
  ] as const)(
    '%s를 요청하면 %s 원문을 그대로 반환한다',
    async (topic, file) => {
      const guide = createCodocsGuideHandler(assets);
      const result = await guide({ topic });
      expect(result).toMatchObject({
        success: true,
        topic,
        content: await readFile(new URL(file, assets), 'utf8'),
      });
    },
  );

  it.each([
    null,
    undefined,
    { topic: 'missing' },
    { topic: 'schema', extra: true },
  ])('%j 입력은 위치 없는 invalid_input으로 거부한다', async (input) => {
    const result = await createCodocsGuideHandler(assets)(input);
    expect(result).toEqual({
      success: false,
      error: {
        code: 'invalid_input',
        severity: 'error',
        message: '조회 입력이 올바르지 않습니다.',
      },
    });
  });

  it('배포 원문 파일이 없으면 파일 접근 실패를 반환한다', async () => {
    await mkdir('.workbench', { recursive: true });
    const directory = await mkdtemp(path.resolve('.workbench/guide-missing-'));
    try {
      const result = await createCodocsGuideHandler(
        pathToFileURL(directory + path.sep),
      )({});
      expect(result).toEqual({
        success: false,
        error: {
          code: 'file_access_failed',
          severity: 'error',
          message:
            '배포된 가이드 원문을 읽을 수 없습니다. 패키지 설치 상태를 확인하세요.',
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

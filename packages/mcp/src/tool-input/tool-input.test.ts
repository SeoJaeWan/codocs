import { describe, expect, it } from 'vitest';
import {
  acceptsToolInput,
  codocsInputSchemas,
  codocsJsonInputSchema,
  parseDuplicatesInput,
  parseGetInput,
  parseRenameInput,
  parseValidateInput,
} from './index.js';

describe('MCP 여덟 입력 계약', () => {
  it('여덟 스키마를 정의하고 알 수 없는 최상위 속성을 거부한다', () => {
    expect([...codocsInputSchemas.keys()]).toEqual([
      'codocs_list',
      'codocs_get',
      'codocs_refresh',
      'codocs_validate',
      'codocs_guide',
      'codocs_write',
      'codocs_rename',
      'codocs_duplicates',
    ]);
    for (const name of codocsInputSchemas.keys())
      expect(codocsJsonInputSchema(name)).toBeTruthy();
    expect(acceptsToolInput('codocs_list', { limit: 1 })).toBe(false);
    expect(acceptsToolInput('codocs_refresh', { extra: true })).toBe(false);
    expect(
      acceptsToolInput('codocs_validate', {
        path: '.codocs/a.yaml',
        extra: true,
      }),
    ).toBe(false);
    expect(acceptsToolInput('codocs_guide', { topic: 'wrong' })).toBe(false);
    expect(
      acceptsToolInput('codocs_write', {
        mode: 'create',
        path: 'a.yaml',
        document: {},
        extra: true,
      }),
    ).toBe(false);
  });

  it('중복 검토 입력은 draft를 write 입력으로 풀고 draft와 cursor의 동시 지정을 거부한다', () => {
    const draft = {
      mode: 'update',
      id: 'sample',
      revision: 'r1',
      set: { definition: '본문' },
    };
    expect(parseDuplicatesInput({})).toEqual({});
    expect(parseDuplicatesInput({ cursor: 'abc' })).toEqual({ cursor: 'abc' });
    expect(parseDuplicatesInput({ draft })).toEqual(draft);
    expect(parseDuplicatesInput({ draft, cursor: 'abc' })).toBeUndefined();
    expect(parseDuplicatesInput({ extra: 1 })).toBeUndefined();
    expect(parseDuplicatesInput({ draft: { mode: 'other' } })).toBeUndefined();
    expect(acceptsToolInput('codocs_duplicates', { draft, cursor: 'a' })).toBe(
      false,
    );
    expect(acceptsToolInput('codocs_duplicates', { cursor: 1 })).toBe(false);
  });

  it('ID는 중복 제거 후 상한을 검사하며 사용자 속성은 삭제하지 않는다', () => {
    expect(parseGetInput({ ids: [] })).toBeUndefined();
    expect(
      parseGetInput({
        ids: Array.from({ length: 21 }, (_, index) => `id-${index}`),
      }),
    ).toBeUndefined();
    expect(parseGetInput({ ids: Array(21).fill('same') })).toEqual({
      ids: ['same'],
    });
    const document = {
      id: 'sample',
      name: 'Sample',
      domains: ['test'],
      definition: '본문',
      custom: { nested: [1, true, null] },
    };
    const create = { mode: 'create', path: '.codocs/sample.yaml', document };
    expect(acceptsToolInput('codocs_write', create)).toBe(true);
    const parsed = codocsInputSchemas.get('codocs_write')!.parse(create);
    expect(parsed).toEqual(create);
    const update = {
      mode: 'update',
      id: 'sample',
      revision: 'revision',
      set: { custom: { nested: 'new' } },
    };
    expect(acceptsToolInput('codocs_write', update)).toBe(true);
    expect(codocsInputSchemas.get('codocs_write')!.parse(update)).toEqual(
      update,
    );
  });

  it('검증 입력은 선택 문자열 하나만 허용하고 복수 경로는 거부한다', () => {
    expect(parseValidateInput({})).toEqual({});
    expect(parseValidateInput({ path: '.codocs/a.yaml' })).toEqual({
      path: '.codocs/a.yaml',
    });
    expect(
      parseValidateInput({ path: ['.codocs/a.yaml', '.codocs/b.yaml'] }),
    ).toBeUndefined();
    expect(parseValidateInput({ path: null })).toBeUndefined();
  });

  it.each([
    ['알 수 없는 속성', { mode: 'preview', id: 'a', newName: 'b', extra: 1 }],
    [
      'updateReferences',
      { mode: 'preview', id: 'a', newName: 'b', updateReferences: false },
    ],
    ['revisions가 없는 apply', { mode: 'apply', id: 'a', newName: 'b' }],
    [
      'preview의 revisions',
      { mode: 'preview', id: 'a', newName: 'b', revisions: {} },
    ],
    [
      '문자열이 아닌 revision',
      { mode: 'apply', id: 'a', newName: 'b', revisions: { 'a.yaml': 1 } },
    ],
    [
      '알 수 없는 선택 속성',
      {
        mode: 'preview',
        id: 'a',
        newName: 'b',
        selections: [
          { sourcePath: 's', occurrenceIndex: 0, targetPath: 't', extra: 1 },
        ],
      },
    ],
    ['알 수 없는 mode', { mode: 'other', id: 'a', newName: 'b' }],
    ['빈 section', { mode: 'preview', id: 'a', section: '', newName: 'b' }],
    [
      '문자열이 아닌 section',
      { mode: 'preview', id: 'a', section: 1, newName: 'b' },
    ],
    [
      'section이 있어도 알 수 없는 속성',
      { mode: 'preview', id: 'a', section: 's', newName: 'b', extra: 1 },
    ],
  ])('이름 변경 입력은 %s이면 거부한다', (_, input) => {
    expect(parseRenameInput(input)).toBeUndefined();
  });

  it('이름 변경 입력은 preview와 apply의 선택·revisions를 그대로 보존한다', () => {
    const selections = [
      { sourcePath: 's.yaml', occurrenceIndex: 1, targetPath: 't.yaml' },
    ];
    const preview = { mode: 'preview', id: 'a', newName: 'b', selections };
    const apply = { ...preview, mode: 'apply', revisions: { 's.yaml': 'r' } };
    expect(parseRenameInput(preview)).toEqual(preview);
    expect(parseRenameInput(apply)).toEqual(apply);
  });

  it('이름 변경 입력은 선택 필드 section을 preview와 apply에서 그대로 보존한다', () => {
    const preview = { mode: 'preview', id: 'a', section: 's', newName: 'b' };
    const apply = { ...preview, mode: 'apply', revisions: { 's.yaml': 'r' } };
    expect(parseRenameInput(preview)).toEqual(preview);
    expect(parseRenameInput(apply)).toEqual(apply);
    expect(
      parseRenameInput({ mode: 'preview', id: 'a', newName: 'b' }),
    ).not.toHaveProperty('section');
  });
});

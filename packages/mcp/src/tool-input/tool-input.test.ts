import { describe, expect, it } from 'vitest';
import {
  acceptsToolInput,
  codocsInputSchemas,
  codocsJsonInputSchema,
  parseWriteInput,
  parseGetInput,
  parseListInput,
  parseRenameInput,
  parseValidateInput,
} from './index.js';

describe('MCP 일곱 입력 계약', () => {
  it('일곱 스키마를 정의하고 알 수 없는 최상위 속성을 거부한다', () => {
    expect([...codocsInputSchemas.keys()]).toEqual([
      'codocs_list',
      'codocs_get',
      'codocs_refresh',
      'codocs_validate',
      'codocs_guide',
      'codocs_write',
      'codocs_rename',
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

  it('write replace는 id·revision·document만 받고 set·unset 혼합과 알 수 없는 속성을 거부한다', () => {
    const replace = {
      mode: 'replace',
      id: 'sample',
      revision: 'r1',
      document: { _codocs: { id: 'sample', name: '샘플' }, definition: '본문' },
    };
    expect(parseWriteInput(replace)).toEqual(replace);
    expect(parseWriteInput({ ...replace, set: { a: 1 } })).toBeUndefined();
    expect(parseWriteInput({ ...replace, unset: ['a'] })).toBeUndefined();
    expect(parseWriteInput({ ...replace, extra: 1 })).toBeUndefined();
    expect(
      parseWriteInput({ ...replace, document: undefined }),
    ).toBeUndefined();
    expect(parseWriteInput({ ...replace, document: [] })).toBeUndefined();
    expect(parseWriteInput({ ...replace, revision: 1 })).toBeUndefined();
    expect(
      parseWriteInput({ mode: 'update', id: 'a', revision: 'r', document: {} }),
    ).toBeUndefined();
    expect(acceptsToolInput('codocs_write', replace)).toBe(true);
    expect(
      acceptsToolInput('codocs_write', { ...replace, set: { a: 1 } }),
    ).toBe(false);
  });

  it('중단한 codocs_duplicates 이름은 입력 계약에 남지 않는다', () => {
    expect(codocsInputSchemas.has('codocs_duplicates' as never)).toBe(false);
  });

  it('list 입력은 parent 하나만 허용하고 cursor와 필터는 거부한다', () => {
    expect(parseListInput({})).toEqual({});
    expect(parseListInput({ parent: '개발' })).toEqual({ parent: '개발' });
    expect(parseListInput({ cursor: 'x' })).toBeUndefined();
    expect(parseListInput({ kind: 'policy' })).toBeUndefined();
    expect(parseListInput({ parent: 1 })).toBeUndefined();
    expect(parseListInput({ parent: ['개발'] })).toBeUndefined();
  });

  it('get 입력은 addresses를 중복 제거 후 상한까지 검사하되 주소 문법은 거부하지 않는다', () => {
    expect(parseGetInput({ addresses: [] })).toBeUndefined();
    expect(
      parseGetInput({
        addresses: Array.from({ length: 21 }, (_, index) => `문서 ${index}`),
      }),
    ).toBeUndefined();
    expect(parseGetInput({ addresses: Array(21).fill('same') })).toEqual({
      addresses: ['same'],
    });
    expect(parseGetInput({ addresses: ['', 'a:b:c', '[[x]]'] })).toEqual({
      addresses: ['', 'a:b:c', '[[x]]'],
    });
    expect(parseGetInput({ ids: ['sample'] })).toBeUndefined();
    expect(parseGetInput({ addresses: ['a'], extra: 1 })).toBeUndefined();
    expect(parseGetInput({ addresses: [1] })).toBeUndefined();
  });

  it('write 입력은 사용자 속성을 삭제하지 않는다', () => {
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

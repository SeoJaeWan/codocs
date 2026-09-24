import { describe, expect, it } from 'vitest';
import {
  acceptsToolInput,
  codocsInputSchemas,
  codocsJsonInputSchema,
  parseGetInput,
  parseValidateInput,
} from './index.js';

describe('MCP 여섯 입력 계약', () => {
  it('여섯 스키마를 정의하고 알 수 없는 최상위 속성을 거부한다', () => {
    expect([...codocsInputSchemas.keys()]).toEqual([
      'codocs_list',
      'codocs_get',
      'codocs_refresh',
      'codocs_validate',
      'codocs_guide',
      'codocs_write',
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
});

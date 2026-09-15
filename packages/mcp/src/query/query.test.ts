import { queryDiagnosticCodes, queryDiagnosticMessages } from '@codocs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodocsQueryHandlers } from './index.js';

const backend = vi.hoisted(
  /** 각 handler 호출과 전달 인수를 독립적으로 기록한다. */ () => ({
    list: vi.fn(),
    get: vi.fn(),
    refresh: vi.fn(),
  }),
);

vi.mock(
  '@codocs/workspace',
  /** 실제 IO 대신 workspace 공개 결과 경계를 제어한다. */ () => ({
    /** 같은 조회 backend를 반환한다. */
    createWorkspaceQuerySession: () => backend,
  }),
);

beforeEach(
  /** 각 사례의 호출과 응답 계획을 초기화한다. */ () => {
    vi.clearAllMocks();
  },
);

/** 공통 입력 오류 응답을 만든다. */
function invalidInput() {
  return {
    success: false as const,
    scanStatus: 'failed' as const,
    error: {
      code: queryDiagnosticCodes.invalidInput,
      severity: 'error' as const,
      message: queryDiagnosticMessages.invalidInput,
    },
  };
}

describe('MCP 직접 조회 handler', /** unknown 검증과 workspace 공통 envelope 전달을 검증한다. */ () => {
  it('complete에서 정상·없음과 정상·충돌을 항목별 결과로 유지한다', /** 한 ID의 문제가 다른 결과나 최상위 성공을 바꾸지 않는지 확인한다. */ async () => {
    const normal = {
      id: 'normal',
      found: true as const,
      conflict: false as const,
      source: { path: '.codocs/normal.yaml' },
      confirmation: 'confirmed' as const,
      document: { id: 'normal', definition: '본문' },
      revision: 'revision',
      references: ['target'],
      referencedBy: ['source'],
      diagnostics: [],
    };
    backend.get
      .mockResolvedValueOnce({
        success: true,
        scanStatus: 'complete',
        results: [
          normal,
          {
            id: 'missing',
            found: false,
            diagnostics: [
              {
                code: queryDiagnosticCodes.notFound,
                severity: 'error',
                message: queryDiagnosticMessages.notFound,
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        scanStatus: 'complete',
        results: [
          {
            id: 'shared',
            found: true,
            conflict: true,
            paths: ['.codocs/a.yaml', '.codocs/z.yaml'],
            diagnostics: [],
          },
          normal,
        ],
      });
    const handlers = createCodocsQueryHandlers();
    const mixed = await handlers.codocsGet({
      ids: ['normal', 'missing'],
    });
    expect(mixed).toMatchObject({
      success: true,
      scanStatus: 'complete',
    });
    if (!mixed.success) throw new Error('상세 조회 실패');
    expect(mixed.results).toEqual([
      normal,
      expect.objectContaining({ id: 'missing', found: false }),
    ]);
    const conflict = await handlers.codocsGet({
      ids: ['shared', 'normal'],
    });
    if (!conflict.success) throw new Error('충돌 조회 실패');
    expect(conflict.results[0]).toMatchObject({
      found: true,
      conflict: true,
      paths: ['.codocs/a.yaml', '.codocs/z.yaml'],
    });
    for (const field of ['document', 'rawYaml', 'revision'])
      expect(conflict.results[0]).not.toHaveProperty(field);
    expect(conflict.results[1]).toBe(normal);
  });

  it('partial 미확인과 failed 비노출 envelope를 그대로 전달한다', /** workspace가 판정한 확인 상태와 필드 부재를 바꾸지 않는다. */ async () => {
    backend.get
      .mockResolvedValueOnce({
        success: true,
        scanStatus: 'partial',
        results: [
          {
            id: 'alpha',
            found: true,
            conflict: false,
            source: { path: '.codocs/alpha.yaml' },
            confirmation: 'unconfirmed',
            document: { id: 'alpha', definition: '이전' },
            revision: 'previous',
            references: [],
            referencedBy: [],
            diagnostics: [],
          },
          {
            id: 'outside',
            found: false,
            confirmation: 'unconfirmed',
            diagnostics: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        success: false,
        scanStatus: 'failed',
        error: {
          code: 'workspace_read_failed',
          severity: 'error',
          message: '작업 경로를 읽을 수 없습니다.',
        },
      });
    const handlers = createCodocsQueryHandlers();
    const partial = await handlers.codocsGet({
      ids: ['alpha', 'outside'],
    });
    expect(partial).toMatchObject({ success: true, scanStatus: 'partial' });
    if (!partial.success) throw new Error('부분 조회 실패');
    expect(partial.results[0]).toMatchObject({
      found: true,
      confirmation: 'unconfirmed',
      revision: 'previous',
      document: { definition: '이전' },
    });
    expect(partial.results[1]).toEqual({
      id: 'outside',
      found: false,
      confirmation: 'unconfirmed',
      diagnostics: [],
    });
    const failed = await handlers.codocsGet({ ids: ['alpha'] });
    expect(failed).toMatchObject({ success: false, scanStatus: 'failed' });
    expect(failed).not.toHaveProperty('results');
  });

  it('알 수 없는 속성·getter·잘못된 열거와 get 배열 전체를 실행 전에 거부한다', /** own data property가 아닌 입력에서 backend 호출이 없는지 확인한다. */ async () => {
    const handlers = createCodocsQueryHandlers();
    let reads = 0;
    const getter = {};
    Object.defineProperty(getter, 'ids', {
      enumerable: true,
      /** 접근자 입력이 실행되면 실패를 드러낸다. */
      get: () => {
        reads++;
        return ['alpha'];
      },
    });
    const sparse = Array(1) as string[];
    const revoked = Proxy.revocable({ ids: ['alpha'] }, {});
    revoked.revoke();
    const badInputs: readonly [string, unknown][] = [
      ['list unknown', { limit: 10 }],
      ['list enum', { kind: 'knowledge' }],
      ['list explicit undefined', { status: undefined }],
      ['get getter', getter],
      ['get revoked proxy', revoked.proxy],
      ['get empty', { ids: [] }],
      ['get sparse', { ids: sparse }],
      ['get unknown', { ids: ['alpha'], extra: true }],
      [
        'get 21 unique',
        {
          ids: Array.from(
            { length: 21 },
            /** 서로 다른 ID를 만든다. */ (_, index) => `id-${index}`,
          ),
        },
      ],
    ];
    for (const [name, input] of badInputs) {
      const result = name.startsWith('list')
        ? await handlers.codocsList(input)
        : await handlers.codocsGet(input);
      expect(result, name).toEqual(invalidInput());
    }
    expect(reads).toBe(0);
    expect(backend.list).not.toHaveBeenCalled();
    expect(backend.get).not.toHaveBeenCalled();
    backend.get.mockResolvedValue({
      success: true,
      scanStatus: 'complete',
      results: [{ id: 'same', found: false, diagnostics: [] }],
    });
    expect(
      await handlers.codocsGet({ ids: Array(21).fill('same') }),
    ).toMatchObject({ success: true, results: [{ id: 'same' }] });
    expect(backend.get).toHaveBeenCalledWith(['same']);
  });

  it('목록 필터와 cursor를 복사하고 모든 cursor 판정을 공통 envelope로 보존한다', /** 정상·불일치·변조·snapshot·refresh·재시작 결과를 변형하지 않는다. */ async () => {
    const first = {
      success: true,
      scanStatus: 'complete',
      items: [],
      totalCount: 51,
      returnedCount: 50,
      nextCursor: 'cursor',
    };
    const expired = {
      success: false,
      scanStatus: 'complete',
      error: {
        code: 'cursor_expired',
        severity: 'error',
        message: '목록 커서가 만료되었습니다.',
      },
    };
    backend.list
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...first, returnedCount: 1 })
      .mockResolvedValueOnce(invalidInput())
      .mockResolvedValue(expired);
    backend.refresh.mockResolvedValue({
      success: true,
      scanStatus: 'complete',
    });
    const handlers = createCodocsQueryHandlers();
    expect(
      await handlers.codocsList({
        domain: '업무',
        kind: 'policy',
        status: 'confirmed',
      }),
    ).toBe(first);
    expect(await handlers.codocsList({ cursor: 'cursor' })).toMatchObject({
      success: true,
    });
    expect(
      await handlers.codocsList({ cursor: 'cursor', domain: '다른 업무' }),
    ).toEqual(invalidInput());
    for (const cursor of [
      'tampered',
      'changed-snapshot',
      'after-refresh',
      'other-process',
    ])
      expect(await handlers.codocsList({ cursor })).toBe(expired);
    await expect(handlers.refresh()).resolves.toEqual({
      success: true,
      scanStatus: 'complete',
    });
    expect(backend.list).toHaveBeenNthCalledWith(1, {
      domain: '업무',
      kind: 'policy',
      status: 'confirmed',
    });
  });

  it('큰 document·rawYaml과 20개 결과를 절단 없이 직렬화한다', /** handler가 크기 제한이나 서버 진단을 덧붙이지 않는지 확인한다. */ async () => {
    const large = '가'.repeat(200_000);
    const results = [
      {
        id: 'json',
        found: true,
        conflict: false,
        source: { path: '.codocs/json.yaml' },
        confirmation: 'confirmed',
        document: { id: 'json', definition: large },
        revision: 'json-revision',
        references: ['raw'],
        referencedBy: [],
        diagnostics: [],
      },
      {
        id: 'raw',
        found: true,
        conflict: false,
        source: { path: '.codocs/raw.yaml' },
        confirmation: 'confirmed',
        rawYaml: `${large}\nvalue: .nan\n`,
        revision: 'raw-revision',
        references: [],
        referencedBy: ['json'],
        diagnostics: [],
      },
      ...Array.from(
        { length: 18 },
        /** 남은 정상 결과를 만든다. */ (_, index) => ({
          id: `small-${index}`,
          found: false,
          diagnostics: [],
        }),
      ),
    ];
    const response = {
      success: true,
      scanStatus: 'complete',
      results,
    };
    backend.get.mockResolvedValue(response);
    const handlers = createCodocsQueryHandlers();
    const ids = results.map(
      /** 결과 순서와 같은 요청 ID를 만든다. */ (result) => result.id,
    );
    const returned = await handlers.codocsGet({ ids });
    expect(returned).toBe(response);
    const serialized = JSON.stringify(returned);
    expect(serialized).toContain(large);
    expect(serialized).not.toContain('response_too_large');
    expect(serialized).not.toContain('truncated');
  });
});

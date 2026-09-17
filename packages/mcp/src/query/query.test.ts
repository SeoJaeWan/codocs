/* eslint-disable codocs/korean-jsdoc -- Vitest의 인라인 콜백은 선언 함수가 아니다. */
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

describe('createCodocsQueryHandlers: MCP 조회 응답 전달과 입력 검증', () => {
  describe('상세 조회 응답 전달', () => {
    it('유효한 ID 하나를 조회하면 작업 공간의 문서 응답을 그대로 반환한다', async () => {
      const response = {
        success: true,
        scanStatus: 'complete',
        results: [
          {
            id: 'normal',
            found: true,
            conflict: false,
            source: { path: '.codocs/normal.yaml' },
            confirmation: 'confirmed',
            document: { id: 'normal' },
            references: [],
            referencedBy: [],
            diagnostics: [],
          },
        ],
      };
      backend.get.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers();
      const input = { ids: ['normal'] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      expect(backend.get).toHaveBeenCalledWith(input.ids);
    });

    it('정상 문서와 없는 ID를 함께 조회하면 항목별 결과를 그대로 반환한다', async () => {
      const normal = {
        id: 'normal',
        found: true,
        conflict: false,
        source: { path: '.codocs/normal.yaml' },
        confirmation: 'confirmed',
        document: { id: 'normal', definition: '본문' },
        revision: 'revision',
        references: ['target'],
        referencedBy: ['source'],
        diagnostics: [],
      };
      const response = {
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
      };
      backend.get.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers();
      const input = { ids: ['normal', 'missing'] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      expect(backend.get).toHaveBeenCalledWith(input.ids);
    });

    it('중복 ID와 정상 문서를 함께 조회하면 충돌 결과의 금지 필드를 덧붙이지 않는다', async () => {
      const response = {
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
          {
            id: 'normal',
            found: true,
            conflict: false,
            source: { path: '.codocs/normal.yaml' },
            confirmation: 'confirmed',
            document: { id: 'normal' },
            references: [],
            referencedBy: [],
            diagnostics: [],
          },
        ],
      };
      backend.get.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers();
      const input = { ids: ['shared', 'normal'] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      if (!result.success) return;
      expect(result.results[0]).not.toHaveProperty('document');
      expect(result.results[0]).not.toHaveProperty('rawYaml');
      expect(result.results[0]).not.toHaveProperty('revision');
    });

    it('부분 스캔의 미확인 조회 결과를 받으면 확인 상태를 그대로 전달한다', async () => {
      const response = {
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
      };
      backend.get.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers();
      const input = { ids: ['alpha', 'outside'] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      expect(backend.get).toHaveBeenCalledWith(input.ids);
    });

    it('작업 공간 조회가 실패하면 문서 결과를 만들지 않고 실패 응답을 전달한다', async () => {
      const response = {
        success: false,
        scanStatus: 'failed',
        error: {
          code: 'workspace_read_failed',
          severity: 'error',
          message: '작업 경로를 읽을 수 없습니다.',
        },
      };
      backend.get.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers();
      const input = { ids: ['alpha'] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      expect(result).not.toHaveProperty('results');
    });
  });

  describe('요청 입력 검증과 backend 호출 방지', () => {
    it.each([
      { name: '알 수 없는 목록 속성', method: 'list', input: { limit: 10 } },
      { name: '잘못된 종류 값', method: 'list', input: { kind: 'knowledge' } },
      {
        name: '명시적 undefined 상태',
        method: 'list',
        input: { status: undefined },
      },
      { name: '빈 ID 목록', method: 'get', input: { ids: [] } },
      { name: '희소 ID 배열', method: 'get', input: { ids: Array(1) } },
      {
        name: '알 수 없는 상세 속성',
        method: 'get',
        input: { ids: ['alpha'], extra: true },
      },
      {
        name: '21개 고유 ID',
        method: 'get',
        input: {
          ids: Array.from({ length: 21 }, (_, index) => 'id-' + index),
        },
      },
    ])(
      '$name을 전달하면 입력 오류를 반환하고 backend를 호출하지 않는다',
      async ({ method, input }) => {
        const handlers = createCodocsQueryHandlers();

        const result =
          method === 'list'
            ? await handlers.codocsList(input)
            : await handlers.codocsGet(input);

        expect(result).toEqual(invalidInput());
        expect(backend.list).not.toHaveBeenCalled();
        expect(backend.get).not.toHaveBeenCalled();
      },
    );

    it('ID 속성이 접근자이면 접근자를 실행하지 않고 입력 오류를 반환한다', async () => {
      const handlers = createCodocsQueryHandlers();
      let reads = 0;
      const input = Object.defineProperty({}, 'ids', {
        enumerable: true,
        /** 접근자 실행 여부를 관찰한다. */
        get: () => {
          reads++;
          return ['alpha'];
        },
      });

      const result = await handlers.codocsGet(input);

      expect(result).toEqual(invalidInput());
      expect(reads).toBe(0);
      expect(backend.get).not.toHaveBeenCalled();
    });

    it('회수된 Proxy를 전달하면 입력 오류를 반환하고 backend를 호출하지 않는다', async () => {
      const handlers = createCodocsQueryHandlers();
      const revoked = Proxy.revocable({ ids: ['alpha'] }, {});
      revoked.revoke();

      const result = await handlers.codocsGet(revoked.proxy);

      expect(result).toEqual(invalidInput());
      expect(backend.get).not.toHaveBeenCalled();
    });

    it('같은 ID 21개를 전달하면 중복 제거한 한 ID로 backend를 호출한다', async () => {
      const response = {
        success: true,
        scanStatus: 'complete',
        results: [{ id: 'same', found: false, diagnostics: [] }],
      };
      backend.get.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers();
      const input = { ids: Array(21).fill('same') as string[] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      expect(backend.get).toHaveBeenCalledWith(['same']);
    });
  });

  describe('목록 조건과 cursor 응답 전달', () => {
    it('목록 필터를 전달하면 backend에 같은 조건을 보내고 응답을 반환한다', async () => {
      const response = {
        success: true,
        scanStatus: 'complete',
        items: [],
        totalCount: 51,
        returnedCount: 50,
        nextCursor: 'cursor',
      };
      backend.list.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers();
      const input = { domain: '업무', kind: 'policy', status: 'confirmed' };

      const result = await handlers.codocsList(input);

      expect(result).toBe(response);
      expect(backend.list).toHaveBeenCalledWith(input);
    });

    it('cursor를 전달하면 backend에 cursor를 보내고 다음 페이지를 반환한다', async () => {
      const response = {
        success: true,
        scanStatus: 'complete',
        items: [],
        totalCount: 51,
        returnedCount: 1,
        nextCursor: null,
      };
      backend.list.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers();
      const input = { cursor: 'cursor' };

      const result = await handlers.codocsList(input);

      expect(result).toBe(response);
      expect(backend.list).toHaveBeenCalledWith(input);
    });

    it('cursor와 다른 도메인을 함께 전달하면 backend의 입력 오류를 그대로 반환한다', async () => {
      const response = invalidInput();
      backend.list.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers();
      const input = { cursor: 'cursor', domain: '다른 업무' };

      const result = await handlers.codocsList(input);

      expect(result).toBe(response);
      expect(backend.list).toHaveBeenCalledWith(input);
    });

    it.each(['tampered', 'changed-snapshot', 'after-refresh', 'other-process'])(
      '%s cursor가 만료되면 backend의 만료 오류를 그대로 반환한다',
      async (cursor) => {
        const response = {
          success: false,
          scanStatus: 'complete',
          error: {
            code: 'cursor_expired',
            severity: 'error',
            message: '목록 커서가 만료되었습니다.',
          },
        };
        backend.list.mockResolvedValue(response);
        const handlers = createCodocsQueryHandlers();
        const input = { cursor };

        const result = await handlers.codocsList(input);

        expect(result).toBe(response);
        expect(backend.list).toHaveBeenCalledWith(input);
      },
    );

    it('새로 고침을 호출하면 같은 작업 공간 세션의 응답을 반환한다', async () => {
      const response = { success: true, scanStatus: 'complete' };
      backend.refresh.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers();

      const result = await handlers.refresh();

      expect(result).toBe(response);
      expect(backend.refresh).toHaveBeenCalledOnce();
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

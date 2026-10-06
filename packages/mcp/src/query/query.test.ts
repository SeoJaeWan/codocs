import { queryDiagnosticCodes, queryDiagnosticMessages } from '@codocs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodocsQueryHandlers } from './index.js';
import type { WorkspaceQuerySession } from '@codocs/workspace';

const backend = vi.hoisted(
  /** 각 handler 호출과 전달 인수를 독립적으로 기록한다. */ () => {
    const readiness: {
      state: string;
      ready: boolean;
      cause?: string;
      guidance?: string;
    } = { state: 'ready', ready: true };
    const scanStatus: string | undefined = 'complete';
    return {
      list: vi.fn(),
      get: vi.fn(),
      resolveIdPath: vi.fn(),
      previewRename: vi.fn(),
      applyRename: vi.fn(),
      refresh: vi.fn(),
      readiness,
      scanStatus,
      limitedReadAvailable: false,
    };
  },
);

vi.mock(
  '@codocs/workspace',
  /** 실제 IO 대신 workspace 공개 결과 경계를 제어한다. */ () => ({
    /** 같은 조회 backend를 반환한다. */
    createWorkspaceQuerySession: () => backend,
    workspaceDiagnosticCodes: { readFailed: 'workspace_read_failed' },
    workspaceLifecycleStates: {
      starting: 'starting',
      ready: 'ready',
      refreshing: 'refreshing',
      recovering: 'recovering',
      failed: 'failed',
      closed: 'closed',
    },
  }),
);

beforeEach(
  /** 각 사례의 호출과 응답 계획을 초기화한다. */ () => {
    vi.clearAllMocks();
    backend.readiness = { state: 'ready', ready: true };
    backend.scanStatus = 'complete';
    backend.limitedReadAvailable = false;
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
    it('유효한 이름 주소 하나를 조회하면 작업 공간의 문서 응답을 그대로 반환한다', async () => {
      const response = {
        success: true,
        scanStatus: 'complete',
        results: [
          {
            address: 'normal',
            id: 'normal',
            found: true,
            conflict: false,
            source: { path: '.codocs/normal.yaml' },
            confirmation: 'confirmed',
            document: { _codocs: { id: 'normal' } },
            references: [],
            referencedBy: [],
            diagnostics: [],
          },
        ],
      };
      backend.get.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );
      const input = { addresses: ['normal'] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      expect(backend.get).toHaveBeenCalledWith(input.addresses);
    });

    it('정상 문서와 없는 이름을 함께 조회하면 항목별 결과를 그대로 반환한다', async () => {
      const normal = {
        address: 'normal',
        id: 'normal',
        found: true,
        conflict: false,
        source: { path: '.codocs/normal.yaml' },
        confirmation: 'confirmed',
        document: { _codocs: { id: 'normal' }, definition: '본문' },
        revision: 'revision',
        references: ['대상'],
        referencedBy: ['출처'],
        diagnostics: [],
      };
      const response = {
        success: true,
        scanStatus: 'complete',
        results: [
          normal,
          {
            address: 'missing',
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
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );
      const input = { addresses: ['normal', 'missing'] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      expect(backend.get).toHaveBeenCalledWith(input.addresses);
    });

    it('중복 이름과 정상 문서를 함께 조회하면 충돌 결과의 금지 필드를 덧붙이지 않는다', async () => {
      const response = {
        success: true,
        scanStatus: 'complete',
        results: [
          {
            address: 'shared',
            found: true,
            conflict: true,
            paths: ['.codocs/a.yaml', '.codocs/z.yaml'],
            diagnostics: [],
          },
          {
            address: 'normal',
            id: 'normal',
            found: true,
            conflict: false,
            source: { path: '.codocs/normal.yaml' },
            confirmation: 'confirmed',
            document: { _codocs: { id: 'normal' } },
            references: [],
            referencedBy: [],
            diagnostics: [],
          },
        ],
      };
      backend.get.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );
      const input = { addresses: ['shared', 'normal'] };

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
            address: 'alpha',
            id: 'alpha',
            found: true,
            conflict: false,
            source: { path: '.codocs/alpha.yaml' },
            confirmation: 'unconfirmed',
            document: { _codocs: { id: 'alpha' }, definition: '이전' },
            revision: 'previous',
            references: [],
            referencedBy: [],
            diagnostics: [],
          },
          {
            address: 'outside',
            found: false,
            confirmation: 'unconfirmed',
            diagnostics: [],
          },
        ],
      };
      backend.get.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );
      const input = { addresses: ['alpha', 'outside'] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      expect(backend.get).toHaveBeenCalledWith(input.addresses);
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
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );
      const input = { addresses: ['alpha'] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      expect(result).not.toHaveProperty('results');
    });
  });

  describe('요청 입력 검증과 backend 호출 방지', () => {
    it.each([
      { name: '알 수 없는 목록 속성', method: 'list', input: { limit: 10 } },
      { name: 'kind 필터', method: 'list', input: { kind: 'policy' } },
      { name: '제거된 cursor', method: 'list', input: { cursor: 'x' } },
      {
        name: '문자열이 아닌 parent',
        method: 'list',
        input: { parent: 1 },
      },
      { name: '문자열이 아닌 주소', method: 'get', input: { addresses: [1] } },
      { name: '제거된 ids 입력', method: 'get', input: { ids: ['alpha'] } },
      {
        name: 'status 필터',
        method: 'list',
        input: { status: 'confirmed' },
      },
      { name: '빈 주소 목록', method: 'get', input: { addresses: [] } },
      { name: '희소 주소 배열', method: 'get', input: { addresses: Array(1) } },
      {
        name: '알 수 없는 상세 속성',
        method: 'get',
        input: { addresses: ['alpha'], extra: true },
      },
      {
        name: '21개 고유 주소',
        method: 'get',
        input: {
          addresses: Array.from({ length: 21 }, (_, index) => '문서 ' + index),
        },
      },
    ])(
      '$name을 전달하면 입력 오류를 반환하고 backend를 호출하지 않는다',
      async ({ method, input }) => {
        const handlers = createCodocsQueryHandlers(
          backend as unknown as WorkspaceQuerySession,
        );

        const result =
          method === 'list'
            ? await handlers.codocsList(input)
            : await handlers.codocsGet(input);

        expect(result).toEqual(invalidInput());
        expect(backend.list).not.toHaveBeenCalled();
        expect(backend.get).not.toHaveBeenCalled();
      },
    );

    it('addresses 속성이 접근자이면 접근자를 실행하지 않고 입력 오류를 반환한다', async () => {
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );
      let reads = 0;
      const input = Object.defineProperty({}, 'addresses', {
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
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );
      const revoked = Proxy.revocable({ addresses: ['alpha'] }, {});
      revoked.revoke();

      const result = await handlers.codocsGet(revoked.proxy);

      expect(result).toEqual(invalidInput());
      expect(backend.get).not.toHaveBeenCalled();
    });

    it('같은 주소 21개를 전달하면 중복 제거한 한 주소로 backend를 호출한다', async () => {
      const response = {
        success: true,
        scanStatus: 'complete',
        results: [{ address: 'same', found: false, diagnostics: [] }],
      };
      backend.get.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );
      const input = { addresses: Array(21).fill('same') as string[] };

      const result = await handlers.codocsGet(input);

      expect(result).toBe(response);
      expect(backend.get).toHaveBeenCalledWith(['same']);
    });
  });

  describe('목록 조건과 parent 응답 전달', () => {
    it('제거된 domain 인자를 전달하면 backend를 호출하지 않고 입력 오류를 반환한다', async () => {
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      const result = await handlers.codocsList({ domain: '업무' });

      expect(result).toEqual(invalidInput());
      expect(backend.list).not.toHaveBeenCalled();
    });

    it('partial 목록의 공통 진단과 unreachable을 그대로 전달한다', async () => {
      const response = {
        success: true,
        scanStatus: 'partial',
        items: [
          {
            id: 'old',
            name: '이전 문서',
            source: { path: '.codocs/old.yaml' },
            confirmation: 'unconfirmed',
            hasErrors: false,
            sections: ['정의'],
            childCount: 0,
            conflict: false,
            diagnostics: [
              { code: 'unconfirmed_reference', severity: 'warning' },
            ],
          },
          {
            id: 'new',
            name: '확인 문서',
            source: { path: '.codocs/new.yaml' },
            confirmation: 'confirmed',
            hasErrors: false,
            sections: [],
            childCount: 1,
            conflict: false,
          },
        ],
        unreachable: [
          {
            id: 'orphan',
            name: '고아',
            source: { path: '.codocs/orphan.yaml' },
            confirmation: 'unconfirmed',
            hasErrors: true,
            sections: [],
            childCount: 0,
            conflict: false,
          },
        ],
      };
      backend.list.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      const result = await handlers.codocsList();

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        unreachable: [{ id: 'orphan', hasErrors: true }],
        items: [
          {
            id: 'old',
            confirmation: 'unconfirmed',
            diagnostics: [
              { code: 'unconfirmed_reference', severity: 'warning' },
            ],
          },
          { id: 'new', confirmation: 'confirmed' },
        ],
      });
      if (result.success)
        expect(result.items[1]).not.toHaveProperty('diagnostics');
    });

    it('parent를 전달하면 backend에 parent를 보내고 응답을 그대로 반환한다', async () => {
      const response = {
        success: true,
        scanStatus: 'complete',
        items: [],
      };
      backend.list.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );
      const input = { parent: '개발' };

      const result = await handlers.codocsList(input);

      expect(result).toBe(response);
      expect(backend.list).toHaveBeenCalledWith(input);
    });

    it('없는 parent의 not_found 실패를 그대로 반환한다', async () => {
      const response = {
        success: false,
        scanStatus: 'complete',
        error: {
          code: queryDiagnosticCodes.notFound,
          severity: 'error',
          message: queryDiagnosticMessages.notFound,
        },
      };
      backend.list.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      const result = await handlers.codocsList({ parent: '없음' });

      expect(result).toBe(response);
    });

    it('새로 고침을 호출하면 같은 작업 공간 세션의 응답을 반환한다', async () => {
      const response = { success: true, scanStatus: 'complete' };
      backend.refresh.mockResolvedValue(response);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      const result = await handlers.refresh();

      expect(result).toBe(response);
      expect(backend.refresh).toHaveBeenCalledOnce();
    });
  });

  describe('이름 변경의 ID 조회', () => {
    const input = { mode: 'preview', id: 'order', newName: '새주문' };

    it('현재 ID의 경로를 내부 조회로 구해 preview에 전달하고 get을 호출하지 않는다', async () => {
      backend.resolveIdPath.mockResolvedValue({
        success: true,
        scanStatus: 'complete',
        path: '.codocs/order.yaml',
      });
      const preview = { success: true, scanStatus: 'complete' };
      backend.previewRename.mockResolvedValue(preview);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      const result = await handlers.codocsRename(input);

      expect(result).toBe(preview);
      expect(backend.resolveIdPath).toHaveBeenCalledWith('order');
      expect(backend.previewRename).toHaveBeenCalledWith({
        newName: '새주문',
        targetPath: '.codocs/order.yaml',
      });
      expect(backend.get).not.toHaveBeenCalled();
    });

    it('없거나 중복인 ID는 not_found로 실패하고 변경 계산을 호출하지 않는다', async () => {
      backend.resolveIdPath.mockResolvedValue({
        success: true,
        scanStatus: 'complete',
      });
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      const preview = await handlers.codocsRename(input);
      const apply = await handlers.codocsRename({
        ...input,
        mode: 'apply',
        revisions: { '.codocs/order.yaml': 'revision' },
      });

      expect(preview).toMatchObject({
        success: false,
        scanStatus: 'complete',
        error: { code: queryDiagnosticCodes.notFound },
      });
      expect(apply).toMatchObject({
        success: false,
        saved: false,
        changed: false,
        error: { code: queryDiagnosticCodes.notFound },
      });
      expect(backend.previewRename).not.toHaveBeenCalled();
      expect(backend.applyRename).not.toHaveBeenCalled();
    });

    it('ID 조회가 실패하면 그 실패를 그대로 전달한다', async () => {
      const failure = {
        success: false,
        scanStatus: 'failed',
        error: {
          code: 'index_not_ready',
          severity: 'error',
          message: '준비 중',
        },
      };
      backend.resolveIdPath.mockResolvedValue(failure);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      const result = await handlers.codocsRename(input);

      expect(result).toBe(failure);
      expect(backend.previewRename).not.toHaveBeenCalled();
    });
  });

  describe('준비 상태와 복구 요청', () => {
    it('완료 색인만 write와 validate를 허용하고 partial은 조회만 허용한다', () => {
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      expect(handlers.access).toMatchObject({
        state: 'ready',
        scanStatus: 'complete',
        canRead: true,
        canWrite: true,
        canValidate: true,
        canGuide: true,
        canRefresh: true,
      });

      backend.scanStatus = 'partial';
      expect(handlers.access).toMatchObject({
        scanStatus: 'partial',
        canRead: true,
        canWrite: false,
        canValidate: false,
      });
    });

    it.each(['refreshing', 'recovering'])(
      '%s 중 workspace 준비 결과를 그대로 전달한다',
      async (state) => {
        backend.readiness = { state, ready: false };
        const pending = {
          success: false,
          scanStatus: 'failed',
          error: {
            code: 'index_not_ready',
            severity: 'error',
            message: '준비 중',
          },
        };
        backend.list.mockResolvedValue(pending);
        backend.get.mockResolvedValue(pending);
        const handlers = createCodocsQueryHandlers(
          backend as unknown as WorkspaceQuerySession,
        );
        const list = await handlers.codocsList();
        const get = await handlers.codocsGet({ addresses: ['alpha'] });

        expect(list).toBe(pending);
        expect(get).toBe(pending);
        expect(backend.list).toHaveBeenCalledOnce();
        expect(backend.get).toHaveBeenCalledOnce();
        expect(handlers.access).toMatchObject({
          canRead: false,
          canWrite: false,
          canValidate: false,
          canRefresh: true,
        });
      },
    );

    it('실패 상태의 원인과 수동 refresh 안내를 전달하고 변경 gate를 닫는다', () => {
      backend.readiness = {
        state: 'failed',
        ready: false,
        cause: 'watcher error',
        guidance: 'codocs_refresh를 실행하세요.',
      };
      backend.limitedReadAvailable = false;
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      expect(handlers.access).toMatchObject({
        cause: 'watcher error',
        guidance: 'codocs_refresh를 실행하세요.',
        canRead: false,
        canWrite: false,
        canValidate: false,
        canGuide: true,
        canRefresh: true,
      });
    });

    it('감시 실패 후 완료 snapshot이 있으면 list/get만 허용한다', async () => {
      backend.readiness = {
        state: 'failed',
        ready: false,
        cause: 'watcher error',
        guidance: 'codocs_refresh를 실행하세요.',
      };
      backend.limitedReadAvailable = true;
      backend.list.mockResolvedValue({
        success: true,
        scanStatus: 'partial',
        items: [],
        totalCount: 0,
        returnedCount: 0,
        nextCursor: null,
      });
      backend.get.mockResolvedValue({
        success: true,
        scanStatus: 'partial',
        results: [],
      });
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      expect(handlers.access).toMatchObject({
        canRead: true,
        canWrite: false,
        canValidate: false,
      });
      expect(await handlers.codocsList()).toMatchObject({ success: true });
      expect(await handlers.codocsGet({ addresses: ['alpha'] })).toMatchObject({
        success: true,
      });
    });

    it('동시 codocs_refresh 호출은 같은 workspace 작업과 결과를 공유한다', async () => {
      const response = {
        success: true,
        scanStatus: 'partial',
        fileCount: 3,
        itemCount: 2,
        errorCount: 1,
        warningCount: 1,
        countsComplete: false,
        diagnostics: [],
      };
      const operation = Promise.resolve(response);
      backend.refresh.mockReturnValue(operation);
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      const first = handlers.codocsRefresh();
      const second = handlers.refresh({});

      expect(first).toBe(operation);
      expect(second).toBe(operation);
      expect(await first).toBe(response);
      expect(backend.refresh).toHaveBeenCalledOnce();
    });

    it('refresh에 알 수 없는 입력을 주면 backend를 호출하지 않는다', async () => {
      const handlers = createCodocsQueryHandlers(
        backend as unknown as WorkspaceQuerySession,
      );

      expect(await handlers.codocsRefresh({ force: true })).toEqual(
        invalidInput(),
      );
      expect(backend.refresh).not.toHaveBeenCalled();
    });
  });

  it('큰 document·rawYaml과 20개 결과를 절단 없이 직렬화한다', /** handler가 크기 제한이나 서버 진단을 덧붙이지 않는지 확인한다. */ async () => {
    const large = '가'.repeat(200_000);
    const results = [
      {
        address: 'json',
        id: 'json',
        found: true,
        conflict: false,
        source: { path: '.codocs/json.yaml' },
        confirmation: 'confirmed',
        document: { _codocs: { id: 'json' }, definition: large },
        revision: 'json-revision',
        references: ['raw'],
        referencedBy: [],
        diagnostics: [],
      },
      {
        address: 'raw',
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
          address: `small-${index}`,
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
    const handlers = createCodocsQueryHandlers(
      backend as unknown as WorkspaceQuerySession,
    );
    const addresses = results.map(
      /** 결과 순서와 같은 요청 주소를 만든다. */ (result) => result.address,
    );
    const returned = await handlers.codocsGet({ addresses });
    expect(returned).toBe(response);
    const serialized = JSON.stringify(returned);
    expect(serialized).toContain(large);
    expect(serialized).not.toContain('response_too_large');
    expect(serialized).not.toContain('truncated');
  });
});

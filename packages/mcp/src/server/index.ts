import { getMcpVersion } from './version.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from '@codocs/workspace';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  createCodocsQueryHandlers,
  type CodocsQueryHandlers,
} from '../query/index.js';
import {
  codocsJsonInputSchema,
  type CodocsToolName,
} from '../tool-input/index.js';
import {
  createCodocsGuideHandler,
  type CodocsGuideResponse,
} from '../guide/index.js';

/** 요청 처리 결과의 공통 성공·실패 형태다. */
export interface CodocsToolResult {
  success: boolean;
}

/** 공통 결과 객체를 MCP 구조 결과와 JSON 텍스트에 손실 없이 담는다. */
export function wrapCodocsResult(result: CodocsToolResult): CallToolResult {
  return {
    structuredContent: result as unknown as Record<string, unknown>,
    content: [{ type: 'text', text: JSON.stringify(result) }],
    isError: !result.success,
  };
}

/** 한 세션을 공유하는 SDK 서버와 실행 handler를 연결한다. 세션 종료는 호출자가 소유한다.
 * @param session 조회와 변경이 공유할 프로젝트 세션이다.
 * @param guide 가이드 원문 경계다. 생략하면 배포된 자산을 읽는다.
 */
export function createCodocsServer(
  session: WorkspaceQuerySession,
  guide: (
    input?: unknown,
  ) => Promise<CodocsGuideResponse> = createCodocsGuideHandler(),
): Server {
  const handlers: CodocsQueryHandlers = createCodocsQueryHandlers(session);
  const executionRegistry = new Map<
    CodocsToolName,
    {
      description: string;
      execute: (
        input: unknown,
        options?: { signal?: AbortSignal },
      ) => Promise<CodocsToolResult>;
    }
  >([
    [
      'codocs_list',
      {
        description: '프로젝트 문서 목록을 필터와 커서로 조회합니다.',
        execute: handlers.codocsList.bind(handlers),
      },
    ],
    [
      'codocs_get',
      {
        description:
          '현재 ID로 문서 상세를 최대 20개 조회합니다. 중복 ID는 첫 등장만 사용합니다.',
        execute: handlers.codocsGet.bind(handlers),
      },
    ],
    [
      'codocs_refresh',
      {
        description: '프로젝트 문서 색인 전체를 다시 구성합니다.',
        execute: handlers.codocsRefresh.bind(handlers),
      },
    ],
    [
      'codocs_validate',
      {
        description:
          '프로젝트 전체 또는 .codocs YAML 파일 하나의 문서 진단을 조회합니다.',
        execute: handlers.codocsValidate.bind(handlers),
      },
    ],
    [
      'codocs_write',
      {
        description:
          '문서 하나를 생성하거나 수정하고 저장 결과와 색인 게시 상태를 반환합니다.',
        execute: handlers.codocsWrite.bind(handlers),
      },
    ],
    [
      'codocs_duplicates',
      {
        description:
          '프로젝트 전체 또는 저장 전 초안(draft)의 반복 구절 후보와 양쪽 원문 위치를 조회합니다. 입력 없음은 전체 검토, draft는 codocs_write와 같은 create/update 입력의 초안 검토, cursor는 다음 페이지 요청이며 draft와 함께 보낼 수 없습니다. 결과는 검토 정보이며 저장을 막지 않고 파일이나 색인을 바꾸지 않습니다. status가 complete가 아니면 중복 없음이 아닙니다. 위치의 range 줄·문자는 0부터 시작하고 offsetRange는 원문 YAML의 UTF-16 오프셋입니다.',
        execute: handlers.codocsDuplicates.bind(handlers),
      },
    ],
    [
      'codocs_guide',
      {
        description:
          '색인 준비 상태와 무관하게 문서 작성·수정·검증 가이드를 제공합니다.',
        execute: guide,
      },
    ],
  ]);
  const server = new Server(
    { name: 'co-documentation', version: getMcpVersion() },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(
    ListToolsRequestSchema,
    /** 실제 실행 가능한 도구만 나열한다. */ () => ({
      tools: Array.from(
        executionRegistry,
        /** 원본 스키마와 실행 설명을 같은 이름에 연결한다. */ ([
          name,
          entry,
        ]): Tool => ({
          name,
          description: entry.description,
          inputSchema: codocsJsonInputSchema(name) as Tool['inputSchema'],
        }),
      ),
    }),
  );
  server.setRequestHandler(
    CallToolRequestSchema,
    /** 알려진 도구만 공통 결과로 포장한다. */ async (request, extra) => {
      const name = request.params.name;
      const entry = executionRegistry.get(name as CodocsToolName);
      if (!entry)
        throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
      const result = await entry.execute(request.params.arguments ?? {}, {
        signal: extra.signal,
      });
      return wrapCodocsResult(result);
    },
  );
  return server;
}

/** 시작 cwd와 프로젝트를 고정하고 연결·세션을 한 멱등 종료 경로로 소유한다. */
export async function startCodocsStdio(
  options: { cwd: string; project?: string },
  transport: StdioServerTransport = new StdioServerTransport(),
): Promise<{ close(): Promise<void> }> {
  const session = createWorkspaceQuerySession(options);
  let server: Server | undefined;
  let closing: Promise<void> | undefined;
  /** 연결과 세션을 한 번만 닫고 모든 호출자에게 같은 완료를 전달한다. */
  const close = (): Promise<void> => {
    closing ??= (
      /** 연결 실패 뒤에도 확보한 자원을 정리한다. */ async () => {
        try {
          await server?.close();
        } finally {
          await session.close();
        }
      }
    )();
    return closing;
  };
  try {
    server = createCodocsServer(session);
    await server.connect(transport);
  } catch (error) {
    await close();
    throw error;
  }
  return { close };
}

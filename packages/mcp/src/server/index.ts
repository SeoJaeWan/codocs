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

/** 공통 결과 객체를 MCP 구조 결과와 JSON 텍스트에 손실 없이 담는다.
 * */
export function wrapCodocsResult(result: CodocsToolResult): CallToolResult {
  return {
    structuredContent: result as unknown as Record<string, unknown>,
    content: [{ type: 'text', text: JSON.stringify(result) }],
    isError: !result.success,
  };
}

/** 초기화 결과로 클라이언트에 전달하는 서버 사용 안내다. 검색 도구의 사용 시점과 방법을 알린다. */
export const codocsServerInstructions =
  '이 서버는 프로젝트의 .codocs 문서를 조회하고 관리합니다. 작업을 시작할 때와 작업 범위가 바뀔 때마다 codocs_search를 호출해 관련 문서를 먼저 찾으세요. 대화 맥락에서 주제·용어·식별자를 뽑아 짧은 검색어 여러 개로 호출하고, 사용자 요청 원문을 통째로 검색어에 넣지 마세요. 결과의 address는 codocs_get에 그대로 넘겨 함께 읽고, 본문에 있는 [[링크]]도 확인하세요. emptyQueries에 담긴 검색어는 걸린 문서가 없다는 뜻이므로 해당 문서가 없을 수 있습니다. scanStatus가 partial이면 확인하지 못한 문서가 있어 결과 없음을 문서 없음으로 단정하지 마세요.';

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
        description:
          '문서의 parent 구조를 한 단계씩 조회합니다. parent를 생략하면 최상위 문서와 parent 오류로 닿을 수 없는 문서(unreachable)를, parent에 문서 이름을 주면 그 이름을 parent로 적은 직속 자식을 이름 순서로 모두 돌려줍니다. 항목마다 name, id, hasErrors, sections(섹션 이름), childCount를 담으며 본문은 담지 않습니다. 없는 parent 이름은 not_found입니다.',
        execute: handlers.codocsList.bind(handlers),
      },
    ],
    [
      'codocs_get',
      {
        description:
          '문서 이름 주소(addresses)로 문서 전체나 섹션 하나를 최대 20개 조회합니다. 주소는 "이름" 또는 "이름:섹션"이며 이름이나 섹션에 콜론이 있으면 \:로 적습니다. 중복 주소는 첫 등장만 사용합니다. 결과마다 address를 담고, references와 referencedBy는 문서 이름입니다. 주소 하나의 형식 오류·부재(not_found, section_not_found)·중복(conflict)은 그 결과에만 표시합니다.',
        execute: handlers.codocsGet.bind(handlers),
      },
    ],
    [
      'codocs_search',
      {
        description:
          '검색어(queries, 1~10개, 각 1~200자)로 문서와 섹션을 찾아 codocs_get에 바로 넘길 수 있는 address를 점수 순서로 돌려줍니다. 작업을 시작할 때와 범위가 바뀔 때 호출하고, 대화 맥락에서 뽑은 주제·용어·식별자를 짧은 검색어 여러 개로 나누어 넣으세요(원문 통째로 넣지 마세요). 항목마다 address, score(0 초과 1 이하), queries(걸린 검색어), sections(같은 문서의 섹션 여럿을 문서 주소로 묶었을 때 걸린 섹션 이름)를 담습니다. 결과 주소는 codocs_get으로 함께 읽고 본문의 [[링크]]도 확인하세요. 걸린 것이 없는 검색어는 emptyQueries에 담기며 그 주제의 문서가 없을 수 있다는 뜻입니다. scanStatus가 partial이면 diagnostics에 미확인 표시가 붙으며 결과 없음을 문서 없음으로 단정할 수 없습니다.',
        execute: handlers.codocsSearch.bind(handlers),
      },
    ],
    [
      'codocs_refresh',
      {
        description:
          '프로젝트 문서 색인과 코드 참조 색인을 다시 구성합니다. 결과의 scanStatus·fileCount·itemCount는 문서 색인 기준이고, codeScanStatus(collecting·complete·incomplete)와 codeFailures는 코드 수집 상태를 따로 알리며, diagnostics와 errorCount·warningCount는 문서 진단과 코드 참조 진단을 함께 센 값입니다. countsComplete가 false이면 확인한 범위만 센 값입니다. 동시에 들어온 refresh는 한 번의 재구성을 공유합니다.',
        execute: handlers.codocsRefresh.bind(handlers),
      },
    ],
    [
      'codocs_validate',
      {
        description:
          '프로젝트 전체 또는 .codocs YAML 파일 하나의 진단을 저장된 디스크 기준으로 조회합니다. path는 .codocs YAML이어야 하며 아니면 invalid_path입니다. 결과의 scanStatus는 문서 색인 기준이고 codeScanStatus(collecting·complete·incomplete)는 코드 수집 상태입니다. diagnostics에는 문서 진단과 코드 파일의 @codocs 참조 진단(path는 코드 파일, range는 표기 위치)이 함께 담기며, path를 주면 그 YAML이 후보에 포함된 코드 참조 진단만 더합니다. diagnosticsComplete가 false이면 확인한 결과만이며 문제 없음이 아닙니다. 읽지 못한 코드 파일은 codeFailures에 담깁니다.',
        execute: handlers.codocsValidate.bind(handlers),
      },
    ],
    [
      'codocs_write',
      {
        description:
          '문서를 생성(create), 부분 수정(update: set·unset), 전체 교체(replace: id·revision·document), 삭제(delete: id·revision), 경로 이동(move: id·revision·path)하고 저장 결과와 색인 게시 상태를 반환합니다. 요청 하나는 단일 변경이거나 changes 배열(1개 이상, 항목은 단일 변경과 같은 형태)이며 다른 최상위 속성은 invalid_input입니다. changes는 모든 항목을 반영한 최종 상태를 한 번 검증해 전부 저장하거나 아무것도 저장하지 않고, 같은 문서 ID나 경로가 두 번 나오면 invalid_input이며 결과는 입력 순서의 changes[](state: changed·restored·restore_failed·unchanged)입니다. 저장 도중 실패하면 반영한 항목을 되돌리며 되돌리지 못하면 write_restore_failed입니다. replace의 document는 _codocs를 포함한 문서 전체이며 생략한 최상위 섹션은 삭제되고 set·unset과 함께 보낼 수 없으며 name은 바꿀 수 없습니다(name_change_not_allowed, codocs_rename 사용). 변경이 다른 문서나 코드 파일의 참조 또는 건드리지 않은 문서의 parent를 새로 끊으면 reference_broken으로 거절하고, 확인이 필요한 코드 근거를 읽지 못했으면 code_evidence_incomplete로 거절하며 이때 파일은 바뀌지 않습니다. delete·move로 비게 된 폴더는 .codocs 바로 아래까지 제거합니다.',
        execute: handlers.codocsWrite.bind(handlers),
      },
    ],
    [
      'codocs_rename',
      {
        description:
          '문서 이름을 바꾸고 그 문서를 가리키던 참조를 함께 고칩니다. section(현재 섹션 이름)을 주면 그 문서의 최상위 섹션 이름을 바꾸고 그 섹션을 가리키던 [[문서:섹션]] 참조를 함께 고치며, 이때 newName은 새 섹션 이름이고 결과에 targetSection이 추가됩니다(section_conflict·section_not_found 등으로 blocked일 수 있음). section이 없으면 문서 이름 변경입니다. mode preview는 파일과 색인을 바꾸지 않고 상태(ready·unresolved·blocked), 변경 목록, 선택이 필요한 모호 참조의 후보, 충돌, 영향받는 파일별 revisions를 반환합니다. mode apply는 같은 id·newName·selections와 preview가 돌려준 revisions를 그대로 받아 다시 계산한 뒤 저장하며, blocked이거나 revision·영향 파일이 달라졌으면 파일을 바꾸지 않고 거절합니다. selections의 sourcePath·occurrenceIndex·targetPath는 preview 결과의 값을 그대로 사용합니다. 코드 파일의 `@codocs` 문서 참조(`[[이름]]`)·섹션 참조(`[[이름:섹션]]`) 표기도 함께 고칩니다. 문서 이름 변경은 이름이 그 문서로 확정된 표기의 이름 부분만, 섹션 이름 변경은 이름·섹션이 모두 그 대상으로 확정된 표기의 섹션 부분만 바꾸고 나머지 원문은 그대로 둡니다. 코드 파일의 변경·영향·파일 결과에는 fileKind: "code"가 붙고(.codocs 문서에는 없음) 모호한 코드 표기의 selections.sourcePath는 코드 파일 경로, occurrenceIndex는 그 파일의 표기 순번입니다. 코드 수집이 진행 중이면 blocked(blockingReason unconfirmed)이며 파일을 바꾸지 않으니 잠시 뒤 다시 요청하세요. 수집은 끝났지만 읽지 못한 코드 파일이 있으면 확인한 파일만 고치고 읽지 못한 경로를 reason unconfirmed 영향(occurrenceIndex -1)으로 보고하며 상태는 unresolved입니다.',
        execute: handlers.codocsRename.bind(handlers),
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
    { capabilities: { tools: {} }, instructions: codocsServerInstructions },
  );
  server.setRequestHandler(
    ListToolsRequestSchema,
    /** 실제 실행 가능한 도구만 나열한다.
     * */ () => ({
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
    /** 알려진 도구만 공통 결과로 포장한다.
     * */ async (request, extra) => {
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

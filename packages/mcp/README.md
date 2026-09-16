# mcp

MCP 조회 입력을 검증하고 workspace/core의 결과를 공통 success 응답으로 연결하는 전송 독립 어댑터다. 허용 의존성은 `@codocs/workspace`, `@codocs/core`의 공개 진입점이다. SDK, stdio 등록, guide/write/validate/refresh 도구와 실행 프로세스는 후속 범위다.

## 기능과 파일 역할

| 파일                      | 역할                                                             | 제공 값·사용처                                      |
| ------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `src/index.ts`            | 전송 계층에 공개할 handler API를 재내보낸다.                     | 패키지 공개 진입점                                  |
| `src/query/index.ts`      | 외부 입력의 속성과 값을 검증하고 workspace 조회 세션을 호출한다. | `createCodocsQueryHandlers`, 후속 MCP SDK 등록 계층 |
| `src/query/query.test.ts` | 잘못된 입력의 차단과 handler 응답을 검증한다.                    | 전송 연결 전의 어댑터 계약 확인                     |

`createCodocsQueryHandlers(workspaceInput)`은 한 workspace 조회 세션을 공유하는 `codocsList`와 `codocsGet`을 반환한다. 두 함수는 외부 값을 `unknown`으로 받아 own data property만 확인하고 getter나 prototype 값을 읽지 않는다. `refresh`는 같은 세션의 목록 cursor를 명시적으로 만료하는 lifecycle 함수이며 아직 `codocs_refresh` 도구 등록을 뜻하지 않는다.

```ts
import { createCodocsQueryHandlers } from '@codocs/mcp';

const query = createCodocsQueryHandlers({ project: '../app' });
const page = await query.codocsList({
  domain: 'sample-sales',
  kind: 'procedure',
  status: 'confirmed',
});
const details = await query.codocsGet({ ids: ['sample-order'] });
```

입력 속성·페이지·상세 결과 필드는 [조회](../../.codocs/mcp/query.yaml), 요청 성공과 개별 문서 문제의 차이는 [도구 결과](../../.codocs/mcp/tool-result.yaml)에서 확인한다.

`@codocs/mcp`는 private 내부 패키지다. tsc가 ESM 실행 파일 `dist/index.js`와 d.ts를 생성하며 core/workspace 출력이 먼저 준비된다. Node IO와 cursor 상태는 workspace에 둔다.

build는 가이드 `dist/docs/guide`와 가상 예시 `dist/examples/.codocs`를 복사하고 package files에 dist를 포함한다. 사용자 .codocs 저장 시 전체 재포맷 기능은 없다. 가이드 asset 배치는 도구 API 구현을 의미하지 않는다.

실제 Node JS import, 소스 없는 strict TS d.ts 소비자, 내부 subpath 거부와 packed asset 포함을 시험한다. 모듈 직접 호출은 실제 MCP SDK나 stdio 연결 시험의 대체가 아니다. macOS arm64 / Node 24.21.0 / pnpm 10.34.5에서 검증하며 private 의존성의 npm 단독 게시를 검증하지 않는다.

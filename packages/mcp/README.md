# mcp

MCP 조회 입력을 검증하고 workspace/core의 결과를 공통 success 응답으로 연결하는 전송 독립 어댑터다. 허용 의존성은 `@codosc/workspace`, `@codosc/core`의 공개 진입점이다. SDK, stdio 등록, guide/write/validate/refresh 도구와 실행 프로세스는 후속 범위다.

`createCodocsQueryHandlers(workspaceInput)`은 한 workspace 조회 세션을 공유하는 `codocsList`와 `codocsGet`을 반환한다. 두 함수는 외부 값을 `unknown`으로 받아 own data property만 확인하고 getter나 prototype 값을 읽지 않는다. `refresh`는 같은 세션의 목록 cursor를 명시적으로 만료하는 lifecycle 함수이며 아직 `codocs_refresh` 도구 등록을 뜻하지 않는다.

```ts
import { createCodocsQueryHandlers } from '@codosc/mcp';

const query = createCodocsQueryHandlers({ project: '../app' });
const page = await query.codocsList({
  domain: 'sample-sales',
  kind: 'procedure',
  status: 'confirmed',
});
const details = await query.codocsGet({ ids: ['sample-order'] });
```

목록 입력은 `cursor`, `domain`, `kind`, `status`만 받으며 50개 고정 페이지의 `items`, `totalCount`, `returnedCount`, `nextCursor`를 제공한다. 상세 입력은 처음 등장한 순서로 중복 제거한 1~20개 `ids`만 받는다. 성공 상세의 없음·충돌·오류 문서는 서로 독립된 `results` 항목이고, 충돌에는 대표 본문이나 revision이 없다. 정상 문서는 JSON `document` 또는 손실 없는 `rawYaml` 중 하나와 직접 `references`/`referencedBy`를 반환한다.

모든 응답에는 `success`와 `scanStatus`가 있다. `complete`만 부재를 `not_found`로 확정하고, `partial`은 보존 문서와 색인 밖 ID를 `unconfirmed`로 표시하며, `failed`는 이전 문서를 노출하지 않는다. 전체 입력·scan·cursor 실패는 `success:false`의 공통 `error`로 반환한다. 응답 크기 측정, 절단, `response_too_large` 처리는 추가하지 않는다.

`@codosc/mcp`는 private 내부 패키지다. tsc가 ESM 실행 파일 `dist/index.js`와 d.ts를 생성하며 core/workspace 출력이 먼저 준비된다. NodeNext, package type module, 로컬 `.js` import를 유지한다. ES2022와 `types: []`를 사용하며 Node IO와 cursor 상태는 workspace에 둔다.

build는 가이드 `dist/docs/guide`와 가상 예시 `dist/examples/.codocs`를 복사하고 package files에 dist를 포함한다. 사용자 .codocs 저장 시 전체 재포맷 기능은 없다. 가이드 asset 배치는 도구 API 구현을 의미하지 않는다.

기능과 test는 `src/기능/`에 함께 두며 build에서 test/spec는 제외한다. 실제 Node JS import, 소스 없는 strict TS d.ts 소비자, 내부 subpath 거부와 packed asset 포함을 시험한다. 모듈 직접 호출은 실제 MCP SDK나 stdio 연결 시험의 대체가 아니다. macOS arm64 / Node 24.21.0 / pnpm 10.34.5에서 검증하며 private 의존성의 npm 단독 게시를 검증하지 않는다.

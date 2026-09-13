# mcp

MCP 도구 요청을 workspace/core로 연결할 어댑터다. 허용 내부 의존성은 `@codosc/workspace`, `@codosc/core`의 공개 진입점이다. 현재 빈 모듈이며 MCP SDK, 도구, stdio 연결과 실행 프로세스는 구현하지 않았다.

`@codosc/mcp`는 private 내부 패키지다. 프로젝트 공개 API와 npm 게시를 구분한다. 초기 타입은 `src/index.ts`; 실행 JS 진입점은 후속 빌드의 `dist/index.js`다. 다른 패키지의 상대 내부 경로와 subpath를 import하지 않는다.

구현 시 `src/기능/index.ts`, `src/기능/기능.test.ts`를 함께 둔다. README에는 도구 입력 검증, 응답과 오류, 프로세스 상태, 실제 연결을 시험한 범위를 적는다. 현재 개발 fixture 검증은 실제 MCP 클라이언트 연결 검증이 아니다.

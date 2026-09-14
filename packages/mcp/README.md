# mcp

MCP 요청을 workspace/core로 연결할 어댑터다. 허용 의존성은 `@codosc/workspace`, `@codosc/core`의 공개 진입점이다. 현재 빈 모듈이므로 도구 입력/응답, 공개 함수, 프로세스 상태 및 오류 전달 흐름이 없다. SDK, stdio 연결, MCP guide 도구와 실행 프로세스 기능은 후속 범위다.

`@codosc/mcp`는 private 내부 패키지다. tsc가 ESM 실행 파일 `dist/index.js`와 d.ts를 생성하며 core/workspace 출력이 먼저 준비된다. NodeNext, package type module, 로컬 .js import를 유지한다. ES2022와 types: []를 사용하며 현재 소스에는 Node API가 없다. API 도입 시 런타임 지원 하한을 별도로 확인해야 한다.

build는 가이드 `dist/docs/guide`와 가상 예시 `dist/examples/.codocs`를 복사하고 package files에 dist를 포함한다. 사용자 .codocs 저장 시 전체 재포맷 기능은 없다. 가이드 asset 배치는 도구 API 구현을 의미하지 않는다.

기능과 test는 `src/기능/`에 함께 두며 build에서 test/spec는 제외한다. 실제 Node JS import, 소스 없는 TS d.ts 소비자, subpath 거부와 packed asset 포함을 시험한다. 모듈 로드는 실제 MCP stdio 연결 시험의 대체가 아니다. Windows x64 / Node 24.21.0 / pnpm 10.34.5만 시험했다. private 의존성의 npm 단독 설치·게시를 검증하지 않았다.

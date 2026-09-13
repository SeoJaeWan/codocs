# languageServer

LSP 요청과 응답을 도메인 및 workspace 로직으로 연결할 패키지다. 허용 내부 의존성은 `@codosc/workspace`, `@codosc/core`다. 현재 빈 진입점만 있으며 Hover, 진단, 서버 시작과 프로토콜 처리는 구현하지 않았다.

패키지 이름은 `@codosc/language-server`이며 공개 진입점만 import한다. `private`는 npm 게시 정책이다. 초기 타입 진입점은 `src/index.ts`; 실행 진입점과 번들은 후속 빌드 작업에서 설정한다. VS Code 패키지에 역방향으로 의존하지 않는다.

기능은 `src/기능/index.ts`, `src/기능/기능.test.ts`에 함께 둔다. README에는 요청/응답, 오류와 상태, 실제 LSP 프로세스 및 클라이언트 시험 범위를 기록한다. 현재 fixture 통과는 실제 LSP/IDE 기능 검증을 뜻하지 않는다.

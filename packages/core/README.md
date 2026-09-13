# core

`.codocs` 데이터 모델, 파싱과 검증, 참조 해석 등 순수 도메인 로직을 담당할 패키지다. 현재 `src/index.ts`는 빈 모듈이며 업무 기능과 공개 함수는 아직 없다. 파일 IO, Node 내장 모듈, VS Code, LSP, MCP SDK에 의존하지 않는다. YAML/Zod 등의 순수 라이브러리는 사용할 수 있다.

외부 패키지는 `@codosc/core` 진입점만 사용한다. `private`는 npm 게시를 제한하며 프로젝트 내부 공개 API와 별개다. 초기 타입 진입점은 `src/index.ts`, 실행 진입점은 후속 빌드가 생성할 `dist/index.js`다.

기능 구현은 `src/기능/index.ts`와 같은 폴더에 `src/기능/기능.test.ts`를 둔다. 기능 README가 필요하면 입력/출력, 오류와 상태, 실제 시험 범위를 설명한다. 단순 re-export에 형식적 테스트를 추가하지 않는다. 현재 테스트는 개발 규칙 fixture에 한정된다.

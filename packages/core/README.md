# core

순수 .codocs 데이터 모델, 파싱·검증·참조 해석의 경계다. 현재 빈 모듈이므로 입력/출력 흐름, 공개 함수, 오류 및 상태 전이는 없다. 후속 구현은 외부 데이터를 unknown으로 받아 구조와 의미를 검증한다. 파일 IO, Node 내장 모듈, IDE/LSP/MCP에 의존하지 않으며 순수 라이브러리를 사용할 수 있다.

내부 소비자는 `@codosc/core` 공개 진입점만 사용한다. `private`는 npm 게시 정책이다. ESM `dist/index.js`와 `dist/index.d.ts`는 tsc로 생성한다. NodeNext 및 package type module, 로컬 import의 .js 확장자를 유지한다. ES2022와 types: []를 사용하며 실제 core 소스에는 호스트 API가 없다.

기능은 `src/기능/index.ts`와 같은 폴더의 `기능.test.ts`에 추가한다. build는 test/spec를 제외한다. 루트 typecheck는 실제 d.ts를 먼저 준비한 뒤 소스와 test를 검사하며 소스 alias를 사용하지 않는다.

실제 빌드 JS import, 소스 없는 별도 TS 소비자의 d.ts 해석, 내부 subpath 거부와 개발 규칙을 시험한다. 현재 도메인 기능 시험은 없다. 검증 환경은 Windows x64 / Node 24.21.0 / pnpm 10.34.5다. 이 결과는 npm 단독 설치나 다른 런타임 호환성 시험이 아니다.

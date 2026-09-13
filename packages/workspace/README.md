# workspace

파일 탐색·읽기/쓰기·인덱스·상태를 담당할 IO 경계다. 순수 도메인 검증은 `@codosc/core` 공개 진입점만 소비한다. 현재 빈 모듈이므로 파일 입력/출력, 공개 함수, workspace 상태 및 오류 복구 흐름은 없다. 후속 구현은 실제 파일로 IO와 상태 전이 및 실패 전달을 시험한다.

`@codosc/workspace`는 private 내부 패키지이며 상대 내부 경로와 subpath import를 금지한다. tsc가 ESM `dist/index.js`와 `dist/index.d.ts`를 생성한다. core를 먼저 빌드하며 NodeNext, package type module, 로컬 .js import를 유지한다. ES2022와 types: []를 사용한다. 현재 소스에는 Node API가 없으며 IO 구현 시 지원 런타임/API 범위를 별도로 검증해야 한다.

기능과 test는 `src/기능/`에 함께 두며 build에서 test/spec는 제외한다. 실제 Node import, 소스 없는 TS 소비자, d.ts 진입점, 금지 내부 접근과 개발 규칙을 시험한다. 현재 IO 기능 시험은 없다. 시험한 환경은 Windows x64 / Node 24.21.0 / pnpm 10.34.5이며 npm 단독 설치를 검증한 것은 아니다.

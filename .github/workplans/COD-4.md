# COD-4 — [01] 개발 환경·모노레포·공개 패키지 경계 구성

h2. 목표

모든 기능이 동일한 타입·빌드·테스트 규칙 위에서 개발되도록 실행 가능한 기본 저장소를 만든다.

h2. 작업 순서와 선행 조건

권장 순서 01/25 · 1단계 · 상위 COD-1

선행 구현 작업 없음.

h2. 구현 범위

- Node.js 24 LTS·pnpm workspaces와 core/workspace/language-server/vscode/mcp 패키지 구성. 공개 진입점·내부 import 경계 설정.
- TypeScript strict, unknown 입력 검증, 공개 반환 타입, camelCase/PascalCase, JSDoc 검사 범위를 ESLint에 반영.
- Vitest·tsc·ESLint/typescript-eslint/jsdoc·Prettier 및 typecheck/lint/format:check/test/build 명령 구성.
- core/workspace/mcp ESM·NodeNext·상대 .js import, vscode CommonJS/esbuild 및 language-server 번들 골격. 정확한 버전 잠금.
- 기능/index.ts·기능/기능.test.ts 배치, 각 패키지 README와 docs/guide·examples/.codocs 위치 구성.

h2. 검증 시나리오와 기대 결과

- 깨끗한 설치 후 루트 검사·빌드 명령이 성공하고 빌드된 공개 패키지를 import할 수 있다.
- 미처리 Promise·누락 JSDoc·공개 반환 타입 위반을 규칙 검사가 발견한다. 짧은 인라인 콜백 예외는 오탐하지 않는다.
- tsc 검사와 번들링을 독립 실행하며 다른 패키지 내부 import를 금지한다.

h2. 완료 기준과 산출물

- 실제 사용한 Node/pnpm/의존성 버전과 실행법이 기록된다.
- 사용자 .codocs 전체 재포맷을 기본 저장 동작에 연결하지 않는다.
- 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 검증 결과를 기록한다. 실제 IO·프로세스·IDE가 필요한 시나리오는 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- 정확한 TS target과 의존성 조합을 지원 런타임에 맞춰 검증한다.

h2. 기준 Wiki와 추적 근거

- Codocs 개발 환경과 코드·테스트 컨벤션 (codocs-development-conventions)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-937a-7757-adda-29dfac9b8d39","revision":"01a09980-937a-7e7d-ad2d-6bf9ec3795f1"}}}
- Codocs 패키지 책임과 서버 실행 구조 (codocs-runtime-architecture)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8dfd-7e81-b523-f955026a53ad","revision":"01a09980-8dfd-73f8-8cb0-3cc3be8368b8"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-4

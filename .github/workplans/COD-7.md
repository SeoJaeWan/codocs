# COD-7 — [04] 프로젝트 루트·문서 탐색·파일 로더 구현

h2. 목표

지정 프로젝트 내부의 YAML을 안전하게 읽고 파일별 실패를 분리한다.

h2. 작업 순서와 선행 조건

권장 순서 04/25 · 1단계 · 상위 COD-1

* [COD-6|https://seojaewan.atlassian.net/browse/COD-6] — Zod 문서 스키마·사용자 정의 속성·검증 진단 구현

h2. 구현 범위

* workspace loader가 .codocs 하위 .yaml/.yml을 읽고 각 파일의 원문·실제 경로·프로젝트 상대 source.path를 제공.
* cwd 또는 선택 --project로 정한 루트를 유지하고 상위 Git 루트 자동 탐색이나 다중 프로젝트 인자를 도입하지 않는다.
* .codocs 부재는 빈 프로젝트, 존재하지만 접근 불가는 오류로 구분.
* 실제 대상이 .codocs 밖인 링크·정션은 읽기 건너뛰기/안내·쓰기 경계용 판정 제공. watcher는 링크를 따르지 않도록 연계.
* ID 없는 파일과 파싱 오류 파일도 경로·진단으로 보관하고 정상 파일 처리를 계속.

h2. 검증 시나리오와 기대 결과

* 임의 하위 폴더·yaml/yml 혼합·빈 프로젝트·접근 실패를 구분한다.
* 공백/한글 경로와 상대 경로 정규화, 외부 링크/정션 경계·.. 탈출을 검증한다.
* 같은 실제 프로젝트의 경로 별칭을 이후 잠금 식별에서 일관되게 사용할 수 있다.

h2. 완료 기준과 산출물

* 파일 IO가 core에 유입되지 않으며 전체 스캔 결과/파일 오류를 분리한다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 검증 결과를 기록한다. 실제 IO·프로세스·IDE가 필요한 시나리오는 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* OS별 realpath·경로 대소문자·동일 프로젝트 판별 규칙을 시험 결과로 기록한다.

h2. 기준 Wiki와 추적 근거

* Codocs YAML 문서 형식과 식별자 (codocs-document-schema)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-ca16-74c4-92f7-3f2c8dcc6199","revision":"01a0997a-ca16-7c4a-b028-963afd1e9393"}}}
* Codocs 패키지 책임과 서버 실행 구조 (codocs-runtime-architecture)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8dfd-7e81-b523-f955026a53ad","revision":"01a09980-8dfd-73f8-8cb0-3cc3be8368b8"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-7

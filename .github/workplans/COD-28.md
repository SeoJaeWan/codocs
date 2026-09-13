# COD-28 — [25] 배포 패키지·VSIX·지원 OS 최종 검증과 릴리스 준비

h2. 목표

지원한다고 명시할 환경에서 실제 설치·실행 가능한 첫 배포물을 준비한다.

h2. 작업 순서와 선행 조건

권장 순서 25/25 · 3단계 · 상위 COD-3

* [COD-27|https://seojaewan.atlassian.net/browse/COD-27] — MCP 종단·동시 실행·복구·성능 회귀 검증
* [COD-20|https://seojaewan.atlassian.net/browse/COD-20] — 실제 VSIX 기능·IDE 응답성·지원 하한 검증

h2. 구현 범위

* co-documentation 패키지의 codocs bin·빌드 JS·가이드/예시 포함을 검증하고 배포 명칭 일치 확인.
* VSIX 최소 후보/최신 VS Code와 독립 MCP Node24.x 설치·실행 시험.
* Windows/macOS/Linux 로컬 디스크의 경로·권한·줄바꿈·감지·생성/교체·멀티프로세스 회귀.
* README 설치/클라이언트 설정/프로젝트 루트/지원범위/복구 설명과 의존성 잠금·버전 기록.
* npm 이름 사용 가능 여부와 Marketplace 게시 메타데이터 확인, 릴리스 체크리스트·검증 결과 준비.

h2. 검증 시나리오와 기대 결과

* 깨끗한 환경에서 패키지와 VSIX 산출물만으로 연결·핵심 흐름이 성공한다.
* 한글/공백 경로·프로젝트 격리·다중 인스턴스와 OS별 비덮어쓰기 생성을 확인한다.
* 실측 지원 환경/성능과 문서 주장에 차이가 없고 WSL/컨테이너/SSH·네트워크 폴더를 검증 없이 보장하지 않는다.

h2. 완료 기준과 산출물

* 재현 가능한 배포 산출물·설치 검증·지원 매트릭스·알려진 제한·릴리스 준비 결과가 있다.
* 이 이슈 등록은 npm/Marketplace 실제 게시 실행이 아니다. 게시 단계는 준비 결과와 당시 사용자 지시를 기준으로 수행한다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 최소 VS Code 하한·정확한 지원 OS/아키텍처는 실제 시험한 범위로 확정한다.

h2. 기준 Wiki와 추적 근거

* Codocs 배포와 지원 환경 검증 (codocs-release-support)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-9851-7a49-abd4-0c44fb8a51a5","revision":"01a09980-9851-7e92-b590-297955d7ce38"}}}
* Codocs 개발 환경과 코드·테스트 컨벤션 (codocs-development-conventions)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-937a-7757-adda-29dfac9b8d39","revision":"01a09980-937a-7e7d-ad2d-6bf9ec3795f1"}}}
* Codocs 제품 목적과 구현 범위 (codocs-product-scope)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-c605-73f4-8247-c81e1420a61e","revision":"01a0997a-c605-7df5-a575-a46c6e246d2a"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-28

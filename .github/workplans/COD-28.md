# COD-28 — 0.0.1 배포 후보 통합과 리뷰 준비

현재 승인 범위는 `co-documentation` MCP와 `seojaewan.codocs` VSIX 0.0.1, MIT 라이선스, 원본 로고, Windows/macOS 실제 설치·기능·정리 검증이다. Linux·WSL·컨테이너·SSH·네트워크 폴더는 지원 검증 범위 밖이다.

- 실행: `wb-prepare-20260927T111517Z-8249a22b31f2-5eaf0e`, intent/2
- 사용자 지시: 완료하면 feature/cod-28 브랜치에 머지하고 푸시하고 리뷰 받기 대기해
- 실제 대상: 기존 [PR #25](https://github.com/SeoJaeWan/codocs/pull/25)의 `feature/COD-28` → `main`
- 병합 기준: `078f35aeae4000672c7d5849bbcea284b702f8e0`
- TASK-001: `fea2375c8c3675f34e4e52f63d7a5e0b002aa7ea`
- TASK-002: `95a628fc1f2b8772c51c9792e0a2c8edf69f935a`
- INT-001: `4697a256f36b4afa45cd7a950b2b5f8a424de981`
- 계획 artifact: `01a0e2a2-e642-78a6-a803-6e1ba0f865d2`
- 계획 SHA-256: `7c101d8a0ca551da0fcc9a126a87af994676aa6f621ae667c69c6970e2d0f1fc`
- INT-001 source packet: `253ceacf51d15c8e6234351ce2a7dc06a7a44c5deccafd5209d56b9a55e0453d`
- INT-001 binding: `b020508dd070a677c33747f6e60cd53c46cc16442dbc6540f6883966031cb067`
- DELIVERY-001 binding: `287c284a9d13ca08dd2bd5077754681997014f0739705439d9b9fc751a8ac199`
- intent/2 revision SHA-256: `af6b3c036929725861f9a7ee3e9f57a0e2191c041ed10ff27c491ca072164110`

선행 [통합 결과](COD-28-results/integration.md)는 intent/1 당시의 로컬 검증과 한계를 보존한다. Windows에서 pnpm check(979 Vitest + 50 Node + 117 consumer), 독립 Node 24 설치, VS Code 1.100.0/1.139.1 각각 기능 58/58·lifecycle 4/4를 통과했다. macOS는 당시 미실행이며 원격 CI 통과로 따로 확인해야 한다.

DELIVERY-001은 두 부모 이력을 보존하여 후보를 병합하고 정상 hook 후 기존 feature 브랜치에 push한다. CI는 한 번 고정한 최신 정식 VS Code와 같은 tgz·VSIX 쌍을 양 OS에 전달하고 소스·파일 해시를 확인한 뒤 전체 검사, 독립 MCP, 최소/최신 실제 설치·기능·정리를 실행한다. CI의 새 산출물 해시를 과거 로컬 파일 해시와 같다고 주장하지 않는다. 모든 필수 검사가 통과한 뒤 PR #25에 실제 Actions URL·소스·환경·해시·결과를 기록하고 리뷰 준비 상태로 전환한다. 미실행·실패·스킵은 통과가 아니다.

게시 권한은 별도의 미확인 gate다. npm 이름 조회 결과와 Marketplace verify-pat 성공만으로 게시 권한을 주장하지 않는다. 실제 npm/Marketplace 게시, main 병합, force push, 작업 공간 삭제는 승인 범위 밖이다.

성능의 알려진 한계도 유지한다. 현재 제한 표본 Hover API 중앙값 17.9초·p95 85.9초이며 정식 반복 전체와 macOS 성능 캠페인은 미측정이다. 성능 목표를 달성했다고 표시하거나 이 전달 작업을 최적화로 확대하지 않는다.

## 최초 계획 기록

아래 내용은 2026-09-13 최초 계획의 원문 기록이다. 현재 버전·지원 범위·검증 상태와 전달 권한은 위 intent/2 및 연결된 실행 결과가 우선한다.

# COD-28 — [25] 배포 패키지·VSIX·지원 OS 최종 검증과 릴리스 준비

h2. 목표

지원한다고 명시할 환경에서 실제 설치·실행 가능한 첫 배포물을 준비한다.

h2. 작업 순서와 선행 조건

권장 순서 25/25 · 3단계 · 상위 COD-3

- [COD-27|https://seojaewan.atlassian.net/browse/COD-27] — MCP 종단·동시 실행·복구·성능 회귀 검증
- [COD-20|https://seojaewan.atlassian.net/browse/COD-20] — 실제 VSIX 기능·IDE 응답성·지원 하한 검증

h2. 구현 범위

- co-documentation 패키지의 codocs bin·빌드 JS·가이드/예시 포함을 검증하고 배포 명칭 일치 확인.
- VSIX 최소 후보/최신 VS Code와 독립 MCP Node24.x 설치·실행 시험.
- Windows/macOS/Linux 로컬 디스크의 경로·권한·줄바꿈·감지·생성/교체·멀티프로세스 회귀.
- 루트 README의 설치/클라이언트 설정/프로젝트 루트/지원범위/복구 안내와 의존성 잠금·버전 기록.
- npm 이름 사용 가능 여부와 Marketplace 게시 메타데이터 확인, 릴리스 체크리스트·검증 결과 준비.

h2. 검증 시나리오와 기대 결과

- 깨끗한 환경에서 패키지와 VSIX 산출물만으로 연결·핵심 흐름이 성공한다.
- 한글/공백 경로·프로젝트 격리·다중 인스턴스와 OS별 비덮어쓰기 생성을 확인한다.
- 실측 지원 환경/성능과 문서 주장에 차이가 없고 WSL/컨테이너/SSH·네트워크 폴더를 검증 없이 보장하지 않는다.

h2. 완료 기준과 산출물

- 재현 가능한 배포 산출물·설치 검증·지원 매트릭스·알려진 제한·릴리스 준비 결과가 있다.
- 이 이슈 등록은 npm/Marketplace 실제 게시 실행이 아니다. 게시 단계는 준비 결과와 당시 사용자 지시를 기준으로 수행한다.
- 구현·테스트·공개 함수 JSDoc·해당 기능의 `.codocs` 담당 문서를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- 최소 VS Code 하한·정확한 지원 OS/아키텍처는 실제 시험한 범위로 확정한다.

## 문서 기준

현재 계약의 기준 원문은 로컬 `.codocs`다. 문서 역할과 갱신은 [문서 컨벤션](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/development/documentation-convention.yaml)을 따른다.

구현·테스트·공개 함수 JSDoc와 해당 기능의 `.codocs` 담당 문서를 함께 갱신한다. 내부 패키지·기능별 README는 만들지 않으며, 루트 README와 사용자 가이드는 사용자 안내에 영향이 있을 때 갱신한다.

과거 Wiki revision은 당시 결정·계획의 참고 근거이며 현재 계약을 소유하지 않는다. 구현 범위·진행·검증 증거는 이슈와 PR에서 추적한다.

### 과거 Wiki와 추적 근거

- Codocs 배포와 지원 환경 검증 (codocs-release-support)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-9851-7a49-abd4-0c44fb8a51a5","revision":"01a09980-9851-7e92-b590-297955d7ce38"}}}
- Codocs 개발 환경과 코드·테스트 컨벤션 (codocs-development-conventions)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-937a-7757-adda-29dfac9b8d39","revision":"01a09980-937a-7e7d-ad2d-6bf9ec3795f1"}}}
- Codocs 제품 목적과 구현 범위 (codocs-product-scope)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-c605-73f4-8247-c81e1420a61e","revision":"01a0997a-c605-7df5-a575-a46c6e246d2a"}}}

2026-09-13 최초 계획을 바탕으로 현재 로컬 `.codocs` 계약에 따라 진행하는 실행 작업이다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-28

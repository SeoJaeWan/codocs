# COD-32 — 최초 색인 구성 중 변경 반영 및 회귀 테스트 보강

h2. 문제

WorkspaceQuerySession이 최초 loadWorkspace 완료 후 watcher를 시작·구독한다. 첫 파일 읽기 중 수정하거나 첫 디렉터리 열거 중 문서를 생성하면 오래된 결과를 ready/complete로 게시하고 이후 조회에서도 재사용한다. 수동 refresh는 변경을 반영한다.

h2. 확인 근거

main b0d03a862424a14fca6a1f1a86034114d56cc717에서 실제 파일과 공개 조회 API로 재현했다. 변경 시 watcher.start 호출은 0회다. macOS에서 CHOKIDAR_USEPOLLING=true로 실행한 진단 4개 중 초기 수정·생성 2개가 실패하고 대조군 2개는 통과했다. 같은 조건의 기존 query 테스트 39개는 통과했다. Windows 직접 검증은 아직 없다.

h2. 작업 범위

문서 읽기 전에 감시와 구독을 준비하고, 초기 조회 중 변경을 수집·재확인한 뒤 조회 결과에 반영한다. 초기화 종료와 이후 감시 사이의 인계를 검증한다. 수정·생성 재현을 정규 회귀 테스트로 추가하고 삭제·교체·외부 연결 대상·초기 부재·오류·close 영향을 검토한다. Windows/macOS와 지원 Linux 환경을 구분하여 검증하고 성능은 측정값으로 보고한다.

h2. 관련 작업과 산출물

PR #13 후속이며 PR #29의 watcher 단일화와 별도 작업이다. 이번 작업은 query 초기화 순서와 회귀 검증을 소유하고, watcher 구조·감시 방식 선정은 #29와 조율한다. 기존 .codocs/workspace/indexing/index-refresh.yaml의 초기 구성 중 변경 반영 계약을 이행한다. 우선 기존 형식의 Draft Workplan PR로 계획과 재현 근거를 등록하며 제품 수정은 아직 진행하지 않는다.

관련 PR: https://github.com/SeoJaeWan/codocs/pull/13 및 https://github.com/SeoJaeWan/codocs/pull/29

## Jira

- https://seojaewan.atlassian.net/browse/COD-32

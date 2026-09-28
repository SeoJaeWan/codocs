# Hover 응답성 개선 및 PR·배포 CI 분리 계획

## 목표와 현재 상태

Codocs 0.0.1 사용 중 링크 이동은 빠르지만 마우스 Hover 정보가 늦게 표시되는 문제를 조사하고 개선한다. PR과 main에서 반복하는 전체 검증을 목적에 따라 분리하며, JavaScript Action의 Node 20 런타임 경고를 해소한다.

이 PR은 검토 결과와 후속 작업계획만 기록한다. 제품 코드, 워크플로, 저장소 보호 규칙, 배포 버전은 변경하지 않는다. 성능 개선이나 CI 시간 단축을 완료했다고 판정하지 않는다. 별도 Jira 번호는 부여하지 않는다.

## 검토 기준과 확인 결과

- 기준 소스: main `49a494d144cf29e5b5ef1ebc2f0f78f8ff5063cf`, 공개 버전 0.0.1.
- 검토일: 2026-09-28.
- [PR 실행 36360131698](https://github.com/SeoJaeWan/codocs/actions/runs/36360131698): 생성부터 완료까지 12분 17초.
- [main 실행 36360869864](https://github.com/SeoJaeWan/codocs/actions/runs/36360869864): 생성부터 완료까지 13분 11초.
- 두 실행의 기록이며 전체 실행 평균이나 향후 실행 시간 보장은 아니다.
- 조회 당시 main은 `protected: false`, 저장소 ruleset은 빈 목록이었다. 구현 시 실제 적용 상태를 다시 확인한다.

### Hover 처리에서 확인한 반복 작업

- `packages/core/src/matcher/index.ts`의 `matchCode`는 문서의 현재·이전 ID를 순회하며 `findMatches`를 호출한다. `findMatches` 내부에서 같은 코드 원문을 `tokenizeCode(source)`로 반복 분석한다.
- `packages/language-server/src/server-session/index.ts`의 코드 Hover는 전체 원문 매칭 뒤 후보와 관계 문서를 조회하고 Markdown 및 원문 링크를 만든다.
- 새 선택을 발급하는 `packages/workspace/src/query/index.ts`의 `captureCandidate`는 `#candidatePaths`에서 전체 코드 매칭을 다시 수행하며, 동기 파일 읽기·파일 식별자 확인·revision 해시 계산도 실행한다.
- `SourceSelections.capture`는 같은 출처 버전·대상·색인 버전의 기존 선택을 재사용한다. 따라서 모든 반복 Hover가 항상 모든 선택을 다시 생성한다고 단정하지 않는다.
- 이미 발급된 링크의 이동은 선택 대상 확인 중심이며, YAML 참조는 코드 전체 매칭과 다른 경로를 사용한다. 링크 이동과 Hover의 체감 차이는 이 구조와 양립한다.
- 위 항목은 코드상 병목 후보다. 현재 사용자 환경의 단계별 CPU·IO·대기 시간이나 실제 팝업 표시 지연을 새로 측정한 결과가 아니다.

### CI 구성과 단계별 시간

현재 `.github/workflows/test.yml`은 PR, main push, 수동 실행에서 같은 구성을 실행한다. 먼저 Windows에서 최신 VS Code stable과 하나의 tgz·VSIX 쌍을 고정하고, 양 OS가 같은 파일의 SHA-256 및 소스 blob을 확인한 뒤 검사한다. 두 OS는 병렬이지만 각 OS 내부 단계는 직렬이다.

| PR 실행 단계                         |              Windows |     macOS |
| ------------------------------------ | -------------------: | --------: |
| 후보 생성 job                        | 48초, 공통 선행 작업 | 해당 없음 |
| 타입·lint·포맷·빌드·로직·패키지 검사 |                260초 |     203초 |
| 독립 설치 MCP 및 VSIX 메타데이터     |                  3초 |       3초 |
| 최소 VS Code 기능                    |                144초 |      97초 |
| 최소 VS Code 종료·정리               |                 42초 |      43초 |
| 고정 최신 VS Code 기능               |                150초 |     124초 |
| 고정 최신 VS Code 종료·정리          |                 49초 |      47초 |

준비·설치·artifact 전송·대기 시간은 위 주요 단계와 별개다. Windows 소스 검사 260초 중 개발 규칙·빌드·패키지 계약 검사 3개 파일의 실행은 약 127초다. 의존성 설치는 job당 약 10~12초로 주된 병목이 아니다.

현재 실행 간 pnpm·VS Code 다운로드 캐시와 PR 후속 push에 따른 이전 실행 취소 설정이 없다. 실행기 자체에는 같은 job 안에서 재사용하는 VS Code 로컬 캐시가 있다. 현재 CI에는 Hover 지연 목표를 판정하는 성능 검사가 없다.

## 후속 구현 범위와 순서

### 1. Hover 측정과 중복 처리 개선

1. 동일한 소스·VSIX·데이터·VS Code 버전으로 기준 결과를 확보한다. 최초, 같은 위치 재진입, 다른 위치, 편집 직후를 나누고 코드 파일 크기·문서 수·관계 링크 수를 기록한다.
2. 초기 준비, 원문 분석·매칭, 상세 조회, 선택 발급·파일 확인, API 반환, 실제 팝업 표시를 구분한다. API 반환을 화면 표시 완료로 대신하지 않는다.
3. 코드 원문 분석을 요청당 한 번으로 줄이고 ID 분석 결과의 색인 단위 재사용을 검토한다. 문서 URI·문서 버전·색인 버전을 기준으로 매칭 결과를 재사용하고, 링크별 반복 매칭을 줄인다.
4. 동기 파일 확인이 차지하는 시간을 측정한 뒤 중복 제거·비동기화·표시와 클릭 확인의 책임 분리를 검토한다. 파일 변경·교체·삭제와 경로 경계 확인을 무조건 제거하지 않는다.
5. 같은 조건의 전후 결과와 정확성·취소·오래된 응답 폐기 회귀를 확인한다. 정식 반복 측정은 일반 기능 CI와 커밋 훅에 추가하지 않고 명시적으로 실행한다.

원문 수정, 외부 문서 변경, 참조 변경, 파일 이동·삭제, 서버 재시작, workspace 변경 때 캐시와 선택이 적절히 무효화되어야 한다. 현재·이전 ID의 매칭, 충돌·부분 색인 안내, 원문 링크의 안전한 확인 계약을 유지한다.

### 2. Node 24 기반 Action으로 갱신

프로젝트 실행 Node는 이미 24.21.0이다. 경고는 Action의 `runs.using` 선언과 관련되므로 `setup-node`의 `node-version` 변경이나 경고 숨김으로 처리하지 않는다.

검토일에 공식 릴리스와 `action.yml`에서 Node 24 사용을 확인한 후보는 다음과 같다. 구현 시 지원 조건과 변경 사항을 다시 확인하고 검증한 버전 또는 commit SHA를 선택한다. 프로젝트 Node·pnpm 버전의 동반 업그레이드는 별도 판단한다.

| Action                    | 현재 | 확인한 갱신 후보                                                           |
| ------------------------- | ---- | -------------------------------------------------------------------------- |
| actions/checkout          | v4   | [v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)          |
| actions/setup-node        | v4   | [v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0)        |
| actions/upload-artifact   | v4   | [v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1)   |
| actions/download-artifact | v4   | [v8.0.1](https://github.com/actions/download-artifact/releases/tag/v8.0.1) |
| pnpm/action-setup         | v4   | [v6.1.0](https://github.com/pnpm/action-setup/releases/tag/v6.1.0)         |

[GitHub의 Node 20 제거 안내](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/)에 따라 갱신한다. checkout의 PR 동작, pnpm 10.34.5 설치, hidden file을 포함한 artifact 전달, 양 OS의 파일 해시·소스 동일성을 검증한다.

### 3. PR 검사와 배포 검증 분리

| 시점             | 제안하는 역할                                                                 |
| ---------------- | ----------------------------------------------------------------------------- |
| PR 업데이트      | 소스 검사, 양 OS 핵심 회귀, 주요 설치 VS Code 기능 확인                       |
| 일반 main 병합   | PR 보호 조건을 갖춘 뒤 전체 재실행 생략 또는 짧은 설치·실행 확인              |
| 명시적 배포 준비 | 배포 커밋으로 후보 생성, 양 OS·최소/최신 VS Code·독립 MCP·종료 정리 전체 검증 |

- main 전체 검사를 생략하기 전에 PR 경유, 필수 검사 통과, 최신 main과의 통합 검증을 병합 조건으로 정한다. 직접 push와 검사 우회 정책도 함께 확인한다.
- GitHub의 기본 PR 검사는 임시 병합 결과를 대상으로 하며, 검사 후 base 변경은 최종 결과를 바꿀 수 있다. 최신 base 요구 또는 merge queue 등 실제 저장소에 맞는 방식을 선택한다. [공식 이벤트 설명](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
- 실제 배포 커밋·소스 blob·파일 해시와 검증 결과의 연결을 보존한다. PR 산출물을 승격하려면 최종 소스 동일성을 확인하고, 그렇지 않으면 배포 커밋에서 새 후보를 만들어 검증한다.
- 타입·lint·포맷 등 OS 의존성이 낮은 검사는 한 번으로 모으고, 파일 감시·권한·경로·프로세스 검사는 양 OS에서 유지한다.
- 개발 규칙 자체와 무거운 패키지 계약 검사의 실행 조건을 분리한다. 변경 경로를 놓치거나 필수 check가 영구 pending이 되지 않도록 최종 집계 check를 설계한다.
- 소스 검사와 설치 VS Code 검사의 job 병렬화, PR별 이전 실행 취소, 정확한 OS·아키텍처·버전·lockfile에 따른 캐시를 검토한다. 병렬화의 대기 시간 절감과 전체 러너 사용량은 별도로 비교한다.
- 정상 기능 실행의 종료·잔류 프로세스 확인은 유지한다. 네 종류의 의도적 실패·취소 검사를 매 PR의 모든 버전에 실행할지, 관련 변경과 배포 검증으로 제한할지 구분한다.
- 실행 시간 개선은 같은 종류의 변경에 대한 여러 실행을 비교해 판정한다. 단일 실행이나 캐시 적중 실행만으로 개선율을 주장하지 않는다.

## 기존 작업과의 관계

- [PR #25 / COD-28](https://github.com/SeoJaeWan/codocs/pull/25)의 동일 배포 후보를 양 OS에서 검증하는 원칙을 유지하며 실행 시점을 분리한다.
- [PR #33](https://github.com/SeoJaeWan/codocs/pull/33)의 Hover 성능 측정 계획과 기존 설치 VSIX 실행기를 참고한다. 새 독립 실행기를 중복 제작하지 않는다.
- [PR #34](https://github.com/SeoJaeWan/codocs/pull/34)는 macOS 실제 VSIX·IDE 응답성 실측 후속이다. 측정 범위와 결과를 공유하되 이 계획의 최적화 완료와 같은 의미로 취급하지 않는다.
- [PR #29 / COD-31](https://github.com/SeoJaeWan/codocs/pull/29)의 watcher 변경과 캐시 무효화 경계를 맞춘다. watcher 전체 개편을 이번 최적화의 필수 선행 조건으로 두지 않는다.
- 구현은 Hover 최적화와 CI 개편을 별도 PR로 나눠 검증한다. 계약 변경 시 담당 `.codocs`, 공개 함수 JSDoc, 인접 테스트를 함께 갱신하고 작업 결과는 PR에서 추적한다.

## 완료 기준

- Hover 전후 측정에 동일 입력·환경·아티팩트 정보와 정확성 결과가 있으며, 남은 미측정 항목을 구분한다.
- 중복 분석 감소와 함께 수정·삭제·재시작·취소·오래된 선택의 회귀를 통과한다.
- Action Node 20 경고가 사라지고 양 OS의 후보 전달·설치 검증을 통과한다.
- PR 필수 검사와 main 병합 정책이 실제로 연결되며 배포 후보의 소스·바이트 추적을 보존한다.
- CI의 대기 시간, job별 시간, 총 러너 실행 시간을 전후 비교한다. 정확성을 포기하거나 시험을 누락한 결과를 속도 개선으로 계산하지 않는다.

## 이번 계획 PR의 검증 범위

제품·CI 구현과 성능 실측은 아직 수행하지 않았다. 계획 문서의 형식과 diff를 검사하며, 실제 커밋 훅·원격 CI 실행 결과는 PR 본문과 Checks에서 구분해 기록한다.

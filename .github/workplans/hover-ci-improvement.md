# PR CI·자동 배포 정리 계획

## 목표와 현재 상태

PR과 병합 후 반복하는 전체 검증을 정리하고 develop의 Changesets를 봇이 릴리스 PR으로 모아 main 병합 시 자동 배포하며, JavaScript Action의 Node 20 런타임 경고를 해소한다. 사용자 검토에 따라 이번 작업은 CI·자동 배포 정리로 한정한다. Hover를 포함한 제품 성능 측정·분석·최적화와 측정 도구 개선은 범위에서 제외한다. 기존 테스트 자체의 최적화도 후속으로 미룬다.

이 문서는 최초 검토와 확정 정책을 보존하고 아래 로컬 구현 결과·운영 전환 경계를 연결한다. CI 시간 단축을 완료했다고 판정하지 않는다. 별도 Jira 번호는 부여하지 않는다.

## 검토 기준과 확인 결과

- 기준 소스: main `49a494d144cf29e5b5ef1ebc2f0f78f8ff5063cf`, 공개 버전 0.0.1.
- 검토일: 2026-09-28.
- [PR 실행 36360131698](https://github.com/SeoJaeWan/codocs/actions/runs/36360131698): 생성부터 완료까지 12분 17초.
- [main 실행 36360869864](https://github.com/SeoJaeWan/codocs/actions/runs/36360869864): 생성부터 완료까지 13분 11초.
- 두 실행의 기록이며 전체 실행 평균이나 향후 실행 시간 보장은 아니다.
- 조회 당시 main은 `protected: false`, 저장소 ruleset은 빈 목록이었다. 구현 시 실제 적용 상태를 다시 확인한다.

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

현재 실행 간 pnpm·VS Code 다운로드 캐시와 PR 후속 push에 따른 이전 실행 취소 설정이 없다. 실행기 자체에는 같은 job 안에서 재사용하는 VS Code 로컬 캐시가 있다.

`pull_request`에 이벤트 종류나 Draft 제외 조건이 없어 Draft PR 생성·재개·추가 push에도 후보 생성과 양 OS 전체 검사가 실행된다. 반대로 `ready_for_review`는 기본 이벤트에 포함되지 않으므로 Draft 제외 조건만 추가하면 새 커밋 없이 리뷰 준비로 전환할 때 검사가 시작되지 않는다. 계획 문서만 바꾸는 PR도 현재는 같은 전체 검사를 실행한다.

## 후속 구현 범위와 순서

### 1. Node 24 기반 Action으로 갱신

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

### 2. PR CI와 자동 배포 정리

| 시점                      | 확정한 역할                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| Draft PR 생성·업데이트    | 자동 검사와 검사 러너를 모두 생략                                  |
| 기능·수정 PR → develop    | Changesets와 코드를 함께 검토하고 리뷰 준비 시 전체 PR CI          |
| develop 병합              | 전체 테스트 재실행·게시는 생략하고 봇이 미출시 기록을 취합         |
| 임시 릴리스 브랜치 → main | Draft PR 하나를 갱신하고 리뷰 준비 시 최종 버전으로 전체 PR CI     |
| 릴리스 PR의 main 병합     | 전체 테스트 재실행 없이 버전이 증가한 제품만 최종 검증 파일로 게시 |
| main → develop 동기화 PR  | 전체 PR CI 후 릴리스 결과를 반영하고 다음 릴리스 변경을 보존       |

- 사용자 검토에서 각 PR의 최신 대상 브랜치 반영과 필수 PR CI 통과를 병합 조건으로 적용하고, develop·main 병합 후 자동 테스트 CI는 생략하기로 확정했다. 짧은 설치 확인도 별도로 추가하지 않는다. 두 브랜치의 보호 규칙이 실제 적용된 것을 확인한 뒤 병합 후 push 자동 검사를 제거한다. main 병합 후의 버전 변경 판정·자동 게시는 이 테스트 재실행과 구분한다.
- develop·main 직접 push와 PR·필수 검사 우회는 관리자와 릴리스 봇에게도 허용하지 않기로 확정했다. 모든 변경은 PR과 필수 CI를 거치며 보호 규칙을 관리자에게도 적용한다. 사람의 리뷰 승인 의무는 이 합의에 포함하지 않는다. 현재는 계획 합의이며 실제 저장소 보호 설정은 구현 단계에서 적용·검증한다.
- GitHub의 기본 PR 검사는 임시 병합 결과를 대상으로 한다. 필수 검사는 최신 base 반영을 요구하는 strict 방식으로 연결한다. PR CI 통과 뒤 대상 브랜치가 바뀌면 PR 브랜치를 업데이트하고 같은 PR CI를 다시 통과해야 병합할 수 있다. 검사 대상이 바뀌지 않았다면 병합 직전 별도의 CI를 추가하지 않는다. 이번 방향은 merge queue 도입을 요구하지 않는다. [공식 이벤트 설명](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
- 최종 릴리스 PR에서 전체 검증한 tgz·VSIX를 보관하고 실제 배포에 그대로 재사용한다. develop에 반영한 개별 기능 PR의 파일로 대신하지 않는다. 정상 배포 경로에서 재빌드나 전체 테스트 재실행은 요구하지 않는다. 실제 병합 커밋의 소스·최종 통과한 PR 실행·후보 파일 해시의 연결은 자동으로 확인하며, 잘못된 실행의 후보를 선택하거나 대응하는 후보가 없으면 임의로 게시하지 않는다. Squash 등으로 달라지는 commit 번호만으로 소스 불일치로 판단하지 않는다.
- npm의 co-documentation과 Marketplace의 seojaewan.codocs는 하나의 자동 배포 흐름에서 관리하되 버전은 독립적으로 관리한다. main 병합 전후 각 대상 manifest의 버전을 비교하여 npm만 증가하면 npm만, 확장만 증가하면 Marketplace만, 둘 다 증가하면 두 곳 모두 게시한다. 모두 동일하면 게시하지 않는다. 두 대상의 버전 일치는 요구하지 않으며, 변경 대상별 유효한 버전 증가와 이미 게시된 버전의 충돌을 확인한다. 소스 경로별 CI 선택과는 별개로 PR 전체 검사는 그대로 유지한다.
- 배포할 버전은 릴리스 PR에서 확정하고 해당 PR CI가 검증한 tgz·VSIX 중 필요한 파일만 재사용한다. 수동 전체 재검증은 기본 배포 절차에서 제외한다. 두 게시 대상의 개별 성공·실패를 기록하고 부분 실패 시 이미 성공한 대상을 중복 게시하지 않도록 재시도를 설계한다. 현재 0.0.1에 고정된 후보 파일명·검증 기대값은 대상별 manifest 버전을 따르도록 변경한다. 공통 코드 변경의 배포 대상과 변경 수준은 기능 PR의 Changesets에 명시하며, 코드 경로만으로 이를 추정하지 않는다.
- 사용자 검토에서 타입·lint·포맷 검사는 CI에 유지하되 OS별로 반복하지 않고 공통 job에서 한 번만 실행하기로 확정했다. 검사할 OS와 job 구성은 구현에서 정한다. 나머지 테스트 자체의 최적화는 후속으로 미루며 이번 검토에서 기존 검사 범위를 축소하지 않는다.
- 개발 규칙·패키지 계약 검사를 포함한 공통 PR 검사는 변경 경로별로 선택하지 않는다. 필요한 job의 실패·취소·예상 밖 생략을 통과로 처리하지 않도록 최종 집계 check를 설계한다.
- PR별 이전 실행 취소를 적용한다. 소스·설치 VS Code 검사의 추가 job 병렬화와 캐시는 미확정 개선 후보로 남기며 이번 작업의 필수 범위로 두지 않는다. 추후 적용 시 대기 시간 절감과 전체 러너 사용량은 별도로 비교한다.
- 정상 기능 실행의 종료·잔류 프로세스 확인과 네 종류의 의도적 실패·취소 검사도 현재 범위를 유지한다. 검사 시나리오·반복 횟수·실행기·내부 재빌드 최적화는 후속 작업에서 검토한다.
- 실행 시간 개선은 같은 종류의 변경에 대한 여러 실행을 비교해 판정한다. 단일 실행이나 캐시 적중 실행만으로 개선율을 주장하지 않는다.

#### Changesets와 봇의 릴리스 PR

2026-09-28 사용자 검토에서 develop 통합·main 릴리스와 Changesets 누적 방식을 확정했다. 기능 PR마다 버전 숫자를 직접 변경하는 이전 설명은 이 흐름으로 대체한다.

1. 배포할 기능·수정 PR에 대상 제품·patch/minor/major·변경 설명을 담은 개별 Changesets를 포함해 develop에 반영한다. 배포가 필요 없는 변경에 제품 버전 증가를 요구하지 않는다.
2. develop 병합을 받은 봇이 임시 릴리스 브랜치에서 미출시 기록 전체를 취합한다. 대상별 버전·changelog를 갱신하고 소비한 기록을 정리하여 main을 대상으로 Draft 릴리스 PR 하나를 생성·갱신한다. 별도 버전 준비 PR을 develop에 병합하는 단계는 두지 않는다.
3. 준비 중 develop의 실제 버전과 개별 기록은 유지한다. 봇은 이전에 생성한 다음 버전을 연속 증가시키지 않는다. 예를 들어 같은 제품의 patch 기록 a~e는 한 번의 patch 릴리스로 모은다.
4. 출시할 작업이 준비되면 사용자가 릴리스 PR을 리뷰 준비로 전환한다. 최종 버전·changelog가 포함된 소스로 전체 CI와 후보 생성을 수행하며, 추가 코드·버전 변경에는 최신 CI를 다시 요구한다. 봇의 PR 생성·갱신은 자동 병합이나 출시 승인이 아니다.
5. main 병합 후 최종 릴리스 PR의 검증 파일만 게시한다. main의 버전·changelog·소비 기록은 동기화 PR을 통해 develop에 반영하며, 그 사이 추가된 다음 릴리스용 코드와 Changesets는 보존한다.

Draft 릴리스 PR의 제품 검사는 모두 생략하되 develop 병합을 처리하는 봇의 PR 관리 작업 자체는 실행한다. 봇은 보호된 develop·main에 직접 쓰거나 필수 검사를 우회하지 않는다. 기능·릴리스·동기화 PR 모두 같은 전체 검사를 요구하므로 기존 단일 브랜치 흐름보다 PR 검사 횟수가 늘 수 있다. 병합 후 테스트 재실행을 없애는 것과 PR 수에 따른 검증 비용을 구분한다.

구현에서는 공식 Changesets CLI와 version Action의 script·pr-base-branch·pr-draft 기능을 우선 사용하여 develop 입력·main 대상의 릴리스 PR 갱신을 연결한다. 버전 계산·changelog·PR 관리를 자체 구현하지 않으며 프로젝트 연결 도구는 최신성·보호·동기화·게시 후보 검증을 담당한다. 현재 비공개 workspace 이름과 실제 공개 npm·Marketplace 대상의 연결, 내부 의존성에 따른 버전 변경 전파를 확인하여 두 제품의 독립 버전 정책을 보존한다. 봇이 만든 커밋에서도 ready 전환·추가 push의 필수 CI가 실제 실행되는지 확인한다.

릴리스 병합 직후 develop에 남은 이미 소비한 기록이 다시 버전 증가에 사용되지 않게 게시·동기화·다음 PR 준비 순서를 조정한다. 실행 재시도·연속 병합·중단에서 PR 중복 생성, 버전 중복 증가, 새 Changesets 삭제가 없어야 한다. 게시 부분 실패는 해당 릴리스의 검증 파일로 복구하며 새 후보 생성으로 대체하지 않는다.

[Changesets 버전 갱신 안내](https://changesets.dev/guide/versioning-and-publishing), [공식 자동화 안내](https://changesets.dev/guide/automating)를 구현 근거로 사용한다. 기능 PR별 Changesets 누적과 a~e를 묶은 버전 계산, 동일 Draft PR 갱신, 제품별 단독·동시 배포, main→develop 동기화 중 새 변경 보존을 검증한다.

#### 불필요한 자동 실행을 줄이는 조건

2026-09-28 사용자 검토에서 Draft PR의 자동 검사는 모두 생략하기로 확정했다. 타입·lint·포맷·문서 검사도 자동 실행하지 않으며, 변경 범위 판정·최종 집계를 위한 별도 러너도 시작하지 않는다.

같은 날 PR 상태 전환·중복 실행 정책도 확정했다. 리뷰 준비 전환 시 추가 push 없이 검사하고, Draft 복귀 시 진행·대기 중인 자동 검사를 취소한다. 같은 PR의 추가 push는 이전 검사를 취소하고 최신 변경을 검사한다. PR 닫기·병합 시 남은 PR 자동 검사를 취소하며, 다시 열 때는 Draft면 생략하고 리뷰 준비 상태면 검사한다. 취소는 해당 PR의 자동 검사에만 적용하며 다른 PR·main·수동 배포 검증에 영향을 주지 않는다.

변경 내용별 검사 분기는 도입하지 않기로 확정했다. 리뷰 준비 PR은 계획 문서만 바뀐 경우까지 모두 동일한 PR CI를 실행한다. 변경 파일 분류 job과 경로별 검사 생략 규칙은 만들지 않는다.

추가 실행 시간 검토 후 테스트 자체의 개선은 후속으로 미루기로 했다. [PR #35 실행 36363291895](https://github.com/SeoJaeWan/codocs/actions/runs/36363291895)은 전체 13분 4초였고, Windows의 `pnpm check` 4분 38초·VS Code 기능 합계 5분 19초, macOS의 각각 3분 51초·3분 39초가 주요 소요 시간이었다. 결과 업로드는 각각 1초·3초였다. 단일 실행 기록이며 평균은 아니다. 이번에는 확정한 Draft 생략·상태 전환·중복 실행 취소·공통 정적 검사 1회 실행을 우선한다.

결과 표시와 증거 보관은 다음과 같이 합의했다.

- CI 성공 시 PR 댓글에 검사 결과·OS별 시간·실행 링크를 간단히 표시하고 상세 결과 파일의 별도 업로드는 생략한다. 일반 콘솔 로그는 Actions 실행 링크에서 확인한다.
- CI 실패 시 같은 댓글에 실패 단계·실행 링크를 표시하고 원인 분석에 필요한 상세 JSON·프로세스 기록 등 최소 증거 파일만 업로드한다.
- PR당 결과 댓글 하나를 갱신하며 추가 push마다 새 댓글을 누적하지 않는다. 취소되거나 늦게 완료된 이전 실행이 최신 실행의 결과를 덮어쓰지 않도록 PR 최신 상태와 실행 순서를 확인한다.
- npm·Marketplace 게시 결과는 대상별 버전·성공·실패를 댓글에 표시한다. 두 대상 중 변경되지 않아 게시하지 않은 대상도 성공한 배포로 오인하지 않게 구분한다.
- 검증한 tgz·VSIX와 소스·파일 해시·검증 실행 연결 정보는 배포용으로 보관한다. 성공 시 생략하는 상세 로그 업로드와 배포 후보 보관을 구분하며, 배포 단계에서 같은 후보를 재사용한다.

- PR 이벤트는 `opened`, `synchronize`, `reopened`, `ready_for_review`, `converted_to_draft`, `closed`를 다룬다. PR이 열려 있고 Draft가 아닌지를 job 시작 전 조건으로 판정하여 Draft·종료 이벤트의 모든 자동 검사 job을 생략한다. workflow 실행 기록이나 skipped 표시가 남는 것과 러너를 사용하는 것을 구분한다.
- 상태 전환·종료 이벤트에서도 이전 실행 취소가 동작하는지 검증한다. Draft·닫힌 PR에 검사 러너를 새로 시작하지 않으면서 진행·대기 중인 기존 PR 자동 검사를 정리한다.
- 자동 PR 실행은 workflow와 PR 번호를 기준으로 같은 concurrency 그룹을 사용하고 이전 실행을 취소한다. 이벤트 종류·커밋 SHA를 그룹에 넣어 전환·추가 push의 취소가 분리되지 않게 한다. main·수동 실행은 자동 PR 실행의 취소 범위에서 분리한다. [공식 concurrency 설명](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- 리뷰 준비 PR의 검사 선택에 `paths`·`paths-ignore`나 변경 파일 분류를 사용하지 않는다. 각 검사에 대해 공통 PR 검사·배포 검증의 실행 시점과 OS·VS Code 버전을 표로 확정한다.
- 최종 집계 check는 필요한 job의 실패·취소·예상 밖 생략을 통과로 처리하지 않는다. Draft에서 생략된 결과가 리뷰 준비 전환 후 필요한 검사를 대체하지 않는지도 실제 병합 조건과 함께 검증한다.
- 제목·본문·라벨만 바뀌었을 때 제품 검사를 재실행하지 않는다. base 변경이나 merge queue를 병합 정책에 사용한다면 해당 통합 결과 검증 이벤트를 별도로 지원한다. Draft의 검사가 필요할 때는 대상 ref·SHA와 검사 범위를 명시한 수동 실행으로 허용하며, 수동 실행이 자동 PR 필수 검사를 대체한다고 간주하지 않는다.

구현 검증은 Draft 생성·추가 push·재개, 새 커밋 없는 리뷰 준비 전환, 실행 중 Draft 복귀, 연속 push, PR 닫기·병합·리뷰 준비 상태로 재개, 다른 PR·main·수동 실행과의 취소 격리, 문서 전용 PR과 제품 변경 PR의 동일한 검사 실행, 필수 job 실패·취소를 포함한다. 각 경우의 실행·생략·취소 job과 필수 check 결과를 확인한다. 실행한 job의 속도뿐 아니라 자동 실행 횟수와 Draft 생략·중복 실행 취소에 따른 러너 사용량도 기록한다.

## 기존 작업과의 관계

- [PR #25 / COD-28](https://github.com/SeoJaeWan/codocs/pull/25)의 동일 배포 후보를 양 OS에서 검증하는 원칙을 유지하며 실행 시점을 분리한다.
- CI·자동 배포 구현에서 코드 변경이 필요한 경우 담당 `.codocs`, 공개 함수 JSDoc, 인접 테스트를 함께 갱신하고 작업 결과는 PR에서 추적한다. 기존 제품 성능 측정·최적화 작업은 이번 변경의 의존성이나 완료 조건으로 두지 않는다.

## 완료 기준

- Action Node 20 경고가 사라지고 양 OS의 후보 전달·설치 검증을 통과한다.
- PR 필수 검사와 develop·main 병합 정책이 실제로 연결되며 배포 후보의 소스·바이트 추적을 보존한다.
- Draft·중복 실행의 불필요한 자동 검사를 줄이고, 리뷰 준비 PR은 변경 내용과 관계없이 동일한 CI를 실행하며 필수 check가 pending에 남거나 잘못 통과하지 않는다.
- 기능별 Changesets를 같은 Draft 릴리스 PR에 누적하고, 최종 버전·changelog·소비 기록을 main 병합 후 develop에 안전하게 동기화한다.
- npm·Marketplace의 독립적인 버전 변경에 따라 필요한 대상만 자동 게시하고, 부분 실패 재시도에서 성공한 대상을 중복 게시하지 않는다.
- PR 결과 댓글을 하나로 갱신하고 실패 진단 자료와 배포 후보를 필요한 범위로 보관한다.
- CI 정리 효과를 확인하기 위해 CI의 대기 시간, job별 시간, 총 러너 실행 시간을 전후 비교한다. 정확성을 포기하거나 시험을 누락한 결과를 속도 개선으로 계산하지 않는다.

## 이번 계획 PR의 검증 범위

최초 계획 검증은 문서의 형식·diff와 실제 커밋 훅에 한정됐다. 다음 실행 결과는 그 기록과 구분한다. 저장소 보호·원격 이벤트·게시 활성화는 로컬 구현 완료와 별개다.

## 로컬 구현과 통합 검증의 전달 경계

실행은 원래 checkout을 수정하지 않는 관리형 worktree에서 수행한다. TASK-001은 공식 Changesets CLI와 동적 제품 버전·후보 계약을, TASK-002는 ready PR CI·집계·단일 댓글을, TASK-003은 공식 version Action 연결·동기화·검증 파일 게시를 담당한다. INT-001은 지정된 결과를 순서대로 가져와 실제 생산·소비 계약을 연결하고 담당 정책 문서와 개발 목차를 갱신한다.

통합 정적 검사에서 App token Action의 이동 태그를 발견해 기존 결과를 보존한 별도 TASK-003-R1으로 수리했다. 세 릴리스 workflow는 공식 Node 24 기반 v3.2.0의 정확한 commit bcd2ba49218906704ab6c1aa796996da409d3eb1로 고정하고 기존 App 입력·권한을 유지한다. intent/3은 이 기계적 dependency 보강과 INT-001의 알려진 변경 재개를 기록하며 원래 계획·소스·정책은 바꾸지 않는다.
첫 정적 확인이 App Action에서 멈춰 남은 v4 태그를 놓쳤고, 다음 전체 통합 시험이 이를 거부했다. 별도 TASK-003-R2는 나머지 열 개 사용을 TASK-002와 같은 공식 Node 24 revision으로 고정하고 세 setup-node 단계의 캐시 비활성화를 명시했다. 전체 열네 사용 지점·여섯 Action 종류의 정확한 manifest·입력 호환성을 대조한 뒤 intent/4로 통합을 재개했다. 기존 결과·첫 실패는 이력으로 보존한다.

소스 패키지 버전 0.0.1과 미출시 Changeset은 유지한다. 통합 시험에서 공식 pnpm release:version으로 만든 독립 fixture의 최종 버전 0.0.2 tgz·VSIX는 실행 증거이며 공개 릴리스 후보가 아니다. 실제 CI prepare/verify·증거 기록·aggregate·archive 소비·로컬 게시 adapter가 동일 파일 해시를 사용하고 변조를 거부하는지 확인한다. 공식 Action의 실제 배포 코드는 로컬 Git·REST·GraphQL fixture에 연결하여 ready 이후 같은 PR 갱신, 오래된 준비 거부, 동시 신규 기록 보존과 다음 공식 계산을 확인한다. Windows·실제 GitHub·공개 게시 성공으로 확대하지 않는다.

기본 pnpm test는 새 tools/ci/ci-release.integration.test.mjs를 자동 포함한다. 별도 CODOCS_VERIFY_GUI=1 실행은 실제 macOS에서 후보를 한 번 조립하고 그 VSIX와 tgz로 최소 1.100.0 및 한 번 고정한 stable의 전체 기능, 같은 VSIX로 각 버전의 시작 실패·기능 실패·시간 제한·취소 정리를 직렬 확인한다. 실행 명령·소요 시간·fixture source commit/tree·제품 버전·SHA-256·GUI 결과 경로는 ignored .workbench 실행 보고서에 남긴다. pnpm check와 결과 commit의 실제 hook을 통과해야 검증된 통합 HEAD로 반환한다.

운영자는 .codocs/development/release.yaml의 활성화 순서에 따라 develop 생성, main/develop의 strict required-ci·PR 의무·관리자 보호·우회 차단, GitHub App와 제품별 게시 인증, 실제 Draft/ready/취소/양 OS·게시 재시도 검증을 완료한다. classic 보호 응답을 확인하는 현재 gate는 ruleset만으로 설정된 보호를 지원하지 않는다. 그 전에는 CODOCS_RELEASE_ENABLED를 활성화하지 않고 main push·수동 전체 Tests를 유지한다. 보호의 실제 적용을 확인한 뒤 별도 변경으로 postmerge 테스트 생략을 활성화한다.

이번 전달은 로컬 소스 통합과 검증까지다. 원격 설정·push·PR 생성·main 병합·공개 게시·배포·작업 경로 정리는 실행하지 않는다. Prepare·Shape 원본은 복구 증거로 정확한 LF UTF-8와 raw SHA-256을 보존한다. Gateway 저장은 실제 Work Item key가 없어 보류하며 임의 Jira 번호나 Memory write로 대신하지 않는다. 상세한 네 작업 결과·원본/바인딩 해시·intent/2 소유권 보강·이전 실패와 최종 결과·실제 미검증 경계는 .workbench/execution-result.md에 기록한다.

## 사용자 리뷰 후 검사 책임 분리

사용자 지시에 따라 intent/6은 릴리스 관리 회귀를 Ubuntu 24.04의 단일 job으로 분리하고 기존 MCP·VSIX·패키지 소비·VS Code 기능/종료 검사를 Windows·macOS에 유지한다. 관리 job은 모든 ready PR에서 경로 분기 없이 실행하며 required-ci·신뢰한 댓글·게시 guard도 그 결과를 요구한다. 기본 pnpm test/check는 전체 합집합을 보존하고 명시적 관리·OS 선택은 누락·중복 없이 분할한다.

GitHub run36387568137의 Windows Git 설정 장치 경로 실패는 실행별 빈 일반 Git config 파일로 수정한다. macOS의 공식 CLI shallow history deepen 실패는 관리 checkout의 fetch-depth0과 독립 재현/전체 history 검증으로 다룬다. 사용자 global/system Git 설정은 수정하지 않는다. 실제 후보 관리 adapter 검사는 설치 smoke·GUI를 실행하지 않고 두 OS receipt를 모두 fixtureOnly로 표시한다. 별도 native opt-in 진입점은 최종 버전 후보 하나를 그대로 설치하고 최소·고정 stable 기능과 네 종료 모드를 보존한다.

이 수정은 패키지 소스나 기존 native runner·기능 assertions를 변경하지 않는다. 실제 Ubuntu·Windows 수정 후 실행은 로컬 macOS 결과로 대신하지 않으며 원격 push·운영 활성화를 수행하지 않는다. 이전 소스·Prepare/Shape·구현/전달 보고서는 보존하고 새 바인딩·명령·결과는 .workbench/ci-split-r1*에 기록한다.

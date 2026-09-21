# PR #13 통합 재검증 — 2026-09-21

## 통합 범위

- 구현·성능 관찰 결과: `8fc5c76a49d934ff326bcbd7fb6f2280e3b2d20e`.
- 기존 PR #13 브랜치: `6cbe06cd844e2aa09ee84b2dceb1b16de34bb682`.
- 최신 main: `f3e8eb5f270fbcdb6c962eb06df0c299c2f93958`.
- 기존 PR 이력은 merge로 보존했다. 작업 계획의 추가 충돌은 최신 합의와 구현 결과로 정리했고, 문서 동기화 충돌은 Hover의 catalogVersion 확인과 main의 자동완성 제외 결정을 함께 유지했다.
- 제품 packages, 도구 tools, manifest, lockfile, 고정 Node 버전은 기존 검증 커밋과 동일하다. 통합은 문서와 이력에 한정한다.
- 환경: macOS Darwin 25.5.0 arm64, Node v24.21.0, pnpm 10.34.5.

## 결과

기본 전체 검사에서 중첩 파일 생성 감지 1건이 두 번 실패했다. 두 실행 모두 27개 파일 중 26개, 675개 테스트 중 674개가 통과했다. 이 실패 기록은 그대로 보존한다. 이후 원인 조사와 별도 검증 결정에 따라 현재 PR의 전달을 진행하며, 감시 문제를 해결된 것으로 표시하지 않는다.

실패 위치는 `packages/workspace/src/watcher/watcher.test.ts:61`이다. `.codocs/nested/deep/alpha.yaml`을 생성한 뒤 5초 동안 경로 알림이 없었다. 감시 구현과 테스트는 main과 동일하며 이번에 변경하지 않았다.

- 해당 테스트 파일만 실행한 `pnpm test:run packages/workspace/src/watcher/watcher.test.ts`는 14/14 통과했다.
- `pnpm test:run --no-file-parallelism`은 675/675 통과했다(명령 전체 10.828초).
- 독립 Node 프로세스에서 12개 프로젝트를 동시에 감시하고 같은 중첩 파일을 생성한 진단은 12/12 통과했다.
- 실제 감시 이벤트를 관찰하는 임시 계측을 적용한 전체 실행에서는 다른 외부 부모 이동 감지 사례 1건이 실패했다. 임시 계측은 원상 복구했으며 제품·테스트 변경으로 포함하지 않는다. 이 진단의 추가 환경 정보는 커밋하지 않은 `.workbench`에만 남겼다.
- 최초 통합 시점에는 원인을 특정하지 못했다. 추가 조사에서 감시 준비 직후의 변경 이벤트 누락을 독립적으로 재현했다. 수정 없는 기본 전체 재실행은 675/675 통과했지만 간헐적 누락의 해결로 간주하지 않는다. 조사 근거와 한계는 [파일 감시 후속 검증](watcher-follow-up.md)에 기록한다. 테스트 생략이나 대기 시간 완화는 하지 않았다.
- 개발 검사 81/81, 빌드 검사 32/32, 측정기 집중 검사 13/13은 통합 후에도 통과했다. 앞선 설치형 기능 Host와 전체 성능 측정 근거는 `../performance-observation-20260921/`에서 유지한다.

## 통합 명령 기록

| 명령                                                                                                                                                                                                            | 종료 코드 | 소요 시간(초) |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------: | ------------: |
| `pnpm typecheck`                                                                                                                                                                                                |         0 |         7.569 |
| `pnpm lint`                                                                                                                                                                                                     |         0 |         7.405 |
| `pnpm format:check`                                                                                                                                                                                             |         0 |        16.667 |
| `pnpm build`                                                                                                                                                                                                    |         0 |         3.863 |
| `pnpm test:run`                                                                                                                                                                                                 |         1 |         9.609 |
| `pnpm check:development`                                                                                                                                                                                        |         0 |        16.529 |
| `pnpm check:build`                                                                                                                                                                                              |         0 |        25.845 |
| `node --test tools/performance/progress.test.mjs tools/performance/reporter.test.mjs tools/extension-host/progress.test.mjs tools/extension-host/report.test.mjs tools/extension-host/request-outcome.test.mjs` |         0 |         0.283 |
| `pnpm test:run`                                                                                                                                                                                                 |         1 |         8.381 |

`checks.json`은 실행 명령·종료 코드·소요 시간을 보존한다. 원본 전체 로그는 해당 통합 워크트리의 `.workbench/pr13-delivery-checks/`에 있고, 기본 검사 실패 두 번과 전체 직렬 검사의 로그는 이 디렉터리에도 보존한다.

## 전달 상태

2026-09-21 사용자는 파일 감시 문제를 별도로 시험하고 현재 작업을 완료하여 main에 머지하도록 명시적으로 승인했다. 이 결정에 따라 구현·성능 관찰·한국어 보고서를 PR #13으로 전달한다. 기존 감시 결함과 Windows·macOS 양쪽의 감시 보완 검증은 후속 범위로 남는다. 현재 코드에는 감시 수정안을 적용하지 않았다.

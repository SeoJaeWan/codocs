# COD-28 통합 검증 결과

판정: **provisional candidate, 교차 OS 수락과 게시 준비는 미완료**. Windows x64의 동일 최종 tgz/VSIX는 최소 VS Code 1.100.0과 실행 시작에 고정한 stable 1.139.1에서 각각 기능 58/58, lifecycle 4/4를 통과했다. macOS 실행 호스트와 승인된 전달 경로가 없어 Mac 전체 검사·설치·기능·정리는 **BLOCKED**다. npm/Marketplace 게시 권한도 미확인이며 실제 게시하지 않았다.

English support statement: this unpublished candidate has been exercised on Windows x64 with VS Code 1.100.0 and 1.139.1 and standalone Node 24.21.0. macOS remains unverified; publication is not ready. Linux, WSL, containers, SSH and network shares are outside scope. These statements agree with both root READMEs, which make no final two-OS/latest or measured performance guarantee.

## 후보와 실행 환경

- 실행/intent: `wb-prepare-20260927T111517Z-8249a22b31f2-5eaf0e`, intent/1.
- 정확한 기반: TASK-002 `95a628fc1f2b8772c51c9792e0a2c8edf69f935a`; TASK-001 `fea2375c8c3675f34e4e52f63d7a5e0b002aa7ea`가 조상임을 확인했다.
- source plan/source task/runtime binding 해시는 [작업 기록](../COD-28.md)에 있고 세 값 모두 LF UTF-8·빈 digest scalar·마지막 LF 규칙으로 독립 검증했다.
- 계획/요청 프로필: gpt-6-astra/high, fresh context. 호스트가 effective model/effort를 노출하지 않아 실제 적용 값은 unknown으로 기록한다.
- Windows 10.0.26200 x64, AMD Ryzen 5 7500F, Node 24.21.0, pnpm 10.34.5.
- VS Code 1.100.0: Extension Host Node 20.19.0 / Electron 34.5.1. 1.139.1: Node 24.20.0 / Electron 43.6.0.
- stable은 2026-09-27T12:42:54Z에 공식 `https://update.code.visualstudio.com/api/releases/stable?released=true`에서 한 번 고정했다. [영수증](raw/stable.json.raw).
- 유일한 작업 공간: `D:/dev/codocs-worktrees/wb-prepare-20260927T111517Z-8249a22b31f2-5eaf0e/INT-001`.
- 최종 파일 위치: 이 작업 공간의 `.workbench/release/candidate-jvwJPD/`. 검사 후 재빌드하지 않았다.

| 파일                       | SHA-256                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| co-documentation-0.0.1.tgz | a0874840e42742c578caf19f98ad5e7f63e0ed23cf9d21c794f8cbd5b25e87a8 |
| codocs-0.0.1.vsix          | c6fd9d4e142af14c4e5fcd22d5193487faf24d5ab371b02b834d4e21ca1f5f7f |

[후보 receipt](evidence-index.json)는 빌드 당시 HEAD와 diff 및 미추적 구현 파일까지 포함한 전체 Git blob 목록을 보존한다. 최종 결과 commit은 이 보고서를 포함하는 task-local commit이며, commit 후 전체 blob 대조를 `.workbench/source-binding.json`에 남긴다. 후보 조립 후 추가한 파일은 이 결과 폴더의 문서·증거뿐이다. 결과 문서를 추가한 commit을 제품 재빌드로 표현하지 않는다.

TASK-002 tgz `16e23e3fbb82d19087a03b7d011f500b78183e01c713488e9e8d470468e33282` 및 VSIX `4ab84ea5a2961e7d4cea874af47c1529aed490569b71b0ea3d76b9121514c125`와는 별도 후보다. 새 checkout의 Git 줄바꿈 변환으로 README 두 개와 LICENSE가 LF에서 CRLF로 바뀌었고 정규화한 텍스트는 동일했다. runtime payload는 동일하다. VSIX container metadata도 달라질 수 있으므로 재빌드 파일을 같은 SHA로 취급하지 않는다. [선행 비교](raw/predecessor-artifact-comparison.json.raw).

첫 통합 후보 H9xFk8은 최신 VS Code fixture 실패를 기록한 진단 후보다. fixture 수정 후 jvwJPD로 다시 고정하고 모든 필수 Windows 검사를 재실행했다. tgz는 byte-identical이며 VSIX는 21개 payload entry 모두 byte-identical이고 container SHA만 달라졌다. [재고정 비교](raw/refreeze-payload-comparison.json.raw).

## 실제 검증

명령의 전체 절대 경로·종료 코드·소요 시간은 `raw/*-meta.json.raw`에 보존했다. 모든 제품 실행은 OS당 한 개씩 직렬 실행했고 store·download cache·profile·fixture·자식 PID를 격리했다.

| 검사                                                             | 결과                                     | 시간/근거                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| pnpm install --frozen-lockfile --store-dir .workbench/pnpm-store | PASS                                     | 20.6초, 독립 store                                                                             |
| 제한 stale revision 회귀                                         | PASS 5/5                                 | .workbench/write-race-focused.log                                                              |
| 실제 read 거부·watch 유지·복원 회귀                              | PASS 5/5                                 | .workbench/read-denial-focused.log                                                             |
| 전송 소스/버전/해시 회귀                                         | PASS 2/2                                 | 전체 Node 검사에도 포함                                                                        |
| 최종 pnpm check                                                  | PASS 979 Vitest + 50 Node + 117 consumer | 195.97초, [로그](raw/check-after-fixture.log)                                                  |
| pnpm release:pack                                                | PASS                                     | 6.89초, 위 최종 receipt                                                                        |
| pnpm release:verify exact tgz VSIX                               | PASS                                     | 1.75초, [결과](evidence-index.json)                                                            |
| 1.100.0 실제 설치·기능                                           | PASS 58/58                               | 60.50초, [기능](metrics.json), [설치](raw/minimum-installation.json.raw), [정리](metrics.json) |
| 1.100.0 lifecycle                                                | PASS 4/4                                 | 32.57초, [결과](raw/minimum-lifecycle.json.raw)                                                |
| 1.139.1 실제 설치·기능                                           | PASS 58/58                               | 53.90초, [기능](metrics.json), [설치](raw/latest-installation.json.raw), [정리](metrics.json)  |
| 1.139.1 lifecycle                                                | PASS 4/4                                 | 34.26초, [결과](raw/latest-lifecycle.json.raw)                                                 |
| macOS 전체 검사/설치/두 버전/정리                                | BLOCKED                                  | 연결 host·승인된 소스 전달 경로 없음                                                           |
| 실제 파일 symlink 생성                                           | 환경 제한 EPERM                          | .workbench/symlink-UmRaki; 실제 junction 경로 보존 회귀와 구분                                 |

독립 설치는 monorepo 밖에서 공개 tgz 하나만 offline 설치하고 설치된 codocs bin을 Node24로 실행했다. initialize/serverInfo, tools/list, 여섯 guide 자산, refresh/list/get/validate, create/update/read-back과 EOF 종료 code0을 확인했다. 테스트 driver의 SDK가 제품의 runtime dependency를 보충하지 않는다. VSIX는 실제 seojaewan.codocs 0.0.1 설치와 내장 서버를 확인했다. 설치 파일 목록에는 prompt, src, test, 개발용 map/declaration이 없으며 원본 logo.png와 MIT·의존성 고지를 포함한다.

한글/공백 경로는 단독 소비자 프로젝트, CRLF·주석 보존과 create 비덮어쓰기·권한 오류는 인접 storage 검사, 실제 Windows 핸들·revision·정션 교체는 storage-retry 검사, 파일 감시·재생성·두 MCP와 IDE·프로젝트 격리는 58개 실제 Extension Host 검사를 재사용했다. 파일 symlink 생성 EPERM을 skip/mock의 실제 통과로 바꾸지 않았고 새 수락 조건으로 추가하지 않았다. 양 버전의 정상 및 startup-failure/failure/timeout/cancelled 정리에서 잔류 시험 프로세스는 0이다.

## 실패를 보존한 수리

1. **TASK-002 readiness 가정 — resolved_in_task.** get은 마지막 완료 snapshot을 반환할 수 있어 다음 write가 index_not_ready를 반환하는 것은 계약상 가능하다. test는 success:false/saved:false/changed:false와 단일 index_not_ready일 때만 15초 제한 아래 같은 stale revision/input을 재요청한다. 각 중간 응답은 기존 evidence recorder에 남고 원본 바이트를 확인한다. 마지막 change_revision_mismatch와 파일 보존을 반드시 요구한다. 제품 readiness guard는 그대로다. 원래 TASK-002 실패는 그 작업 공간의 `.workbench/write-race-533DkN/evidence/268513866_0_0.json`에 보존돼 있다. 정확한 native/poll event 유발 순서는 확정하지 않았다.

2. **최신 VS Code의 읽기 fixture — resolved_in_task.** 첫 1.139.1 실행은 49개 완료 중 45개 통과·4개 실패였으며 나머지 9개는 완료 근거가 없었다. partial-scan, unconfirmed-reference, unexpected-server-exit, restart-budget-recovery에서 EBUSY watch가 관측됐다. [원본](raw/latest-before-fixture-functional.json.raw), [실행 결과](evidence-index.json). 기존 fixture의 FileShare.None은 읽기뿐 아니라 새로운 watch 핸들도 막았다. 실제 Electron43.6.0/Node24.20.0 probe는 기존 잠금의 read/open 및 watch/EBUSY와, 수정한 공유 허용+byte-range 잠금의 read/EBUSY·watch 성공·해제 후 변경 수신·원본 복원을 분리해 증명했다. [probe](raw/lock-probe-latest.json.raw). fixture만 수정했고 watcher의 자동 1회 복구/failed 정책은 완화하지 않았다. 최소와 최신 모두 58/58로 재검증했다.

3. **초기 CI helper lint — resolved_in_task.** 새 Node 테스트의 한국어 JSDoc 누락을 수정했다. [첫 실패](raw/initial-lint-failure.log)를 보존하고 최종 full check를 통과했다.

4. **동일 산출물의 CI 전달 — implemented, remote execution blocked.** Windows 후보 job에서 stable을 한 번 고정하고 tgz/VSIX를 한 번 조립한다. Windows/macOS job은 전달 SHA·source commit·전체 Git blob 목록을 확인하고 같은 파일로 독립 MCP와 최소/최신 설치·기능·lifecycle을 실행한다. 실패 후에도 안전한 후속 검사와 증거 업로드를 수행하며 준비 실패를 성공 처리하지 않는다. 성능은 일반 CI에 추가하지 않았다. 새 workflow는 로컬 정적/도구 검증까지 완료했고 실제 GitHub 실행은 하지 않았다.

## 성능 관찰의 경계

과거 Mac core 및 Hover 결과는 다른 source/VSIX/VS Code에서 측정돼 현재 후보의 성과로 재사용하지 않았다. 특히 과거 Mac VS Code1.136.1 Hover p95 11785.786ms는 100ms 목표를 넘었고, 과거 Windows 정식 API 실행은 취소된 부분 결과다. 과거 결과를 합쳐 현재 표본 수를 채우지 않는다.

현재 1,000개 문서에서 별도 `pnpm bench`로 새 프로세스 3회, 각 유형 warmup20/query100, 외부 변경10회씩 관찰했다. 정확한 완료 3개 초기 준비, 유형별300개 조회,30개 변경 반영이며 오류0이다. 준비 p95 1505.311ms, 조회1/10/20개 p95 0.035/0.075/0.102ms, 외부 변경 p95 78.359ms. 대용량 원본은 이 작업 공간의 `.workbench/performance-core/cod14-performance.json`에 보존하며 [보고서](raw/core-performance.md.raw)와 evidence-index.json의 경로·SHA로 연결한다. OS 파일 캐시는 비우지 않았다. runner가 표시하는 HEAD는 기반95a628f이며 실제 제품 소스는 위 후보 전체 blob receipt와 연결한다.

동일 최종 VSIX의 1.139.1 Hover API는 warmup2/measured10으로 한 번 실행했고 10/10 정확한 응답을 완료했다. 중앙값 17921.880ms, p95·최댓값 85888.023ms로 100ms 참고 목표를 크게 초과했다. [실제 결과](evidence-index.json), [보고서](raw/api-performance.md.raw), [표본 진행](raw/api-request-progress.jsonl.raw). 설정된 10개 표본만 완료했으며 기본 warmup100/measured1000 정식 측정을 충족하지 않는다. 전체 명령은 410.34초였다. 기존 성능 모드에는 개별 API와 전체 실행 timeout이 없고 준비·설치·정리 제한만 별도로 있다. 모든 요청의 실제 완료까지 기다렸으며 시간 목표를 timeout으로 바꾸거나 재실행·최적화로 느린 값을 숨기지 않았다. 종료 뒤 잔류 프로세스는 0이다.

두 관찰은 후보 runtime/packaging 영향의 제한된 표본이며 기본 정식 반복 전체를 충족하지 않는다. 다른 문서 규모, MCP 통신/목록/필터/커서/쓰기 종단 지연, UI DOM 완료·초기 IDE·저장/외부 반영·편집·다중 창 성능 및 모든 macOS 재측정은 현재 후보에서 미측정이다. 목표 달성이나 모든 장비 성능을 주장하지 않으며 최적화를 완료 조건으로 확대하지 않았다. 공개 양언어 README는 목표를 실측 성과나 보장으로 표현하지 않는다.

## 게시 준비와 수동 작업

[읽기 전용 확인](raw/environment-findings.json.raw): npm whoami는 seojaewan/exit0, public co-documentation 조회는 E404였다. 이름 예약이나 새 패키지 생성 권한을 증명하지 않는다. Marketplace는 VSCE_PAT와 표준 file-store 자격 정보가 없고 keytar를 사용할 수 없어 publisher role·token scope를 확인하지 못했다. VSCE verify-pat는 Reader도 성공할 수 있고 기본 store가 migration을 수행할 수 있어 게시 권한 확인으로 사용하지 않았다. 비밀값이나 다른 auth 파일을 출력하지 않았고 저장소를 변경하지 않았다.

- [x] 이름·버전·MIT·logo·README/한국어 README·guide 자산과 standalone 설치 일치.
- [x] TASK-001 포함 여부, 정확한 최종 파일 SHA, 실제 Windows 최소/최신 기능·정리.
- [x] 실패 원인·수리·미실행·표본 성능·현재 동시성 한계 기록.
- [ ] 동일 후보의 macOS 실제 전체 검사와 두 VS Code 버전의 설치·기능·정리.
- [ ] npm 이름/생성 권한과 Marketplace 게시 role·scope·보안 설정의 게시 직전 재확인.
- [ ] 두 OS 결과를 검토한 뒤 별도의 실제 게시 승인.

검증 종료 중 사용자가 feature/cod-28로 merge·push 후 리뷰 대기를 지시했다. coordinator가 확인한 기존 PR #25의 실제 ref는 `feature/COD-28`이다. 이 승인은 후속 intent/2 delivery task가 담당하며 INT-001은 기존 intent/1 packet의 정상 hook 로컬 commit까지만 수행한다. 후속 담당자는 exact 결과 commit을 해당 feature branch에 정상 merge·push한 뒤 두 OS CI를 실행한다. 기본 브랜치에 기존 `test.yml`의 workflow_dispatch가 있어 필요한 경우 다음 ref를 명시할 수 있다.

```sh
gh workflow run test.yml --repo SeoJaeWan/codocs --ref feature/COD-28
```

INT-001은 위 명령이나 merge·push를 실행하지 않았다. CI가 새로 만든 후보는 로컬 검증 파일과 같은 SHA라고 가정하지 않으며, 그 실행에서 두 OS가 실제 소비한 파일·고정 stable·소스 receipt를 새 결과로 보관해야 한다. 실제 게시, PR 수정, main 통합, 사용자/기존 worktree 정리도 이 task에서 수행하지 않았다.

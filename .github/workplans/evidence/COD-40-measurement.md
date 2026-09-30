# COD-40 — 현재 문서 검사 결과와 성능 측정

2026-09-30 · [작업 계획](../COD-40.md) · 후보 목록: [COD-40-current-candidates.json](COD-40-current-candidates.json) · 이 측정 자체는 제품 코드를 바꾸지 않았다(초안 검사 결함 수리는 (c)의 수리 후 관측 참고)

## 요약

- 실제로 빌드한 stdio MCP 서버의 `codocs_duplicates`로 이 저장소의 `.codocs` YAML 79개를 전체 검사했다. 상태는 `complete`, 미검사 문서는 0개, 후보는 **2개**(완전 일치 1, 유사 1)다. 두 후보는 [COD-30](COD-30-duplicate-detection.md)의 프로토타입 기록과 같은 쌍이다. 판정은 후보 JSON의 빈 칸에 사용자가 채운다.
- 전체 검사는 새 프로세스에서 중앙값 약 0.98초, 같은 프로세스에서 반복하면 약 0.60초(모든 문서 재사용)였다. 초안 검사는 문서 하나를 바꾼 초안이어도 약 0.60초였다(수리 전 관측. 이때 초안 검사가 초안과 무관한 저장 문서끼리의 후보 2개까지 반환하던 결함을 고쳤고, 수리 후 같은 초안의 `totalCandidates`는 0, 시간은 약 0.65초였다. 아래 (c) 참고). 서버 프로세스 RSS는 첫 검사 뒤 약 87 MiB에서 약 221 MiB로 늘었다.
- 검사가 도는 동안 같은 서버의 `codocs_get`은 최대 약 280ms 지연됐다. 색인 구성이 동기 작업이기 때문이다.
- 측정 중 다른 작업이 CPU를 많이 쓰던 시간대에는 같은 검사가 3초 제한에 걸려 `partial`이 나왔다. 아래 “부하가 있을 때”에 기록했다. 모든 수치는 이 기계·이 corpus에서의 관측이며 서비스 지연 보장이나 정확도·재현율이 아니다.

## 후보 (AC-009)

기준 커밋 `5419f69cd4841c67502a6b77e864c5b07778e9f2`(`feat(mcp): add codocs_duplicates tool with cancellation passthrough`)의 `.codocs`를 검사했다. 설정 버전 1, 카탈로그 버전 1, `status: complete`, `scope: all`, 비교한 문서 79개, 미검사 0개, 진행 5,895 / 5,895 단위, `nextCursor: null`(한 페이지), 검사 중 색인 변경 없음이다. 본문 제외 구간은 제목 324, 코드 펜스 34, 표 구분선 7, 너무 짧은 구간 288, 너무 긴 구간 1이다.

| 번호 | 종류        | 한쪽                                                                | 다른 쪽                                                                   | Jaccard / 순서 유사도 | 링크 목적지 차이 |
| ---- | ----------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------- | ---------------- |
| 1    | 완전 일치   | `.codocs/core/change-plan/document-change-plan.yaml` 14행 (383–430) | `.codocs/workspace/storage/storage.yaml` 27행 (1085–1132)                 | 1.000 / 1.000         | 없음             |
| 2    | 유사 (문구) | `.codocs/core/query/query-projection.yaml` 64행 (2356–2415)         | `.codocs/mcp/validation/document-validation-request.yaml` 26행 (998–1049) | 0.683 / 0.873         | 없음             |

행은 도구가 돌려준 0 기반 `range.start.line`에 1을 더한 값이고 괄호는 원본 YAML 문자열의 UTF-16 offset(시작 포함·끝 제외)이다. 네 위치 모두 실제 파일에서 offset으로 잘라낸 문자열이 구절과 같고 행이 맞는지 확인했다. 구절 원문과 fieldPath(모두 `definition`)는 JSON에 있다. 후보 2는 두 문서 모두 `[[검증 오류가 있는 문서를 조회하고 수정하는 절차]]`로 안내하는 문장이다. 두 후보의 판정 칸(`judgement`, 허용값 유용 / 정상 반복 / 잡음)과 `note`는 비어 있고, 사용자가 채운다.

이 후보 수와 사용자의 판정은 정확도·재현율의 근거가 아니다. 그런 수치는 정답을 분류한 별도 평가 자료에서만 계산한다.

## 측정 환경

| 항목             | 값                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 기계             | Apple M1 Pro, 논리 코어 10개, 16 GiB                                                                                   |
| OS               | macOS 26.5.1 (Darwin 25.5.0, arm64)                                                                                    |
| Node.js          | v24.21.0                                                                                                               |
| 서버             | `node packages/mcp/dist/cli.js` (`corepack pnpm build` 결과), stdio, 프로젝트 = 이 작업 트리                           |
| corpus           | `.codocs` YAML 79개, 329,965바이트 (`find .codocs -type f \| wc -l`, 전체 바이트 합). 다른 파일 형식 없음              |
| 초안 대상        | 문서 ID `catalog`(`.codocs/core/catalog/catalog.yaml`)의 update 초안                                                   |
| 서버 옵션        | 기본값. 시간 제한 3,000ms, 실행 조각 15ms (도구 입력이 아닌 세션 옵션)                                                 |
| 클라이언트       | MCP SDK `Client` + `StdioClientTransport`. 시간은 클라이언트에서 `process.hrtime`으로 요청 전송~응답 수신을 잰 값      |
| 측정 시점의 부하 | 최종 측정 동안 1분 평균 부하 약 3~6 (코어 10개). 같은 기계에서 다른 작업 트리의 빌드·테스트가 돌 수 있는 공유 환경이다 |

## 재실행 방법

```sh
source ~/.nvm/nvm.sh && nvm use 24.21.0
cd <작업 트리>            # 이 문서가 담긴 커밋을 체크아웃한 곳. .codocs와 packages는 5419f69와 같다
corepack pnpm install --frozen-lockfile
corepack pnpm build       # 무시된 dist 폴더만 만든다
node <임시 디렉터리>/measure.mjs "$PWD" <임시 디렉터리>/out.json   # 약 2~3분
git status --porcelain --untracked-files=all                       # 아무것도 나오지 않아야 한다
```

`measure.mjs`는 저장소에 넣지 않고 임시 디렉터리에 두었다가 측정 뒤 삭제했다(폴더 컨벤션상 `tools/`에 검사 실행기를 두지 않는다). 전체 본문은 이 문서 끝의 “측정 스크립트”에 있다. 문서 형식 도구가 코드 블록을 다시 정렬했을 수 있으나 동작은 같다. 결과 JSON에는 각 표본의 원자료와 표본 시점의 부하 평균이 들어 있다.

## 측정 결과

아래는 최종 측정 1회(스크립트 전체 1회 실행)의 수치다. 표기는 최솟값 / 중앙값 / 최댓값이며 표본이 적어 분위수는 쓰지 않는다. 모든 시간은 MCP 요청 전송부터 응답 수신까지이며 서버 프로세스 시작·`initialize`·`tools/list`는 제외한다. 검사 결과 확인용 후보 수집(페이지 이동)은 별도 프로세스로 했고 아래 표에 포함하지 않는다.

### (a) 전체 검사, 새 서버 프로세스 (콜드)

| 항목                       | 값                                                                     |
| -------------------------- | ---------------------------------------------------------------------- |
| 반복                       | 서로 다른 새 프로세스 7회                                              |
| 첫 `codocs_duplicates({})` | 940.1 / 981.3 / 1064.1 ms                                              |
| 결과                       | 7회 모두 `complete`, 후보 2, 비교 문서 79, `preparation` 79 / 재사용 0 |

포함: 요청 처리, 문서 준비(`preparedCount` 79), 색인 구성, 비교(5,895 단위), 응답 직렬화와 전달. 제외: 서버 프로세스 시작, MCP `initialize`·`tools/list`, 시작 뒤 300ms 대기. 파일 읽기와 카탈로그 스캔이 이 시간에 얼마나 들어 있는지는 서버 내부 단계를 나누어 재지 않아 구분하지 못했다.

### (b) 같은 프로세스에서 전체 검사 반복 (캐시 재사용)

| 항목              | 값                                                                  |
| ----------------- | ------------------------------------------------------------------- |
| 반복              | 새 프로세스 1개에서 첫 검사(965.7ms) 뒤 연속 10회                   |
| 첫 검사 이후 10회 | 594.0 / 602.0 / 612.9 ms                                            |
| `preparation`     | 첫 검사 `preparedCount` 79 / `reusedCount` 0, 이후 10회 모두 0 / 79 |
| 결과              | 10회 모두 `complete`, 후보 2                                        |

콜드 대비 중앙값이 약 0.38초 줄었다. 웜에서도 (e)의 색인 구성 정지(약 250ms)와 약 0.6초의 시간이 남아 있으므로, 재사용되는 것은 문서 준비 결과이고 색인 구성과 비교는 매번 다시 하는 것으로 보인다(코드로 확인하지는 않았다).

### (c) 초안 검사 (파일을 쓰지 않음)

`codocs_get`으로 `catalog`의 `definition`과 revision을 얻어 `codocs_duplicates({draft:{mode:'update', id:'catalog', revision, set:{definition:…}}})`를 호출했다.

- 본문 변경 없음: 기존 `definition`을 그대로 `set`한다.
- 한 문단 추가: 기존 `definition` 끝에 한 줄 문단(`이 문단은 초안 검사 시간을 재기 위해 임시로 덧붙인 설명이며 파일에 저장하지 않는다.`)을 붙여 `set`한다.

수리 전 관측 (기준 커밋 `5419f69`, 결함이 있던 동작):

| 조건                                       | 반복            | 시간 (최소 / 중앙값 / 최대) | `preparation`      | 결과                                        |
| ------------------------------------------ | --------------- | --------------------------- | ------------------ | ------------------------------------------- |
| 본문 변경 없음, 전체 검사 뒤 같은 프로세스 | 20회            | 597.6 / 619.2 / 679.5 ms    | 준비 0 / 재사용 78 | `complete`, `scope: draft`, 비교 79, 후보 2 |
| 한 문단 추가, 같은 프로세스                | 20회            | 590.4 / 600.1 / 700.1 ms    | 준비 0 / 재사용 78 | `complete`, `scope: draft`, 비교 79, 후보 2 |
| 본문 변경 없음, 새 프로세스의 첫 호출      | 새 프로세스 5회 | 926.1 / 943.8 / 953.1 ms    | 준비 78 / 재사용 0 | `complete`                                  |
| 한 문단 추가, 새 프로세스의 첫 호출        | 새 프로세스 5회 | 920.7 / 927.6 / 942.9 ms    | 준비 78 / 재사용 0 | `complete`                                  |

관측(수리 전): 초안 검사 시간은 같은 프로세스의 전체 검사(웜, 약 0.60초)와 거의 같았고, 응답의 `comparedDocumentCount`는 79였다. 서버 내부에서 무엇을 다시 계산하는지는 코드를 읽어 확인하지 않았으므로 시간과 응답 필드만 적는다. 두 초안 모두 `totalCandidates`는 2였다(후보의 내용이 저장 문서 결과와 같은지는 비교하지 않았다). 이후 이 두 후보가 초안과 무관한 저장 문서끼리의 쌍(전체 검사가 돌려주는 두 후보와 같은 쌍)이라는 점이 결함으로 확인되어 아래 “수리 후 관측”으로 다시 쟀다.

#### 수리 후 관측 (수리 커밋 `8931f1e`, `fix(workspace): limit draft duplicate check results to candidates that include the draft`)

초안 검사(`scope: draft`)가 초안 위치를 하나 이상 포함한 후보만 반환하도록 workspace 계층의 결과 변환을 고쳤다. 고친 뒤 코드를 다시 빌드하고 위 “측정 스크립트”를 재사용해(전체 검사 콜드 반복 7회를 3회로, (e) 응답성 측정은 빼고) 같은 방식으로 다시 쟀다. 대상 문서, 초안 두 종류(본문 변경 없음, 한 문단 추가), 시간 측정 방법은 수리 전과 같다. 측정 중 1분 평균 부하는 약 6~9(논리 코어 10개)였고 모든 검사가 `complete`였다(`partial` 없음).

| 조건                                       | 반복            | 시간 (최소 / 중앙값 / 최대) | `preparation`      | 결과                                                                                  |
| ------------------------------------------ | --------------- | --------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| 본문 변경 없음, 전체 검사 뒤 같은 프로세스 | 20회            | 622.9 / 651.7 / 723.7 ms    | 준비 0 / 재사용 78 | `complete`, `scope: draft`, 비교 79, `totalCandidates` **0**, 후보 0, `exactGroups` 0 |
| 한 문단 추가, 같은 프로세스                | 20회            | 615.0 / 656.3 / 695.5 ms    | 준비 0 / 재사용 78 | `complete`, `scope: draft`, 비교 79, `totalCandidates` **0**, 후보 0, `exactGroups` 0 |
| 본문 변경 없음, 새 프로세스의 첫 호출      | 새 프로세스 5회 | 960.7 / 971.2 / 1369.7 ms   | 준비 78 / 재사용 0 | `complete`                                                                            |
| 한 문단 추가, 새 프로세스의 첫 호출        | 새 프로세스 5회 | 953.9 / 1028.8 / 2541.3 ms  | 준비 78 / 재사용 0 | `complete`                                                                            |

관측(수리 후): 수리 전 `totalCandidates` 2였던 두 초안이 모두 0이 되어 저장 문서끼리의 후보 2개는 초안 검사에 나오지 않았다. 두 초안 모두 다른 문서와 반복되는 구절이 없어 0이 초안 관련 후보가 없다는 뜻이며, `status`가 `complete`이므로 중복 없음으로 읽어도 되는 경우다(`partial`이면 후보 0이어도 그렇게 읽지 않는다). 시간은 수리 전과 같은 수준이었다(같은 프로세스 중앙값 약 0.65초 대 약 0.60~0.62초, 부하가 수리 전 최종 측정보다 높았다). 필터는 core가 비교를 마친 뒤의 결과에 적용하므로 비교 자체가 초안 구간으로 줄지는 않았고 시간이 줄어들 것으로 기대하지도 않았다. 같은 재측정에서 전체 검사는 여전히 `complete`, 후보 2(위 후보 표의 두 쌍과 같은 쌍), 비교 79, 5,895 / 5,895 단위였다. 초안 검사 50회(같은 프로세스 40회, 새 프로세스 10회) 전후 `git status --porcelain --untracked-files=all` 출력은 세 시점 모두 비어 있었다.

수리 후에 다시 재지 않은 것: 위 (a) 전체 검사 콜드·(b) 웜·(d) 메모리·(e) 응답성과 “부하가 있을 때”, “이전 프로토타입 기록과의 비교”의 수치는 수리 전 5419f69에서 잰 값 그대로이며 다시 재지 않았다. 이번 재측정은 (c)의 초안 검사와 전체 검사 결과(후보 2, `complete`) 확인만 다시 했다. 재측정에서 얻은 전체 검사 시간(콜드 3회 955.2 / 1053.1 / 1264.4 ms, 웜 10회 626.0 / 644.3 / 700.6 ms)은 참고용이며 위 (a), (b)를 바꾸지 않는다.

파일 무변경 확인: 같은 프로세스 초안 40회 뒤, 새 프로세스 초안 10회 뒤, 응답성 측정을 마친 뒤 세 시점 모두 `git status --porcelain --untracked-files=all` 출력이 비어 있었다.

### (d) 서버 프로세스 메모리

서버 프로세스의 RSS를 클라이언트 프로세스에서 `ps -o rss= -p <서버 pid>`로 읽었다(프로세스 내부 계측 아님). 새 프로세스 7회.

| 시점                        | RSS (최소 / 중앙값 / 최대) |
| --------------------------- | -------------------------- |
| 시작 후 300ms, 첫 검사 전   | 81.9 / 87.2 / 87.8 MiB     |
| 첫 전체 검사 응답 직후      | 216.5 / 221.2 / 249.3 MiB  |
| 응답 500ms 뒤               | 193.3 / 221.2 / 249.3 MiB  |
| 증가분(응답 직후 − 검사 전) | 129.4 / 133.9 / 167.4 MiB  |

같은 프로세스에서 전체 검사 11회, 초안 검사 40회, `codocs_get` 1회를 한 뒤 RSS는 491.2 MiB였다(부하가 낮았던 다른 두 실행에서도 약 445~496 MiB). RSS는 가비지 컬렉션 시점에 따라 움직이는 값이므로 이 수치로 누수 여부나 필요한 메모리를 판단하지 않는다. 프로세스 힙 사용량이나 최대 RSS(peak)는 재지 않았다.

### (e) 응답성: 전체 검사 중 `codocs_get` 지연

한 연결에서 `codocs_duplicates({})`를 기다리지 않고 보낸 뒤, 지정한 지연(오프셋) 후 `codocs_get({ids:['catalog']})`를 보내 요청부터 응답까지 잰다. 오프셋과 프로세스 상태(콜드 = 새 프로세스의 첫 검사, 웜 = 이미 한 번 검사한 프로세스)마다 새 프로세스로 5회 반복했다. 검사 없이 유휴 상태의 `codocs_get`은 30회에서 0.2 / 0.2 / 0.6 ms였다.

| 상태 | 오프셋(ms) | `codocs_get` 지연 (최소 / 중앙값 / 최대 ms) | get 응답 완료 시각 (검사 시작 기준, 중앙값 ms) | 같은 시점 검사 총 시간 (중앙값 ms) |
| ---- | ---------- | ------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| 콜드 | 0          | 22.8 / 23.4 / 25.7                          | 26.1                                           | 771.5                              |
| 콜드 | 20         | 1.0 / 5.3 / 15.2                            | 26.2                                           | 768.9                              |
| 콜드 | 150        | 0.9 / 231.6 / 280.8                         | 382.4                                          | 768.4                              |
| 콜드 | 250        | 141.9 / 151.3 / 155.3                       | 402.5                                          | 771.6                              |
| 콜드 | 350        | 56.4 / 63.2 / 72.5                          | 414.5                                          | 800.9                              |
| 콜드 | 500        | 4.9 / 7.8 / 59.5                            | 508.2                                          | 827.9                              |
| 웜   | 0          | 2.0 / 263.1 / 275.9                         | 264.4                                          | 639.0                              |
| 웜   | 20         | 244.5 / 246.7 / 257.3                       | 267.9                                          | 635.8                              |
| 웜   | 150        | 111.0 / 140.8 / 184.1                       | 292.1                                          | 677.0                              |
| 웜   | 250        | 12.6 / 22.5 / 36.1                          | 272.9                                          | 636.3                              |
| 웜   | 350        | 1.2 / 5.5 / 14.7                            | 356.7                                          | 646.3                              |
| 웜   | 500        | 1.4 / 11.2 / 15.9                           | 512.4                                          | 651.1                              |

관측: 지연이 큰 요청은 검사 시작 뒤 특정 구간에 몰린다. 콜드에서는 약 150~~400ms 사이, 웜에서는 시작 직후부터 약 265ms까지 보낸 `codocs_get`이 그 구간이 끝나는 시각(각각 약 380~~415ms, 약 265~~290ms)까지 밀렸고 그 뒤에 보낸 요청은 수 ms에 응답했다. 최대 지연은 약 281ms였다. 이는 TASK-003 결과가 적은 “핵심 비교 구성이 동기 작업(79개 문서에서 이벤트 루프 약 250ms 정지)”과 맞는 관측이다. 반면 비교 자체는 15ms 조각으로 나뉘어 있어 이 구간 밖에서는 `codocs_get`이 검사에 크게 막히지 않았다. 검사 총 시간은 콜드에서 약 770~~830ms로 (a)의 940~~1,064ms보다 짧았고 웜에서는 약 636~~677ms로 (b)의 약 602ms보다 길었다. 이 차이의 원인(검사 전 `codocs_get` 호출 여부, 요청 끼워넣기 등)은 조사하지 않았다. 다른 오프셋 조합이나 다른 도구, 여러 요청이 동시에 오는 경우는 측정하지 않았다.

## 부하가 있을 때 (관측한 다른 실행)

같은 스크립트를 최종 실행 전에 두 번 더 돌렸다. 두 실행은 같은 기계에서 다른 작업 트리의 작업이 CPU를 많이 쓰던 때였다.

| 실행                                     | 1분 평균 부하                      | 관측                                                                                                                                                                                               |
| ---------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 실행 A (부하 미기록, 스크립트 초기 버전) | 측정 직후 확인 시 약 40(이후 상승) | 콜드 전체 검사 중앙값 951ms, 웜 601ms 등 표본은 최종 실행과 같았으나, 마지막 후보 수집 실행 한 번이 `partial`(`time_limit`, 3,405 / 5,895 단위)로 끝났다. 후보는 2개가 이미 나와 있었다.           |
| 실행 B (스크립트 부하 기록 추가)         | 100~170                            | 콜드 전체 검사 7회 중 1회, 웜 반복 10회 중 6회, 초안 검사(같은 프로세스) 40회 중 10회, 초안 새 프로세스 첫 호출 10회 중 7회가 `partial`. 콜드 전체 검사 중앙값은 4,216ms, 웜은 3,050ms까지 늘었다. |

`partial`은 시간 제한 3,000ms에 도달해 비교를 멈춘 것이고 `stopReason: time_limit`가 함께 온다. 이 상태에서는 “중복 없음”을 말할 수 없다. 후보 JSON은 `complete`인 실행에서만 수집하도록 스크립트가 최대 5번 재시도하게 했고 최종 실행에서는 첫 시도에 `complete`였다. 부하가 낮은 두 번의 실행(최종 실행과 그 직전 실행)의 표본은 서로 비슷했다(콜드 중앙값 951 / 981ms, 웜 611 / 602ms, 초안 597·595 / 619·600ms). 즉 평시 수치는 위 표와 같지만 CPU 경쟁이 있으면 3초 제한 안에서 끝나지 않을 수 있다. 이 서버의 시간 제한은 비교 단계에 대한 예산이며 총 응답 시간 보장이 아니다.

## 알려진 특성 (고치지 않고 기록)

- 기본 시간 제한은 3,000ms, 실행 조각은 15ms다. 세션 옵션이며 도구 입력으로 바꿀 수 없다. 79개 문서 검사(비교 약 0.6초)는 평시에 제한의 약 20~33%를 쓰지만, 위 “부하가 있을 때”처럼 CPU 경쟁이 있으면 제한에 도달했다.
- 핵심 비교 구성이 동기 작업이라 색인 구성 동안 이벤트 루프가 약 250ms 멈춘다. (e)에서 같은 서버의 다른 요청이 그만큼 지연됐다. 문서가 더 늘면 이 정지도 늘 수 있으나 그 관계는 측정하지 않았다.
- 초안 검사가 전체 검사(웜)보다 뚜렷이 빠르지 않았다(둘 다 약 0.60초, 수리 후에도 같은 수준). 초안 1개만 비교하는 경로에서 기대할 수 있는 수 ms 수준의 시간은 관측되지 않았다.

## 이전 프로토타입 기록과의 비교

[COD-30](COD-30-duplicate-detection.md)의 성능 수치는 제품 밖의 독립 프로토타입을 그때의 corpus(`.codocs` YAML 72개, 197,964바이트)로 잰 값이다. 이번 값과 같은 기준으로 놓고 비교할 수 없으며 “빨라졌다·느려졌다”로 읽지 않는다.

| 항목        | COD-30 프로토타입                                     | 이번 측정                                                                                     |
| ----------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 대상        | 프로토타입 엔진을 프로세스에서 직접 호출              | 빌드한 제품 MCP 서버를 stdio로 호출 (요청 전송~응답 수신)                                     |
| corpus      | 72개 · 197,964바이트                                  | 79개 · 329,965바이트                                                                          |
| 비교 기준   | 최소 30 코드 포인트, 4-gram Jaccard 0.65, 순서 0.70   | 제품 기본 설정 (설정 버전 1). 프로토타입과 기준값이 같은지는 확인하지 않았다. 진행 단위 5,895 |
| 포함 범위   | 파싱·준비·색인·탐지, 파일 읽기 제외                   | 카탈로그 준비 이후 색인·비교 포함, 요청·응답 처리 포함, 프로세스 시작 제외                    |
| 시간 제한   | 없음 (전체 완료까지 실행)                             | 기본 3,000ms 제한과 15ms 조각 적용                                                            |
| 캐시·초안   | 초안은 캐시를 재사용한 한 문서 초안 60회 중앙값 7.4ms | 초안 검사도 79개 전체를 다시 비교해 약 0.60초                                                 |
| 메모리      | 유지 힙 증가 약 54 MiB (프로세스 내부에서 잰 값)      | 서버 RSS 약 87 → 221 MiB (프로세스 외부에서 잰 값. 서로 다른 지표)                            |
| 이벤트 루프 | 대형 corpus 응답성 미측정                             | 검사 중 `codocs_get` 최대 약 281ms 지연을 관측                                                |

특히 초안 검사 시간의 차이(7.4ms 대 약 0.60초)는 알고리즘 차이가 아니라 측정 대상이 다른 데서 오는 값으로 읽어야 하며, 어느 쪽이 더 나은지 결론 내리지 않는다.

## 해석의 한계

- 한 기계(Apple M1 Pro), 한 corpus(이 저장소의 `.codocs` 79개), 스크립트 한 번의 실행에서 얻은 관측이다. 표본이 5~30회여서 중앙값과 범위만 적었고 통계적 신뢰구간은 없다.
- 서비스 지연 보장이 아니다. 다른 corpus 크기, 다른 기계, 동시 사용자·동시 요청, 파일 감시(watcher)와 저장이 섞이는 경우는 측정하지 않았다.
- 같은 기계에서 다른 작업이 돌 수 있는 환경이라 부하가 낮은 실행의 값을 대표로 골랐다. 그 선택 기준(부하 평균)은 위에 적었다.
- 후보 수, 후보 판정, 초안 검사가 후보를 찾은 사실은 정확도·재현율의 근거가 아니다. 이번 측정은 시간과 메모리만 다루며 “중복이 더 있을 수 있는지”는 말하지 않는다. 그런 수치는 정답을 분류한 별도 평가 자료에서만 계산한다.
- 시간은 클라이언트에서 잰 왕복 시간이고, 서버 내부 단계별 시간은 이번에 분리해 측정하지 않았다.
- 검사한 `.codocs`는 5419f69의 것이다. 계획 시점 기준인 5bff3dd와는 `.codocs/mcp/tool-contract.yaml`, `.codocs/mcp/guide/authoring-guide.yaml` 두 문서만 다르다. 두 후보는 이 문서들과 관계없는 위치에 있으나 5bff3dd의 `.codocs`를 따로 검사하지는 않았다.

## 측정 스크립트

```js
// usage: node measure.mjs <worktree> <outJson>
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const W = process.argv[2];
const OUT = process.argv[3];
const sdk =
  W + '/packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/';
const { Client } = await import(pathToFileURL(sdk + 'index.js'));
const { StdioClientTransport } = await import(pathToFileURL(sdk + 'stdio.js'));

const now = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = () => os.loadavg()[0];
const rssMiB = (pid) =>
  Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024;
const git = (a) => execSync(`git -C ${W} ${a}`).toString();
const parse = (r) => JSON.parse(r.content[0].text);

async function start() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [W + '/packages/mcp/dist/cli.js'],
    cwd: W,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'measure', version: '1' });
  await client.connect(transport);
  await client.listTools(); // 초기화·도구 목록까지 끝난 뒤 시작한다
  return { client, pid: transport.pid, close: () => client.close() };
}
const call = (c, name, args) => c.callTool({ name, arguments: args });
async function timed(c, name, args) {
  const t0 = now();
  const res = parse(await call(c, name, args));
  return { ms: now() - t0, res };
}

const out = { loadStart: load(), cpuCount: os.cpus().length };
const N = 7; // 새 프로세스 반복

// (a) 콜드 전체 검사 + (d) RSS
out.cold = [];
for (let i = 0; i < N; i++) {
  const s = await start();
  await sleep(300);
  const rssBefore = rssMiB(s.pid);
  const { ms, res } = await timed(s.client, 'codocs_duplicates', {});
  const rssAfter = rssMiB(s.pid);
  await sleep(500);
  const rssSettled = rssMiB(s.pid);
  out.cold.push({
    load: load(),
    ms,
    rssBefore,
    rssAfter,
    rssSettled,
    status: res.status,
    total: res.totalCandidates,
    compared: res.comparedDocumentCount,
    preparation: res.preparation,
    progress: res.progress,
    stopReason: res.stopReason,
    unchecked: res.unchecked.length,
  });
  await s.close();
}

// (b) 같은 프로세스 반복 + (c) 초안 검사
const s = await start();
const first = await timed(s.client, 'codocs_duplicates', {});
out.warmFirst = { ms: first.ms, preparation: first.res.preparation };
out.warm = [];
for (let i = 0; i < 10; i++) {
  const { ms, res } = await timed(s.client, 'codocs_duplicates', {});
  out.warm.push({
    load: load(),
    ms,
    status: res.status,
    total: res.totalCandidates,
    preparation: res.preparation,
  });
}
const doc = parse(await call(s.client, 'codocs_get', { ids: ['catalog'] }))
  .results[0];
const base = { mode: 'update', id: 'catalog', revision: doc.revision };
const same = { ...base, set: { definition: doc.document.definition } };
const appended = {
  ...base,
  set: {
    definition:
      doc.document.definition +
      '\n이 문단은 초안 검사 시간을 재기 위해 임시로 덧붙인 설명이며 파일에 저장하지 않는다.\n',
  },
};
const draftRuns = async (label, args, n) => {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const { ms, res } = await timed(s.client, 'codocs_duplicates', {
      draft: args,
    });
    arr.push({
      load: load(),
      ms,
      status: res.status,
      scope: res.scope,
      total: res.totalCandidates,
      compared: res.comparedDocumentCount,
      preparation: res.preparation,
      draftInfo: res.draft,
    });
  }
  out[label] = arr;
};
await draftRuns('draftUnchanged', same, 20);
await draftRuns('draftAppended', appended, 20);
out.gitStatusAfterDrafts = git('status --porcelain --untracked-files=all');
out.rssWarmProcess = rssMiB(s.pid);
await s.close();

// (c') 콜드 프로세스에서의 첫 초안 검사
out.draftColdFirst = [];
for (const [label, args] of [
  ['unchanged', same],
  ['appended', appended],
]) {
  for (let i = 0; i < 5; i++) {
    const t = await start();
    const { ms, res } = await timed(t.client, 'codocs_duplicates', {
      draft: args,
    });
    out.draftColdFirst.push({
      load: load(),
      label,
      ms,
      status: res.status,
      preparation: res.preparation,
    });
    await t.close();
  }
}
out.gitStatusAfterColdDrafts = git('status --porcelain --untracked-files=all');

// (e) 응답성: 전체 검사 중 codocs_get 지연
async function getLatency(c) {
  const t0 = now();
  await call(c, 'codocs_get', { ids: ['catalog'] });
  return now() - t0;
}
out.getIdle = [];
{
  const t = await start();
  await getLatency(t.client);
  for (let i = 0; i < 30; i++) out.getIdle.push(await getLatency(t.client));
  await t.close();
}
out.getDuring = [];
for (const mode of ['cold', 'warm']) {
  for (const offset of [0, 20, 150, 250, 350, 500]) {
    for (let i = 0; i < 5; i++) {
      const t = await start();
      await getLatency(t.client); // get 경로를 미리 데운다
      if (mode === 'warm') await call(t.client, 'codocs_duplicates', {});
      await sleep(300);
      const t0 = now();
      const dup = call(t.client, 'codocs_duplicates', {}).then((r) => ({
        ms: now() - t0,
        res: parse(r),
      }));
      await sleep(offset);
      const sentAt = now() - t0;
      const getMs = await getLatency(t.client);
      const getDoneAt = now() - t0;
      const d = await dup;
      out.getDuring.push({
        load: load(),
        mode,
        offset,
        sentAt,
        getMs,
        getDoneAt,
        dupMs: d.ms,
        getFinishedBeforeDup: getDoneAt < d.ms,
        status: d.res.status,
      });
      await t.close();
    }
  }
}
out.gitStatusEnd = git('status --porcelain --untracked-files=all');

// 후보 전체 수집 (별도 프로세스). complete가 아니면 최대 5번 다시 시도하고 시도를 모두 기록한다
out.candidateAttempts = [];
for (let attempt = 1; attempt <= 5; attempt++) {
  const t = await start();
  const cands = [];
  const t0 = now();
  let r = parse(await call(t.client, 'codocs_duplicates', {}));
  const head = { ...r };
  delete head.candidates;
  let pages = 1;
  cands.push(...r.candidates);
  while (r.nextCursor) {
    r = parse(
      await call(t.client, 'codocs_duplicates', { cursor: r.nextCursor }),
    );
    cands.push(...r.candidates);
    pages++;
  }
  await t.close();
  out.candidateAttempts.push({
    attempt,
    load: load(),
    ms: now() - t0,
    status: head.status,
    progress: head.progress,
    pages,
    count: cands.length,
  });
  if (head.status === 'complete') {
    out.candidates = { head, pages, candidates: cands };
    break;
  }
}
out.loadEnd = load();
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('done');
```

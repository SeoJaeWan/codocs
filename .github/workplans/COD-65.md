# COD-65 — Codocs MCP 검색 도구(codocs_search) 추가

## 배경

Codocs 문서에 제약사항, 조건, 도메인 규칙을 작성하더라도 Codex/Claude가 해당 문서를 조회하지 않으면 실질적인 효과가 없다.

현재 MCP 기반 접근은 Agent가 필요하다고 판단할 때만 `list`/`get`을 호출하는 구조다. 문서 이름을 모르면 `list`로 이름을 따라 내려가야 하므로 관련 문서가 있어도 놓칠 수 있다.

## 범위가 바뀐 이유

처음에는 사용자 프롬프트가 Agent에 전달되기 전에 관련 문서를 자동 주입하는 Preflight Hook을 설계하려 했다. 프로토타입을 측정한 결과 다음 이유로 방향을 바꿨다.

- Hook은 사용자가 입력한 원문 프롬프트만 볼 수 있고, 이를 검색에 알맞은 주제·용어로 쪼갤 수 없다. 원문을 그대로 검색하면 정밀도가 낮다(1위 정확도 약 65%).
- 정밀도를 올린 후보(BM25 + e5-small 혼합)는 용량 약 550MB와 응답 약 0.65초를 감수해야 하고, 재현율을 올린 재순위 후보는 4.8~7초와 1GB 이상이 필요해 Hook으로 쓰기 어렵다.
- 반면 Agent가 직접 호출하는 검색에서는 AI가 대화 전체를 보고 짧은 검색어 여러 개를 직접 뽑을 수 있다. 이 방식은 모델이나 색인 없이 어휘 일치만으로도 문서를 찾을 수 있음을 프로토타입 근거로 확인했다.

그래서 이번 이슈는 MCP 도구 `codocs_search`를 추가하는 것으로 범위를 바꿨다. 프로토타입 측정 기록은 배경 근거로 남긴다([COD-65-results/prototype-report.md](./COD-65-results/prototype-report.md), 케이스별 결과 [COD-65-results/cases.md](./COD-65-results/cases.md)).

## 합의한 결정

- 입력은 `queries` 배열이며 1~10개, 각 200자 이하다. 원문을 통째로 넣지 않고 AI가 뽑은 주제·용어·식별자를 준다.
- 점수는 검색어마다 따로 정규화해 그 검색어의 최고 섹션을 1.0으로 맞춘다. 섹션 점수는 검색어별 점수의 최댓값이다.
- 점수 순 상위 섹션 10개를 고른다. 같은 문서의 섹션이 둘 이상이면 문서 주소 하나로 묶고 걸린 섹션 이름을 `sections`에 담는다. 줄어든 자리는 채우지 않는다(backfill 없음).
- 항목은 `address`, `score`, `queries`, `sections`만 담고 본문은 돌려주지 않는다. 걸린 섹션이 없는 검색어는 `emptyQueries`에 담는다.
- YAML을 해석할 수 있는 문서는 규칙 위반이나 이름 충돌이 있어도 검색 대상에 포함한다. 오류와 충돌은 `codocs_get`이 알린다. 이름이 충돌하는 문서는 같은 주소가 항목에 중복될 수 있으며 의도된 동작이다.
- `scanStatus`와 `partial`은 `list`/`get`과 같은 규칙을 따른다. partial이면 `unconfirmed_reference` 경고를 최상위 `diagnostics`에 담는다.
- 사용 방법은 MCP 서버 instructions와 도구 설명으로 AI에게 안내한다.
- 결과 형태: `{success, scanStatus, items[{address, score, queries, sections?}], emptyQueries, diagnostics?}`.

## 범위

### 포함

- `@codocs/core` 섹션 단위 어휘 검색(한국어 부분 문자열, 영문·숫자 대소문자 무시, 식별자 분리)
- `@codocs/workspace` 검색 질의와 MCP 도구 `codocs_search`, 서버 instructions·도구 설명
- 검색 도달률 benchmark
- 개념 문서(`search-tool.yaml`), README(영문·한국어), 사용 가이드, changeset

### 이번 이슈에서 제외

- Preflight / Context Hook(원문 프롬프트 기반 자동 주입)
- 의미 기반 모델(임베딩, 재순위)
- Codex Hook 연동
- Codocs 기반 post-hook / semantic validation, git diff 기반 규칙 위반 검사

## 검증

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm exec prettier --check .`
- 합성 쇼핑몰 코퍼스 benchmark(`packages/core/src/search/benchmark.test.ts`): 38개 케이스에서 정답 문서에 도달한 케이스 36/38(94.7%), 정답 섹션 75/77(97.4%).
- 놓친 두 케이스는 모두 영어 문서를 한국어 검색어로 찾은 경우다. 어휘 일치 방식의 한계이므로 영어 문서가 있는 프로젝트에서는 검색어에 영어 동의어를 함께 넣도록 안내하는 것을 후속으로 고려한다(이번에는 적용하지 않음).
- 개념 문서, README, 가이드의 결과 형태가 구현과 같은지 대조했다.

## 완료 조건

- [x] 검색 결과의 책임과 반환 형식이 정의되어 있다(`search-tool.yaml`).
- [x] section 단위 검색이 가능하다.
- [x] 관련성이 낮은 결과를 제한할 수 있다(상위 10개, 걸리지 않은 검색어는 `emptyQueries`).
- [x] benchmark query set으로 검색 품질을 측정할 수 있다.
- [x] MCP 도구 `codocs_search`와 서버 instructions가 추가되어 있다.
- [x] 기존 `list`/`get` MCP 흐름과 충돌하지 않는다(전체 테스트 통과).
- [x] README와 사용 가이드, changeset이 갱신되어 있다.
- [ ] Windows에서 테스트를 검증한다(push 전 필요).

## Jira

- https://seojaewan.atlassian.net/browse/COD-65

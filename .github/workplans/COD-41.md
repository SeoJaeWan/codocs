# COD-41 — @codocs 명시 링크·문서↔코드 양방향 탐색을 최신 main 기준으로 층별 재구현

코드·테스트의 명시적 {{@codocs [[문서]]}}, {{#L11}}, {{#L11-L12}} 표기로 {{.codocs}} 문서 전체·행·행 범위로 이동하고, 문서에서 참조한 코드 위치로 돌아가는 탐색을 제공한다. [COD-29|https://seojaewan.atlassian.net/browse/COD-29]의 목표와 합의를 그대로 잇되, 오래된 기반에서 작성된 [PR #36|https://github.com/SeoJaeWan/codosc/pull/36]을 머지하지 않고 최신 main에서 새 브랜치로 층별로 옮긴다.

PR #36을 main에 머지해 본 결과(2026-09-29~30) Windows에서 검증되지 않은 테스트 실패, main의 원문 이동 실패 기록 규칙과 맞지 않는 조용한 실패, 옛 테스트 실행기 잔재가 드러났다. 특히 MCP 저장 경로에 추가된 코드 연결 영향 계산 때문에 main에서 안정적이던 MCP 저장 테스트({{authoring}}, {{write-race}})가 실행 1회당 약 20% 간헐 실패했다(main 50회 0회 실패). main을 오염시키지 않기 위해 검증된 부분만 옮기고 층마다 main의 기존 테스트 안정성을 확인한다.

h2. 범위

h3. 1층 core

* {{core/src/code-reference}}: 언어·확장자와 무관한 {{@codocs}} 표기 추출·이름/도메인·행 해석과 오류 구분.
* 잘못된 표기의 진단 코드({{core/src/diagnostics}}), 참조 추출 재사용({{core/src/references}}), 공개 진입점.

h3. 2층 workspace 코드 참조 색인

* {{workspace/src/code-reference}}, {{paths/code-file-access}}, {{watcher/code-reference-watcher}}: Git 추적·{{.gitignore}}·재포함·비 Git 규칙에 따른 코드 수집, 열린 버퍼 overlay, 역참조, 선택 토큰 확인, 감시 갱신.
* 조회 세션에는 IDE용 코드 참조 API만 추가한다. 문서 저장({{write()}})·{{storage}} 경로는 변경하지 않는다.
* PR #36 통합 과정에서 찾은 수정을 포함한다: 공개 경로의 {{/}} 정규화, {{close()}}에서 진행 중 수집·감시 시작 대기, 파일 심볼릭 링크 테스트의 lstat 주입.

h3. 3층 language-server·VS Code {{@}} 링크

* 명시 링크(DocumentLink), 잘못된 표기의 밑줄·이유 Hover, 행 역참조의 단일 직접 이동·복수 Hover 개별 링크, 기존 YAML 이름 링크와의 공존, 문서 전체 Inlay Hint.
* 원문 열기의 행·출현 선택과, 확인된 목적지가 현재 원문에 없을 때 {{destination_unavailable}} 사유를 Output에 기록.
* 실제 VS Code UI 대표 사례 10개(A1~A5 명시 링크, B1~B3 역참조, C1~C2 Inlay)와 driver의 Inlay 클릭 기능.
* 간헐 실패하던 {{server-session/code-navigation.test.ts}} 3건(수집 완료 전 확인)을 고쳐서 옮긴다. 재시작 뒤 이전 세션 링크 거부 테스트를 포함한다.
* {{.codocs}}·사용자 가이드·README·예시의 {{@codocs}} 작성법 안내.

h2. 범위 밖

* MCP {{codocs_write}}의 코드 연결 영향 안내({{writeImpact}}), 이를 위한 {{workspace/src/write-impact}}, {{core/src/change-impact}}, 저장 경로({{write()}}·{{storage}}·{{save-context}}) 변경. main의 MCP 저장 테스트를 흔들지 않는 설계가 증명될 때까지 후속 이슈로 분리한다. main {{.codocs/mcp/write-impact.yaml}}의 계약과 구현 차이는 후속 이슈에서 추적한다.
* PR #36의 옛 테스트 인프라(설치 MCP 검사, 옛 VS Code 실행기)와 성능 관측.
* {{[[]]}} YAML 링크의 재시작 테스트 공백.

h2. 진행 기준

* main을 대상으로 PR을 보내고 merge commit으로 병합한다.
* 층별로 커밋하고, 각 층마다 아래 검증을 통과한 뒤 다음 층으로 진행한다.
* PR #36의 작업 계획({{COD-29.md}})·결정 기록과 Inlay 시제품 근거({{COD-29-results/header-prototype*}})를 이 PR로 옮긴다. PR #36은 이 이슈 링크를 남기고 닫는다.
* 제품 기능 변경이므로 changeset({{codocs}} patch)을 추가한다.
* 커밋 훅을 우회하지 않는다.

h2. 검증

* 층마다: typecheck·lint·{{prettier . --check}}·{{pnpm test}}, 그리고 main에 원래 있던 테스트를 포함한 전체 {{vitest run}} 30회 연속 실패 0회(Windows 로컬).
* 표기: 주석·문자열·확장자 없는 파일, 도메인 지정, 한글·이모지 UTF-16 위치, LF/CRLF, 잘못된 형식·역전·0행·범위 초과·모호함·대상 없음.
* 색인: Git 추적 ignored 포함·미추적 ignored 제외·하위 ignore/재포함·비 Git·링크/정션/{{.git}}/바이너리 제외, overlay·닫기·감시 갱신, 수집 중·불완전 상태에서 유일·부재를 확정하지 않음.
* IDE: 미저장 대상의 실제 행 선택, 끝 행이 없으면 이동하지 않고 {{destination_unavailable}} 기록, 오래된 토큰·재시작 뒤 링크 거부.
* CI(Windows·macOS 고정 VS Code 버전) {{test:vscode}}의 19개 UI 사례와 {{required-ci}} 통과.

h2. 완료 기준

* 실제 VS Code에서 명시 링크, 행 역참조, 문서 전체 Inlay의 이동이 동작한다.
* main의 기존 테스트(특히 MCP 저장 테스트)가 반복 실행에서 흔들리지 않는다.
* {{.codocs}}·가이드·README가 구현과 일치하고 MCP 영향 안내가 후속으로 명시된다.
* {{required-ci}}가 통과한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-41

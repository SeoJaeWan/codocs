# COD-44 — 코드 참조 감시가 무관한 경로의 watch 오류(EPERM)로 수집 불완전에 고정되는 문제: 감시 범위·실패 처리·복구 흐름 개선

0.0.3에서 {{.codocs}} 문서를 호버하면 {{확인된 코드 N곳 · 수집 불완전}}과 {{Error: EPERM: operation not permitted, watch}}가 표시되고, 이후에도 풀리지 않는다. Windows와 macOS에서 모두 발생한다.

h2. 원인

호버·링크·인레이 힌트의 {{prepare()}}가 코드 참조 수집과 {{CodeReferenceWatcher}}를 시작한다. 이 감시 흐름에는 구조적인 문제가 두 가지 있고, EPERM은 그 계기일 뿐이다.

# *감시 범위가 수집 범위와 다르다.* 수집({{discoverCodeFiles}})은 {{git ls-files}}와 프로젝트 {{.gitignore}}를 따른다. 반면 {{code-reference-watcher.ts}}의 루트 watcher는 {{.git}} 내부만 빼고 프로젝트 전체({{node_modules}}·{{dist}}·캐시 포함)에 네이티브 {{fs.watch}}를 건다. 참조와 무관한 폴더가 지워지거나, 다시 만들어지거나, 잠기거나, 권한이 없으면 watch 오류가 난다.
# *감시 오류 하나가 전체 수집을 계속 무효로 만든다.* {{code-reference/index.ts}}의 {{#failed}}는 어떤 경로의 어떤 오류든 {{#watchFailure}}로 기록하고 전체 상태를 {{incomplete}}로 게시한다. 이 기록은 경로 지정 없는 전체 refresh에서만 지워진다. 파일 변경으로 도는 부분 refresh로는 풀리지 않으므로, 오류가 일시적이어도 상태가 {{incomplete}}에 고정된다.

비동기 {{FSWatcher}} 오류에는 경로가 담기지 않는다. 그래서 메시지가 {{watch}}에서 끝나고 사용자는 어느 경로가 원인인지 알 수 없다. chokidar 5.0.0에는 {{ignorePermissionErrors}}가 꺼져 있다. Windows에는 "경로를 다시 열 수 있을 때만 오류를 전달"하는 우회가 있지만, macOS에는 없어서 EPERM이 그대로 전달된다.

현재 동작은 「작업 공간 감시」의 "코드 출현 감시" 절(코드 감시 오류는 incomplete로 게시, 명시 refresh에서 재등록)에 적힌 계약과 일치한다. 따라서 이 계약도 함께 바꾼다.

h2. 재현 (Windows, chokidar 5.0.0, 같은 감시 옵션)

* 감시 시작만 함(저장소 전체), 감시 중 폴더 삭제만 함: 오류 없음.
* 감시 중 {{dist}}를 지우고 곧바로 다시 만드는 동작 10회: 3번 실행 모두 {{EPERM: operation not permitted, watch}} 발생, {{path}} 없음.
* 같은 동작 + {{ignorePermissionErrors: true}}: 3번 실행 모두 오류 0건.
* macOS의 구체적인 원인 경로는 아직 확인하지 않았다. TCC 보호 위치나 읽기 권한이 없는 파일로 추정한다.

h2. 범위

h3. workspace: 감시 범위

* 코드 참조 루트 watcher의 감시 대상을 수집 기준(Git 추적 파일·프로젝트 {{.gitignore}})과 맞춘다. 수집 대상이 될 수 없는 경로는 감시하지 않는다.
* {{.gitignore}}나 Git index가 바뀌어 감시 대상이 달라지면 감시를 다시 구성한다. 이 과정에서 변경을 놓치지 않는다.

h3. workspace: 실패 처리

* 권한 계열(EPERM·EACCES) 오류처럼 경로 하나에 국한된 오류는 전체 수집 실패로 취급하지 않는다. 해당 경로만 실패로 남기거나 걸러낸다.
* 감시 연결 자체가 깨진 경우에만 전체 수집을 {{incomplete}}로 둔다.

h3. workspace: 복구

* 감시 오류가 나면 사용자가 명시적으로 refresh하지 않아도 watcher를 다시 등록하고 전체 재확인을 한 번 실행한다. 재등록에 성공하면 {{complete}}로 돌아간다.
* 재시도가 무한히 반복되지 않도록 한도나 간격을 둔다.

h3. 문서

* 「작업 공간 감시」의 "코드 출현 감시" 절과 「코드 참조 색인」의 감시 범위·실패·복구 계약을 구현에 맞게 고친다.
* 호버에 보이는 실패 안내에서 경로가 없는 watch 오류를 사용자가 이해할 수 있게 표시하는 방식을 검토한다.

h2. 범위 밖

* 문서({{.codocs}}) 감시인 {{WorkspaceWatcher}}의 구조 변경.
* chokidar 교체나 polling 전환.
* 호버·인레이 힌트 문구 체계 전면 개편.

h2. 진행 기준

* main을 대상으로 PR을 보내고 merge commit으로 병합한다.
* 제품 동작 변경이므로 changeset을 추가한다.

h2. 검증

* 회귀: 감시 중 무시 대상 폴더({{dist}} 등)를 지우고 다시 만들어도 코드 참조 상태가 {{complete}}로 유지된다.
* 권한 오류: 감시 대상 안에서 EPERM·EACCES가 나도 전체 상태가 계속 {{incomplete}}에 머물지 않는다.
* 복구: 감시 연결이 실패한 뒤 자동으로 재등록하고 전체 재확인을 거쳐 {{complete}}로 돌아간다. 재시도 한도가 지켜진다.
* 범위 재구성: {{.gitignore}} 변경 뒤 새로 포함되거나 빠진 경로의 변경 관측이 맞다.
* 기존 코드 참조 감시 테스트(Git index 원자 교체, 준비 중 종료 등)가 계속 통과한다.
* macOS에서 실제 원인 경로를 확인하고 재현 여부를 기록한다.
* typecheck·lint·format:check·Vitest·build, Codocs validate, CI 통과.

h2. 완료 기준

* Windows·macOS에서 무관한 경로의 watch 오류로 호버가 {{수집 불완전}}에 고정되지 않는다.
* 감시 범위가 수집 범위와 일치한다.
* 감시 실패 뒤 자동으로 복구된다.
* {{.codocs}} 감시 계약이 구현과 일치한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-44

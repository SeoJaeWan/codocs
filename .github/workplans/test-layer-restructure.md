# 테스트 계층 재구성

## 배경

기능 테스트 밖의 계층(MCP·언어 서버 프로세스 테스트, VS Code 확장 테스트, 배포 산출물 검증)은 여러 번 바뀌면서 각 계층이 무엇을 보장하는지 기준이 흐려졌다.

- 응답 테스트가 실행하는 코드와 배포되는 코드가 다른 빌드다. MCP stdio 테스트는 테스트 전용 esbuild 번들(`packages/mcp/test-support/source-cli.ts`)을, 언어 서버 프로세스 테스트는 테스트 안에서 따로 만든 번들을 실행한다. 그래서 응답 테스트가 통과해도 배포 빌드의 파일 누락·번들하지 않은 의존성·진입점 오류는 드러나지 않는다.
- 배포 검증(`pnpm release:verify`)은 tgz를 설치해 시작·서버 버전·도구 등록만 확인하고, VSIX는 구성과 manifest만 확인한다. VSIX 안의 확장 번들(`dist/index.cjs`)과 언어 서버 번들(`dist/server/index.cjs`)은 한 번도 실행되지 않는다.
- `packages/mcp/src/server/*.test.ts`는 도구의 계산·입력·오류 조합까지 프로세스를 띄워 검증한다. 「테스트 컨벤션」은 이 조합을 담당 코드 옆에서 검증하고 stdio 출력·종료·요청 연결만 실제 프로세스 경계로 확인하도록 정한다.

2026-10-12 os-specific-behavior 작업에서는 설치한 VSIX의 활성화를 더는 검증하지 않기로 했다. 이 작업은 화면 조작 없이 VS Code API 값으로 활성화를 다시 검증하므로 그 결정을 바꾼다.

## 테스트 원칙 (2026-10-13 합의)

- 직접 확인하는 영역을 두지 않는다. 기준은 우리 코드가 돌려주는 값이며 모두 코드로 확인한다.
- 화면 렌더링, 외부 MCP 클라이언트 앱, 실제 Windows·macOS 실행, 게시 후 설치, 사용성은 테스트 대상이 아니다. OS 차이는 platform 주입, MCP는 서버 응답, VS Code는 Hover 등 VS Code API가 돌려주는 값으로 확인한다.

## 목표

기능 테스트 밖의 계층이 각각 무엇을 보장하는지 정하고, 배포한 tgz·VSIX가 실제로 뜨고 응답하는지를 한 흐름의 검증으로 확인한다.

## 범위

### 배포 산출물 검증

- 정적 확인(파일 구성·manifest·고지)을 유지한다.
- tgz는 저장소 밖 offline 설치, 설치한 bin 실행, 서버 이름·버전·도구 등록 확인을 유지한다.
- VSIX를 푼 폴더를 공식 도구(`@vscode/test-cli`·`@vscode/test-electron`)로 실제 VS Code에서 실행하고 확장 활성화, 명령 등록, Hover 값 하나를 VS Code API로 확인한다. 화면은 조작하지 않는다.
- VS Code 실행 검증은 산출물 검증과 한 흐름으로 PR CI의 `pack` job에서 Ubuntu `xvfb-run`으로 실행하며 커밋 훅에는 넣지 않는다.
- VS Code 실행 검증이 확장에서 서버 연결까지 확인하므로 VSIX 언어 서버를 따로 띄우는 검사는 두지 않는다.

### MCP 프로세스 테스트

- 도구의 계산·입력·오류 조합 검증을 담당 코드 옆 테스트로 옮기고, 프로세스 테스트에는 stdout 출력·종료·요청 연결 확인만 남긴다.
- 옮기기 전에 기존 테스트와 옮길 위치의 테스트가 같은 조건을 확인하는지 대조한다.

### 문서

- 「테스트 컨벤션」·「배포」·「검사와 병합」을 이 기준에 맞게 고친다.

## 범위 밖

- concepts 문서와 테스트 대조, 문서에 대응하지 않는 테스트의 판정, 고정 시간 대기·권한 `skipIf` 정리(후속 「문서·테스트 대조」 작업)
- 화면 렌더링·외부 MCP 클라이언트 앱·실제 OS·게시 후 설치·사용성 검증
- 새 기능 추가

## 검증

- PR CI의 `pack` job에서 VSIX를 실제 VS Code로 실행하는 검증이 돌고 통과한다.
- MCP 도구 조합 검증을 옮기기 전후로 같은 조건을 확인하는지 대조한 결과를 남긴다.
- typecheck, lint, test, format check와 PR CI(static·pack·test)를 통과한다.

## 완료 기준

- 기능 테스트 밖의 각 계층이 보장하는 것과 보장하지 않는 것이 「테스트 컨벤션」에 적혀 있다.
- 배포한 tgz·VSIX가 실제로 뜨고 응답하는지 PR CI에서 확인된다.
- MCP 프로세스 테스트는 stdout 출력·종료·요청 연결만 검증하고, 도구 조합은 담당 코드 옆에서 검증된다.

## MCP 테스트 대조표

`packages/mcp/src/server`의 도구 조합 테스트를 지우거나 옮기기 전에 두 테스트의 본문을 열어 같은 조건과 같은 관찰값을 확인했다. 기준 커밋은 `1c83c46`이며 MCP 쪽 줄 번호는 이 커밋의 파일 기준이다. 대응 테스트의 줄 번호는 `it` 선언 줄이고 `workspace/`는 `packages/workspace/src/`, `core/`는 `packages/core/src/`, `mcp/`는 `packages/mcp/src/`다.

MCP 경계가 확인하는 것은 입력 파싱 결과를 `invalid_input`으로 바꾸는 일, `wrapCodocsResult`의 포장(`content` 텍스트와 `structuredContent`의 동일성, `isError`), 이름 변경의 ID→경로 조회, 도구 목록·스키마·설명이다. 이 항목은 지우지 않고 in-process 테스트(`InMemoryTransport`)로 옮겼다. 그 밖의 계산·오류 조합은 같은 조건을 확인하는 workspace·core 테스트가 있을 때만 지웠다.

### 결과 집계

- 기준 커밋의 `authoring`·`batch-write`·`rename`·`section-management`·`server` 테스트 68건 중 지움 42건, in-process로 옮김 21건, 프로세스 계약으로 남김 5건이다. `write-race.test.ts`와 `state.test.ts`는 바꾸지 않았다.
- 프로세스 테스트(`createSourceCli`·`StdioClientTransport`·`spawn` 사용)는 `server.test.ts`와 `write-race.test.ts`만 남았다.
- 도구 여덟 개의 응답 형태 테스트와 도구 목록 테스트는 새 파일 `tool-responses.test.ts`(28건)와 `tool-listing.test.ts`(15건)에 있다.

### 지운 테스트와 대응 테스트

| MCP 테스트 (기준 커밋)                                                                                                             | 같은 조건을 확인하는 테스트                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batch-write.test.ts:185` 새 문서를 만들고 기존 두 문서가 그 문서를 참조하도록 고치는 요청을 한 번에 저장한다                      | `workspace/batch-write/batch-write.test.ts:73` A 생성과 B·C 수정을 한 번에 저장하면 세 항목이 changed이고 색인에서 A 참조가 확정된다                                                                                                                                                           |
| `batch-write.test.ts:222` 한 항목에 검증 오류가 있으면 아무것도 저장하지 않고 모든 파일을 그대로 둔다                              | `workspace/batch-write/batch-write.test.ts:124` 한 항목이 검증 오류면 아무것도 저장하지 않고 모든 파일 바이트가 그대로다                                                                                                                                                                       |
| `batch-write.test.ts:245` 두 문서의 revision이 오래되면 두 문서를 모두 진단하고 저장하지 않는다                                    | `workspace/batch-write/batch-write.test.ts:150` 두 문서의 revision이 오래되면 두 경로를 모두 진단에 담고 저장하지 않는다, `workspace/batch-write/batch-write.test.ts:600` 반영 직전 재스캔 전에 두 문서가 바뀌면 바뀐 문서를 모두 진단에 담고 저장하지 않는다(`change_revision_mismatch` 코드) |
| `batch-write.test.ts:275` 빈 changes와 알 수 없는 최상위 속성은 invalid_input이며 파일을 바꾸지 않는다                             | `workspace/batch-write/batch-write.test.ts:180` 빈 changes와 중복 ID·경로와 changes 외 속성은 invalid_input으로 거절한다, `mcp/tool-input/tool-input.test.ts:90` write changes는 1개 이상의 항목만 받고 … 다른 최상위 속성은 거부한다(`changes`와 최상위 `mode` 혼합)                          |
| `batch-write.test.ts:292` 같은 문서 ID나 같은 경로가 두 번 나오면 invalid_input으로 전체를 거부한다                                | `workspace/batch-write/batch-write.test.ts:180`(같은 ID), `core/change-plan/multi-change.test.ts:225` create 경로가 move의 새 경로와 같으면 invalid_input으로 실패한다(같은 경로)                                                                                                              |
| `batch-write.test.ts:320` 항목에서 name을 바꾸면 name_change_not_allowed로 거부한다                                                | `workspace/batch-write/batch-write.test.ts:209` 항목의 name 변경은 name_change_not_allowed로 거절한다                                                                                                                                                                                          |
| `batch-write.test.ts:344` 다른 문서가 참조하는 문서의 삭제는 reference_broken으로 거부하고 파일을 남긴다                           | `workspace/batch-write/batch-write.test.ts:245` 참조되는 문서의 delete는 reference_broken이고 참조를 함께 고치면 저장되어 색인에서 사라진다                                                                                                                                                    |
| `batch-write.test.ts:359` 코드 파일이 @codocs로 참조하는 문서의 삭제는 거부한다                                                    | `workspace/batch-write/batch-write.test.ts:286` 코드가 @codocs로 참조하는 문서의 delete는 거절한다                                                                                                                                                                                             |
| `batch-write.test.ts:408` 단일 delete 요청도 저장하고 비게 된 폴더는 .codocs 바로 아래까지 제거하되 원래 빈 폴더는 남긴다          | `workspace/batch-write/batch-write.test.ts:432` delete·move로 비게 된 폴더만 .codocs 아래까지 제거하고 원래 빈 폴더는 남긴다                                                                                                                                                                   |
| `batch-write.test.ts:428` 자식 문서의 parent가 새로 끊기는 삭제는 거부하고 자식 위치를 진단에 담으며 자식도 함께 삭제하면 저장한다 | `workspace/batch-write/batch-write.test.ts:454` 자식이 있는 문서 delete는 거절하고 같은 batch에서 자식도 지우면 저장한다, `core/change-plan/multi-change.test.ts:335` 자식이 있는 문서를 지우면 자식 파일의 parent 항목 위치를 담아 reference_broken으로 실패한다(`fieldPath`)                 |
| `batch-write.test.ts:461` 문서를 새 경로로 옮겨도 같은 이름으로 조회되고 참조가 유지된다                                           | `workspace/batch-write/batch-write.test.ts:362` move는 같은 ID·이름과 참조를 유지하고 옛 경로를 색인에서 지우며 단일 결과에 previousPath를 담는다                                                                                                                                              |
| `batch-write.test.ts:524`(2행) create 경로의 역슬래시·연속 슬래시는 /로 정규화해 저장한다                                          | `workspace/storage/storage.test.ts:448` create 경로의 %s는 /로 정규화해 .codocs/orders/a.yaml에 저장한다(같은 두 행, `source.path` 단언 포함). MCP 서버는 경로를 가공하지 않으므로 MCP 쪽 고유 조건이 없다                                                                                     |
| `batch-write.test.ts:568` get의 문서 경로와 역슬래시 validate 입력도 OS와 무관하게 동작한다                                        | `workspace/query/query.test.ts:259` 경로 %s의 역슬래시와 연속 슬래시는 /로 바꿔 같은 파일을 검증한다, `mcp/query/query.test.ts:793` 상세 결과의 source.path를 workspace가 만든 / 경로 그대로 돌려준다                                                                                          |
| `section-management.test.ts:108` 문서 전체를 교체해 생략한 섹션을 삭제하고 최상위 주석을 보존한다                                  | `core/change-plan/replace.test.ts:59` 생략한 섹션을 삭제하고 같은 값의 원문 주석과 따옴표와 간격은 보존한다, `workspace/query/query-code-diagnostics.test.ts:285` 전체 교체로 코드가 참조하지 않는 섹션을 삭제하면 저장하고 색인에 게시한다                                                    |
| `section-management.test.ts:132` 같은 내용의 교체는 변경 없음으로 파일을 바꾸지 않는다                                             | `core/change-plan/replace.test.ts:96` 입력 순서만 바꾸면 변경 없음으로 처리한다, `workspace/write/write.test.ts:115` 무변경과 저장 전 충돌은 바이트를 보존하며 무변경에 색인 결과를 붙이지 않는다                                                                                              |
| `section-management.test.ts:148` replace에 set·unset을 섞거나 알 수 없는 속성이 있으면 입력 오류이며 파일을 바꾸지 않는다          | `core/change-plan/replace.test.ts:109` name을 바꾸거나 _codocs가 없거나 알 수 없는 속성이 있으면 거절한다, `mcp/tool-input/tool-input.test.ts:47` write replace는 id·revision·document만 받고 set·unset 혼합과 알 수 없는 속성을 거부한다                                                      |
| `section-management.test.ts:169` 교체가 다른 문서의 섹션 참조를 새로 깨뜨리면 reference_broken으로 거절하고 원문을 보존한다        | `core/change-plan/replace.test.ts:156` 전체 교체로 참조된 섹션을 생략해도 같은 이유로 거절한다, `core/change-plan/replace.test.ts:139`(참조한 파일 경로·위치 진단)                                                                                                                             |
| `section-management.test.ts:192` 교체가 코드 파일의 @codocs 섹션 참조를 새로 깨뜨리면 reference_broken으로 거절한다                | `workspace/query/query-code-diagnostics.test.ts:310` 코드가 참조하는 섹션을 삭제하면 거절하고 원문 바이트를 보존한다                                                                                                                                                                           |
| `section-management.test.ts:213` 이전부터 있던 무관한 오류는 교체를 막지 않는다                                                    | `core/change-plan/replace.test.ts:164` 참조되지 않은 섹션 삭제는 허용하고 무관한 기존 오류는 막지 않는다                                                                                                                                                                                       |
| `section-management.test.ts:232` 오래된 revision의 교체는 revision을 바꿔 재시도하지 않고 거절한다                                 | `core/change-plan/replace.test.ts:122` revision이 다르면 거절한다(`change_revision_mismatch`). MCP 응답으로의 전달은 `tool-responses.test.ts:276`이 확인한다                                                                                                                                   |
| `section-management.test.ts:252` 전체 검증은 코드 파일 경로와 위치를 가진 오류와 코드 수집 상태를 반환한다                         | `workspace/query/query-code-diagnostics.test.ts:49` 경로를 생략하면 전체 코드의 확정 오류를 원본 경로·위치·error로 돌려준다                                                                                                                                                                    |
| `section-management.test.ts:270` YAML 경로 검증은 그 YAML을 후보로 하는 코드 진단만 포함하고 코드 경로는 거절한다                  | `workspace/query/query-code-diagnostics.test.ts:100`(후보 YAML만), `workspace/query/query-code-diagnostics.test.ts:119`(코드 파일 경로 거절)                                                                                                                                                   |
| `section-management.test.ts:290` 첫 refresh가 코드 색인을 만들고 개수가 반환된 진단과 일치한다                                     | `workspace/query/query-code-diagnostics.test.ts:211` 세션의 첫 refresh부터 코드 표기를 수집해 진단 수와 일치하는 집계를 돌려준다                                                                                                                                                               |
| `rename.test.ts:157` 프로젝트에 새 이름의 문서가 있으면 blocked와 충돌을 반환하고 파일을 바꾸지 않는다                             | `workspace/rename/rename.test.ts:215` 프로젝트에 새 이름과 같은 문서가 있으면 충돌 후보와 함께 blocked로 보고한다                                                                                                                                                                              |
| `rename.test.ts:215` 원래 모호한 참조는 선택이 없으면 원문 그대로 두고 unresolved로 반영한다                                       | `workspace/storage/storage-rename.test.ts:106` 고를 참조가 남은 unresolved 상태도 반영하고 고르지 않은 참조는 원문 그대로 둔다                                                                                                                                                                 |
| `rename.test.ts:262` 프로젝트에 새 이름의 문서가 있으면 rename_blocked로 거절하고 파일을 바꾸지 않는다                             | `workspace/storage/storage-rename.test.ts:138` 새 이름과 같은 문서가 있으면 blocked로 거절하고 파일을 바꾸지 않는다                                                                                                                                                                            |
| `rename.test.ts:286` preview 뒤 영향 파일을 바꾸면 revision_conflict로 거절하고 아무 파일도 바꾸지 않는다                          | `workspace/rename/rename.test.ts:461`, `workspace/storage/storage-rename.test.ts:158` 미리보기 뒤 영향 파일의 내용이 바뀌면 revision_conflict로 거절하고 파일을 바꾸지 않는다. MCP 응답으로의 전달은 `tool-responses.test.ts:491`                                                              |
| `rename.test.ts:307` preview 뒤 영향 파일 집합이 달라지면 rename_affected_files_changed로 거절한다                                 | `workspace/storage/storage-rename.test.ts:179` 미리보기 뒤 새 파일이 영향 파일에 더해지면 영향 파일 집합 변경으로 거절하고 미리보기를 안내한다(감시 반영을 기다리는 `vi.waitFor`도 함께 사라진다)                                                                                              |
| `rename.test.ts:378` section preview는 섹션 이름을 oldName·newName으로 돌려주고 targetSection을 더하며 파일을 바꾸지 않는다        | `workspace/rename/section-rename.test.ts:69`, `workspace/rename/section-rename.test.ts:102`                                                                                                                                                                                                    |
| `rename.test.ts:399` section apply는 키와 확정 참조를 고치고 나머지 원문은 그대로 둔다                                             | `workspace/rename/section-rename.test.ts:252` 미리보기의 revision으로 반영하면 키와 확정 참조만 바꾸고 색인에 새 섹션을 게시한다                                                                                                                                                               |
| `rename.test.ts:421` 같은 이름의 섹션이 있으면 section_conflict로 blocked이고 apply는 파일을 바꾸지 않는다                         | `workspace/rename/section-rename.test.ts:121` 같은 이름의 섹션이 있으면 section_conflict로 blocked이며 충돌 문서를 보고한다, `workspace/rename/section-rename.test.ts:340` 섹션 충돌이면 rename_blocked로 거절하고 아무 파일도 바꾸지 않는다                                                   |
| `rename.test.ts:447` 없는 섹션은 section_not_found로 blocked다                                                                     | `workspace/rename/section-rename.test.ts:280` 대상 섹션이 없어 section_not_found로 blocked다, `workspace/rename/section-rename.test.ts:340`(없는 섹션 행)                                                                                                                                      |
| `rename.test.ts:461` section preview 뒤 영향 파일을 바꾸면 revision_conflict로 거절하고 아무 파일도 바꾸지 않는다                  | `workspace/rename/section-rename.test.ts:292`, `workspace/rename/section-rename.test.ts:312`                                                                                                                                                                                                   |
| `rename.test.ts:481` section이 비어 있으면 invalid_input이다                                                                       | `workspace/rename/section-rename.test.ts:241` 섹션 입력이 비어 있거나 문자열이 아니면 invalid_input이다, `mcp/tool-input/tool-input.test.ts:241` 이름 변경 입력은 %s이면 거부한다(빈 section 행)                                                                                               |
| `rename.test.ts:489` section 없는 기존 요청은 문서 이름 변경이며 알 수 없는 속성은 계속 invalid_input이다                          | `workspace/rename/section-rename.test.ts:110` 문서 이름 변경 응답에는 targetSection이 없다, `mcp/tool-input/tool-input.test.ts:241`(알 수 없는 속성 행)                                                                                                                                        |
| `rename.test.ts:523` 섹션 이름 변경 preview는 코드 변경을 fileKind code로 보고하고 apply는 코드 파일을 고친다                      | `workspace/rename/code-rename.test.ts:92`(preview), `workspace/rename/code-rename.test.ts:125`(apply)                                                                                                                                                                                          |
| `rename.test.ts:569` 미리보기 뒤 코드 파일이 바뀌면 apply는 revision_conflict로 거절하고 아무 파일도 바꾸지 않는다                 | `workspace/rename/code-rename.test.ts:191`                                                                                                                                                                                                                                                     |
| `rename.test.ts:598` update의 set.name이 현재 이름과 다르면 저장하지 않고 codocs_rename을 안내한다                                 | `workspace/write/write.test.ts:96` 수정 요청의 name이 현재 이름과 다르면 저장하지 않고 이름 변경 도구를 안내한다                                                                                                                                                                               |
| `rename.test.ts:616` update의 set.name이 현재 이름과 같으면 변경 없음으로 처리한다                                                 | `workspace/write/write.test.ts:115`(`same` 단언)                                                                                                                                                                                                                                               |
| `server.test.ts:144` codocs_search의 입력 위반은 invalid_input으로 거부한다                                                        | `mcp/tool-input/tool-input.test.ts:151` search 입력은 검색어 1~~10개, 각 1~~200자만 받고 순서와 중복을 보존한다. MCP 응답 형태는 `tool-responses.test.ts:557`의 `codocs_search` 행                                                                                                             |
| `server.test.ts:276` codocs_validate에 하위 .codocs 문서 경로를 주면 그 문서를 / 구분 경로로 검증한다                              | `workspace/query/query-nested-codocs.test.ts:113` 하위 .codocs 문서 경로로 검증하면 그 파일의 진단을 돌려준다                                                                                                                                                                                  |

### in-process로 옮긴 테스트

| MCP 테스트 (기준 커밋)                                                                                                  | 새 위치                                                                                                           | 옮긴 이유                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authoring.test.ts:60`, `:118`, `:196` 가이드 작성 절차 세 건                                                           | `authoring.test.ts:33`, `:76`, `:132`                                                                             | 도구 간 revision 전달 흐름이라 도구 단위로 확인하고, 연결만 `InMemoryTransport`로 바꿨다                                                                                                |
| `batch-write.test.ts:545` create 결과의 source.path를 move와 validate 입력에 그대로 넣으면 성공한다                     | `authoring.test.ts:184`                                                                                           | 결과 경로를 다음 도구 입력에 쓰는 연결이며 workspace 테스트에는 같은 조합이 없다. 구조 변경 뒤 색인 재구성은 `session.refresh()`를 기다린다                                             |
| `batch-write.test.ts:157` 최상위 type이 object이고 changes·delete·move를 노출한다                                       | `tool-listing.test.ts:77`                                                                                         | `ListTools`는 MCP만의 응답이다. replace도 함께 확인한다                                                                                                                                 |
| `batch-write.test.ts:171`(2행), `server.test.ts:261`(2행) 도구 설명의 path 규칙과 하위 .codocs 경로 예시                | `tool-listing.test.ts:89`(2행)                                                                                    | 두 파일의 같은 구조 행을 한 `it.each`로 합쳤다                                                                                                                                          |
| `server.test.ts:85` 도구 목록과 서버 instructions로 노출하고 실제 문서를 검색한다                                       | 프로세스 스모크 `server.test.ts:84`, `tool-listing.test.ts:54`·`:63`, `tool-responses.test.ts:148`                | 연결 확인은 프로세스에 남기고, instructions·스키마·검색 응답 형태는 in-process로 나눴다                                                                                                 |
| `section-management.test.ts:92` codocs_duplicates를 나열하지 않고 호출하면 알 수 없는 도구 오류를 반환한다              | `tool-listing.test.ts:29`, `:48`                                                                                  | 도구 목록과 `McpError`는 MCP만의 응답이다                                                                                                                                               |
| `server.test.ts:172` 쓰기를 포함한 도구를 제공하고 실제 문서를 목록·상세·검증·갱신한다                                  | `tool-listing.test.ts:29`, `tool-responses.test.ts:30`·`:45`(list), `:63`(get), `:172`(refresh), `:189`(validate) | 도구별 응답 형태 테스트로 나눴다                                                                                                                                                        |
| `server.test.ts:304` 큰 정상 문서와 .inf 원문을 혼합 조회해 본문·직접 참조·revision·진단을 전부 보존한다                | `tool-responses.test.ts:88`                                                                                       | 응답 포장이 절단 없이 담는지는 in-process로 확인한다. 실제 stdio 파이프로 1MB 이상 프레임을 보내는 확인은 이 변경으로 없어졌다                                                          |
| `rename.test.ts:112` preview는 파일을 바꾸지 않고 상태·변경 목록·파일별 revisions를 반환한다                            | `tool-responses.test.ts:372`                                                                                      | 포장과 상태·revisions 전달만 남겼다. 변경 목록·파일 불변은 `workspace/rename/rename.test.ts:45`·`:299`·`:320`이 확인한다                                                                |
| `rename.test.ts:190` preview의 revisions를 그대로 보내면 이름과 참조를 고치고 색인 반영을 알린다                        | `tool-responses.test.ts:391`                                                                                      | 포장과 저장 결과·파일별 상태 전달만 남겼다. 파일 내용·색인은 `workspace/rename/rename.test.ts:359`·`workspace/storage/storage-rename.test.ts:74`가 확인한다                             |
| `rename.test.ts:337` revisions가 없는 apply는 invalid_input이며 파일을 바꾸지 않는다                                    | `tool-responses.test.ts:432`                                                                                      | MCP가 만드는 apply 실패 형태(`saved:false`, `changed:false`, `files:[]`)다. workspace 쪽은 `workspace/storage/storage-rename.test.ts:220`                                               |
| `rename.test.ts:177`, `:353` 없는 ID의 preview·apply는 not_found로 실패한다                                             | `tool-responses.test.ts:451`, `:467`                                                                              | ID→경로 조회는 MCP 처리기가 한다(`mcp/query/query.test.ts:507`은 workspace를 대체한 단위 테스트다)                                                                                      |
| `rename.test.ts:133` 원래 모호한 참조는 후보의 이름·경로와 영향 이유를 반환한다                                         | `rename.test.ts:62`                                                                                               | 문서 참조의 `changed_resolution` 영향 이유와 후보에 `domains`가 없음은 workspace 테스트에 없다                                                                                          |
| `rename.test.ts:234` preview가 준 경로로 대상을 고르면 선택한 참조만 선택 대상 기준으로 고친다                          | `rename.test.ts:79`                                                                                               | preview가 준 값을 apply 선택으로 그대로 보내는 연결이다. 문서 apply와 선택의 조합은 workspace 테스트에 없다                                                                             |
| `batch-write.test.ts:376` 같은 요청에서 참조를 함께 고치면 삭제해 저장하고 색인에서 뺀다                                | `tool-responses.test.ts:305`                                                                                      | 삭제·색인 조건은 `workspace/batch-write/batch-write.test.ts:245`가 확인한다. `changes[]` 항목의 `path` 포함·`revision` 없음은 workspace 테스트에 없어 옮겼다                            |
| `batch-write.test.ts:485` changes 안의 move는 항목 결과에 previousPath를 담고 기존 파일이 있는 경로로의 move는 거부한다 | `tool-responses.test.ts:331`                                                                                      | 항목 결과의 `previousPath`는 workspace 테스트에 없다. 기존 경로로의 move 거절은 `workspace/batch-write/batch-write.test.ts:397`, `core/change-plan/multi-change.test.ts:513`이 확인한다 |

### 프로세스 계약으로 남긴 테스트

| 테스트                                                                                                 | 이유                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `server.test.ts:84` 실제 stdio로 연결하면 도구 여덟 개를 나열하고 검색 결과를 JSON-RPC 응답으로 받는다 | 실제 stdio 연결 한 건. 기준 커밋의 `:85`를 도구 목록·검색 한 번으로 줄였다         |
| `server.test.ts:105` 프로세스별 기본 cwd와 상대·절대 project 선택을 분리한다 (`:379`)                  | `--project`·cwd 선택                                                               |
| `server.test.ts:126` raw child의 stdin EOF만으로 종료하고 stdout은 JSON-RPC만 보낸다 (`:400`)          | stdout 출력과 EOF 종료. 응답 도착을 10ms 폴링 대신 stdout 이벤트로 기다리게 바꿨다 |
| `server.test.ts:171` 초기화 이전 EOF도 강제 종료 없이 처리한다 (`:442`)                                | 초기화 전 EOF 종료                                                                 |
| `server.test.ts:186` 시작 실패와 중복 종료에도 연결을 정리한다 (`:457`)                                | 시작 실패와 중복 종료                                                              |
| `write-race.test.ts` 다섯 건                                                                           | 프로세스 경계의 동시 쓰기 경합(바꾸지 않음)                                        |

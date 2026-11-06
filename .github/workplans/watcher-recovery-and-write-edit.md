# 감시 복구와 codocs_write 부분 수정

## 배경

- [#89](https://github.com/SeoJaeWan/codocs/issues/89): 문서 감시가 failed가 된 뒤 대기 변경이 남아 있으면 재동기화가 promise 마이크로태스크로 끝없이 이어져 이벤트 루프가 멈췄다. MCP 요청을 읽지 못해 `codocs_refresh`로도 복구할 수 없었고, 자동 재연결은 서버가 떠 있는 동안 한 번뿐이라 오래 떠 있는 서버는 두 번째 감시 오류에서 failed가 됐다. 감시 오류의 원인은 로그로 남지 않았고, `--project` 없이 상위 폴더에서 시작하면 그 아래 전체를 순회해 응답하지 못했다.
- [#90](https://github.com/SeoJaeWan/codocs/issues/90): `codocs_write` update는 섹션 전체만 바꿀 수 있고 새 섹션은 항상 끝에 붙으며 섹션 순서를 바꿀 방법이 없어, 에이전트가 대량 수정에서 YAML을 직접 고쳤다.
- [#91](https://github.com/SeoJaeWan/codocs/issues/91)은 0.1.0 이후 경로 변경으로 현재 main에서 재현되지 않아 이 작업에서 제외한다.

## 범위

### 감시 복구 (#89)

- 감시가 failed인 동안에는 대기 변경이 남아도 재동기화를 반복하지 않는다. 남은 변경은 다시 연결하거나 refresh할 때 전체 재확인으로 반영한다.
- 자동 재연결을 무제한으로 한다. 오류가 나면 바로 다시 연결하고, 실패하면 1초·5초·30초 뒤, 그 뒤로는 60초마다 시도한다. 연결에 성공하면 간격을 처음으로 되돌린다. 기다리는 동안 상태는 failed이고 `codocs_refresh`는 바로 다시 연결한다.
- 감시가 끊기거나, 다시 연결하지 못하거나, 복구되면 stderr에 원인과 함께 한 줄씩 남긴다. 같은 원인의 반복 실패는 처음 한 번만 남긴다.
- MCP 서버를 `--project` 없이 시작했는데 시작 위치에 `.git`도 `.codocs`도 없으면 탐색하지 않고 도구마다 `project_root_unconfirmed`로 `--project` 지정을 안내한다.

### codocs_write update (#90)

- `edit: [{ section, old, new }]`: 섹션 값 안의 old를 new로 바꾼다. old는 정확히 한 번 나와야 하며(없으면 `edit_text_not_found`, 여러 번이면 `edit_text_ambiguous`) 적은 순서대로 적용한다.
- `position: { 섹션: { after | before: 기준 } }`: 새 섹션과 기존 섹션을 기준 섹션의 뒤·앞으로 옮긴다. 적은 순서대로 적용하고 바로 위 주석을 함께 옮긴다. 없는 섹션·기준은 `change_section_not_found`다.

### 문서

- 「탐색」·「MCP 서버」·「codocs_refresh」·「codocs_write」·「진단」, `codocs_write` 도구 설명, 사용자 가이드 「updating」을 이 동작에 맞게 고친다.

## 범위 밖

- 큰 본문을 파일 경로로 받기, 저장하지 않는 미리보기, `codocs_write` 밖의 직접 수정 감지(#90 논의에서 채택하지 않음)
- 감시 오류를 일으킨 Windows 환경 재현

## 검증

- 감시 failed 중 재동기화 반복 테스트가 수정 전 코드에서 실패하고(재동기화 21회) 수정 뒤 통과한다.
- 재연결 간격·간격 초기화·로그 중복 생략, `--project` 생략 시 표시 확인, edit·position의 core·MCP 테스트를 둔다.
- typecheck, lint, test, format check와 PR CI(static·pack·test)를 통과한다.

## 완료 기준

- 감시가 실패해도 서버가 요청에 응답하고 스스로 다시 연결하며, 원인이 stderr에 남는다.
- `--project` 없이 상위 폴더에서 시작해도 순회하지 않고 안내한다.
- `codocs_write` update로 섹션 일부 수정과 섹션 위치 지정·이동을 할 수 있다.

# 검증과 복구

[전체 순서와 주제](README.md)

## 이름 충돌과 불완전한 탐색

ID가 여러 발견 경로에 있으면 `duplicate_id`다. 같은 이름이 여러 발견 경로에 있으면 폴더가 달라도 `duplicate_name`이다. 이름은 프로젝트 전체에서 유일해야 한다.
`duplicate_id`·`duplicate_name`은 충돌한 모든 파일에 보고하며 진단의 위치는 `_codocs.id` 또는 `_codocs.name`이고 `relatedPaths`에 충돌한 파일 경로를 담는다.
`_codocs.parent`에 적은 이름의 문서가 없으면 `parent_not_found`, `parent`를 따라가면 자기 자신으로 돌아오면 `parent_cycle`이다. 두 오류의 위치는 해당 `parent` 항목이며, `parent_cycle`은 순환에 속한 모든 문서에 보고한다. 탐색이 끝나지 않았으면 없는 이름을 `parent_not_found`로 확정하지 않는다.

일부 파일이나 폴더를 읽지 못한 상태에서는 `scanStatus: partial`과 함께 확인한 결과를 성공으로 제공한다. 이전 색인에서 보존한 문서는 `confirmation: unconfirmed`와 마지막 원문 `revision`을 유지하고, `unconfirmed_reference` 진단으로 최신성·존재를 보장하지 않음을 알린다. 보이지 않은 후보가 있을 수 있으므로 색인에 없는 ID를 `not_found`로 확정하지 않으며, 전체 탐색이 완료된 `scanStatus: complete`에서만 부재·단일 대상·충돌을 다시 계산한다. 프로젝트나 `.codocs` 자체를 탐색하지 못한 `failed`는 `success: false`와 원인을 반환한다.

## 진단 읽기

`codocs_validate({})`는 프로젝트 전체를, `{"path":".codocs/order.yaml"}`은 파일 하나를 검사한다.
진단의 code·message·severity·path와 제공되는 위치를 확인한다. 문서 오류를 정상 보고한 결과도 `success: true`다.
오류는 YAML 구문·`_codocs`와 섹션·허용 값·충돌·`parent` 대상·참조 대상을 수정한 뒤 재검증한다. 경고는 원인을 검토한다.
자연어 설명의 사실 여부나 업무 정책의 타당성을 자동 보장하는 검사는 아니다.

초기화와 전체 refresh 중에는 list/get/write/validate가 준비 중 상태를 알릴 수 있다. 기존 요청의 완료를 기다리고 guide로 안내를 읽는다.
색인 작업이 진행 중이라는 이유만으로 파일 저장이나 refresh를 반복하지 않는다.

## 저장 후 색인 복구

파일 반영 뒤 서버는 저장 경로를 다시 읽어 색인을 갱신하고 응답한다.
첫 관측이 실제로 실패하면 해당 경로를 추가 한 번 관측한다. 느리다는 이유로 실패를 선언하는 고정 복구 제한은 없다.
처리 중에는 완료나 실제 오류를 기다리며, 1초 이상 걸린다는 이유로 create를 다시 실행하지 않는다.

두 관측이 모두 실패하면 `success: true, saved: true, indexUpdated: false`와 저장 바이트의 revision·원인 진단·refresh 안내를 받는다.
이미 저장된 파일을 다시 쓰거나 자동 롤백하지 않는다. 원인을 확인하고 `codocs_refresh({})`로 재구성한다.
refresh도 실패하면 오류에 맞는 파일 접근 수정이나 서버 재시작을 검토하고 무한 재시도하지 않는다.

## refresh 결과와 커서

`codocs_refresh({})`는 원문을 수정하지 않고 전체 색인을 다시 구성한다. 알 수 없는 입력 속성은 거부한다.
동시에 들어온 refresh는 진행 중인 작업과 결과를 공유한다.

| 필드                      | 의미                                                          |
| ------------------------- | ------------------------------------------------------------- |
| fileCount                 | 관측한 파일 수. 읽기·파싱 오류 파일도 포함                    |
| itemCount                 | 필터 없는 목록 항목 수. 충돌 ID는 하나, 식별 불가 파일은 제외 |
| errorCount / warningCount | 파일 수가 아닌 진단 개수                                      |
| countsComplete            | 집계가 전체 범위를 확인했는지 여부                            |
| scanStatus                | complete / partial / failed의 탐색 상태                       |

partial은 확인한 범위와 이전 미확인 문서를 포함할 수 있으며 완전한 집계가 아니다. write·validate는 complete가 될 때까지 차단한다.
complete 또는 partial refresh가 게시되면 이전 목록 cursor는 만료된다. 목록 첫 페이지부터 다시 조회한다.
failed 결과와 원인을 확인하고 오래된 결과를 최신 전체 결과나 빈 목록으로 해석하지 않는다.

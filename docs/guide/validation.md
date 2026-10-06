# 검증과 복구

[전체 순서와 주제](README.md)

## 이름 충돌과 불완전한 탐색

ID가 여러 발견 경로에 있으면 `duplicate_id`다. 같은 이름이 여러 발견 경로에 있으면 폴더가 달라도 `duplicate_name`이다. 이름은 프로젝트 전체에서 유일해야 한다.
`duplicate_id`·`duplicate_name`은 충돌한 모든 파일에 보고하며 진단의 위치는 `_codocs.id` 또는 `_codocs.name`이고 `relatedPaths`에 충돌한 파일 경로를 담는다.
`_codocs.parent`에 적은 이름의 문서가 없으면 `parent_not_found`, `parent`를 따라가면 자기 자신으로 돌아오면 `parent_cycle`이다. 두 오류의 위치는 해당 `parent` 항목이며, `parent_cycle`은 순환에 속한 모든 문서에 보고한다. 탐색이 끝나지 않았으면 없는 이름을 `parent_not_found`로 확정하지 않는다.

일부 파일이나 폴더를 읽지 못한 상태에서는 `scanStatus: partial`과 함께 확인한 결과를 성공으로 제공한다. 이전 색인에서 보존한 문서는 `confirmation: unconfirmed`와 마지막 원문 `revision`을 유지하고, `unconfirmed_reference` 진단으로 최신성·존재를 보장하지 않음을 알린다. 보이지 않은 후보가 있을 수 있으므로 색인에 없는 이름을 `not_found`로 확정하지 않으며, 전체 탐색이 완료된 `scanStatus: complete`에서만 부재·단일 대상·충돌을 다시 계산한다. 프로젝트나 `.codocs` 자체를 탐색하지 못한 `failed`는 `success: false`와 원인을 반환한다.

## 참조 진단

참조 진단은 문서 이름과 섹션을 구분한다. 문서가 없으면 `reference_not_found`, 문서가 여럿이면 `reference_ambiguous`, 문서는 확정됐지만 `[[이름:섹션]]`의 섹션이 없으면 `section_reference_not_found`다. 섹션은 문서가 확정된 참조에서만 확인한다.

## 코드 파일의 참조 진단

코드 파일의 `@codocs [[이름]]`·`@codocs [[이름:섹션]]`도 `codocs_validate`와 `codocs_refresh`가 진단한다. 진단의 `path`는 코드 파일이고 `range`는 표기 위치이며 편집기와 같은 코드 `codocs.codeReference.<상태>`를 쓴다.
`invalid`·`missing`·`missing_section`·`ambiguous`는 오류이고, 문서 탐색이 끝나지 않아 확정하지 못한 `unconfirmed`는 경고다.
`codocs_validate({"path":".codocs/order.yaml"})`는 그 YAML을 후보로 하는 코드 진단만 더하며 코드 파일 경로를 `path`로 주면 `invalid_path`다.
`scanStatus`는 문서 탐색 상태이고 `codeScanStatus`(`collecting`·`complete`·`incomplete`)는 코드 수집 상태다. `diagnosticsComplete`가 `false`이면 확인한 결과만이며 오류가 없다는 뜻이 아니다. 읽지 못한 코드 파일은 `codeFailures`에 있다. 수집 중이면 잠시 뒤 다시 요청한다.

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

## refresh 결과

`codocs_refresh({})`는 원문을 수정하지 않고 전체 색인을 다시 구성한다. 알 수 없는 입력 속성은 거부한다.
동시에 들어온 refresh는 진행 중인 작업과 결과를 공유하며, 첫 refresh는 코드 참조 색인도 만든다.

| 필드                      | 의미                                                |
| ------------------------- | --------------------------------------------------- |
| fileCount                 | 관측한 파일 수. 읽기·파싱 오류 파일도 포함          |
| itemCount                 | 문서 항목 수. 충돌 ID는 하나, 식별 불가 파일은 제외 |
| errorCount / warningCount | 파일 수가 아닌 진단 개수                            |
| countsComplete            | 집계가 전체 범위를 확인했는지 여부                  |
| scanStatus                | complete / partial / failed의 문서 탐색 상태        |
| codeScanStatus            | collecting / complete / incomplete의 코드 수집 상태 |
| codeFailures              | 읽지 못한 코드 파일의 경로와 이유                   |
| diagnostics               | 문서 진단과 코드 참조 진단. 개수는 이 목록과 일치   |

partial은 확인한 범위와 이전 미확인 문서를 포함할 수 있으며 완전한 집계가 아니다. write·validate는 complete가 될 때까지 차단한다.
failed 결과와 원인을 확인하고 오래된 결과를 최신 전체 결과나 빈 목록으로 해석하지 않는다.

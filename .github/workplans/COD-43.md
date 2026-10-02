# COD-43 — .codocs 문서 정비 및 문서↔코드 링크 정합성 점검

선행 작업: [COD-42](https://seojaewan.atlassian.net/browse/COD-42), [PR #55](https://github.com/SeoJaeWan/codocs/pull/55)

## 목적

COD-42에서 코드에 `@codocs [[문서]]#Lx-Ly` 링크 311개를 추가하면서 문서와 구현이 어긋난 부분을 일부 발견했다. 이번 작업에서는 `.codocs` 문서를 사용자와 함께 한 편씩 읽으며 문서를 정리하고, 문서와 코드 사이의 링크가 실제 담당 구현과 테스트를 가리키도록 맞춘다.

## 범위

- `.codocs` 문서 79개: core 18, workspace 25, mcp 9, language-server 5, vscode 3, development 12, writing-guide 6, index 1
- 문서의 표현, 중복과 구조, 정책이 모호한 부분 정리
- 사용자와 개발자가 함께 알아야 하는 제품 개념을 `.codocs/concepts`(도메인 '제품 개념')에 정의하고, core·workspace·mcp·language-server·vscode 문서의 개념 수준 내용을 이곳으로 옮긴다. 구현에만 해당하는 내용은 옮기지 않는다.
- 문서 작성 방법은 「문서 컨벤션」에 모은다.
- 코드 주석의 기존 `@codocs` 링크는 모두 제거하고, 문서 정리가 끝나면 정리된 문서를 기준으로 다시 구성한다. 테스트 입력값으로 쓰인 `@codocs` 문자열은 유지한다.
- 코드 링크는 조건 단위로 맞춘다. 기능의 시작점 함수는 문서 전체에, 조건 하나를 구현한 함수는 문서 한 줄에, 섹션을 조합하는 함수는 섹션 제목 줄에 연결한다. 한 문장에 조건이 여럿이면 문서를 한 줄 한 조건으로 나눈다.
- 한 함수에 여러 조건이 섞여 있으면 동작을 바꾸지 않고 조건별 함수로 나눈다. 별도 PR로 미루면 이후 문서 작업과 충돌하기 때문이다.
- 조건을 검증하는 테스트가 없으면 이 PR에서 추가한다. 테스트는 그 줄의 조건을 주목적으로 검증할 때만 연결한다.

## 범위 밖

- 코드 동작은 바꾸지 않는다. 구현이 문서와 다르게 동작하거나 계약은 있으나 구현이 없는 경우는 이 PR에 기록만 하고 별도 PR에서 처리한다.

## 진행 방식

1. development와 concepts 문서를 함께 읽고 표현, 중복, 정책을 정리한다. 문구와 정책은 사용자가 결정한다.
2. 합의한 기준으로 패키지 문서를 core → workspace → mcp → language-server → vscode 순으로 concepts에 옮긴다. 옮길지 판단하기 어려운 문서는 보류하고 마지막에 함께 결정한다.
3. 문서 정리가 끝나면 concepts 문서부터 파일 하나씩 코드 링크를 다시 연결한다. 파일마다 문서 줄 나누기, 함수 분리, 테스트 매칭·추가 후보를 사용자에게 보여주고 승인받은 뒤 그 파일 단위로 반영하고 커밋한다.
4. 불일치를 발견하면 아래 셋 중 하나로 판정해 「후속 항목」에 기록한다.
   - 문서 수정: 문서가 틀렸거나 모호하면 이 PR에서 고친다.
   - 코드 수정 필요: 기획과 구현이 다르면 별도 PR로 넘긴다.
   - 테스트 보완: 조건을 검증하는 테스트가 없거나 약하면 이 PR에서 추가한다.

## COD-42에서 넘어온 항목

COD-42에서 확인한 상황을 공유하기 위한 목록이다. 해당 문서를 검토할 때 참고하며, 이 항목들을 위해 별도 PR을 만들지 않는다.

| #   | 패키지          | 내용                                                                                                                  | 구분                        |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | core            | 변경 후보 계산에서 Windows 절대 경로(`C:/...`)를 허용함 (`document-change-plan.yaml:25` ↔ `change-plan/index.ts:470`) | 문서·구현 불일치            |
| 2   | language-server | 작업 공간 제거 중 진행된 매칭이 이전 결과를 반환함 (`document-sync.yaml:49` ↔ `server-session/index.ts:761–781`)      | 문서·구현 불일치            |
| 3   | workspace       | 여러 문서의 이름 변경 반영과 실패 복구 계약에 대응하는 구현이 없음 (`rename-application.yaml:11–20`)                  | 미구현 계약                 |
| 4   | mcp             | 저장에 따른 코드 연결 영향 안내 계약에 대응하는 구현이 없음 (`write-impact.yaml`)                                     | 미구현 계약                 |
| 5   | core            | Unicode 정규화와 원문 위치 보존을 확인하는 테스트가 없음 (`duplicate-detection.yaml:25`)                              | 테스트 공백                 |
| 6   | workspace       | 후보 revision을 형식만 검사하고 실제 해시 일치는 검사하지 않음 (`change-plan.test.ts:83`)                             | 테스트 공백                 |
| 7   | language-server | 자동완성 미제공을 명시적으로 검증하지 않음 (`server-process.test.ts:331`)                                             | 테스트 공백                 |
| 8   | vscode          | 이동 명령이 source·token 외의 추가 속성을 허용함. 문서의 "허용"이 엄격한 제한인지 불분명 (`open-source.yaml:43`)      | 정책 모호                   |
| 9   | core            | 예시 `[[이름]]`이 대상 없는 참조로 진단됨 (`reference-extraction.yaml:19`)                                            | COD-45 `98193f3`에서 처리됨 |
| 10  | -               | `.github/workplans/COD-42.md` 포맷 검사 실패                                                                          | 작업 계획 자동화            |

항목별 재현 근거는 [이전 계획서](https://github.com/SeoJaeWan/codocs/blob/ed1c8ab/.github/workplans/COD-43.md)에 남아 있다.

## 후속 항목

문서 정비 중 발견한 항목을 여기에 추가한다. 각 항목에는 문서 위치, 코드 위치, 판정, 처리 PR을 적는다.

| #   | 문서 위치                                                                        | 코드 위치                                                               | 내용                                                                                                                                                        | 판정           | 처리                      |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------- |
| 1   | `concepts/document/document-attributes.yaml`                                     | core validator·query, workspace 조회 커서, mcp 조회                     | 문서 속성을 필수 5개로 정리: `kind`·`status`·`examples` 제거, `deprecatedAliases` 필수화(create 생략 시 `[]`)                                               | 코드 수정 필요 | COD-46 (PR #60)           |
| 2   | `concepts/document/document-format.yaml`                                         | -                                                                       | 「YAML 매핑 표기」·「YAML 파싱」을 「문서 형식」에 합침                                                                                                     | 문서 수정      | 이 PR에서 처리            |
| 3   | core·workspace·mcp·language-server·vscode 문서                                   | -                                                                       | 패키지 문서의 개념 수준 내용을 `concepts`로 옮기고 패키지 폴더를 없앰. 삭제·통합한 문서를 가리키던 참조 정리                                                | 문서 수정      | 이 PR에서 처리            |
| 4   | `docs/guide`, `development/documentation-convention.yaml` '사용자 가이드' 절     | `packages/mcp/src/guide/index.ts`                                       | 사용자 가이드는 제품 개념만 안내하도록 정리한다                                                                                                             | 문서 수정      | 문서 정리 후 별도 PR      |
| 5   | `concepts/reference/document-link.yaml`                                          | core 참조 추출                                                          | `[[ ]]`를 모든 속성의 문자열에서 참조로 인식                                                                                                                | 코드 수정 필요 | COD-47 (PR #61)           |
| 6   | `concepts/document/document-attributes.yaml`                                     | core validator                                                          | 사용자 속성의 `unknown_field` 경고 제거                                                                                                                     | 코드 수정 필요 | COD-48 (PR #62)           |
| 7   | (삭제한 `mcp/write-impact.yaml`)                                                 | -                                                                       | 문서 저장 시 다시 확인할 코드 참조를 저장 결과에 안내. 계약만 있고 구현이 없어 문서에서 뺌                                                                  | 코드 수정 필요 | COD-49 (PR #63)           |
| 8   | (삭제한 `core/catalog/rename.yaml`, `workspace/storage/rename-application.yaml`) | `packages/core/src/catalog/index.ts` `planRename`                       | 문서 이름 변경 시 기존 참조를 함께 갱신. 계산만 core에 있고 제공 경로·반영 구현이 없어 문서에서 뺌                                                          | 코드 수정 필요 | COD-50 (PR #64)           |
| 9   | `concepts/document/validation/diagnostics.yaml`                                  | core diagnostics                                                        | 문서의 참조 진단 코드(reference_not_found·reference_ambiguous)와 구현 코드(missing_reference·ambiguous_reference·duplicate_name·self_reference 등)가 다르다 | 판정 보류      | 사용자 결정 대기          |
| 10  | `concepts` 전반                                                                  | -                                                                       | 흡수한 문서의 옛 ID를 deprecatedAliases로 옮겼던 것을 정식 출시 전이므로 모두 제거                                                                          | 문서 수정      | 이 PR에서 처리            |
| 11  | `development/*`                                                                  | -                                                                       | 패키지 폴더를 전제로 한 「폴더 컨벤션」·「문서 컨벤션」·「실행 구조」 등의 서술 정리                                                                        | 문서 수정      | development 논의 후 이 PR |
| 12  | `concepts/document/validation/diagnostics.yaml`                                  | `packages/workspace/src/query/index.ts` `withConfirmationDiagnostic` 등 | 미확인 **문서**의 get·list 결과에도 참조 진단 코드 `unconfirmed_reference`를 붙인다. 「진단」 검토 때 함께 판정                                             | 판정 보류      | 「진단」 링크 작업 때     |
| 13  | `concepts/reference/reference.yaml`                                              | `packages/core/src/catalog/index.ts` `resolveReference`                 | 후보 중 미확인 문서가 있으면 미확인으로 두는 분기는 미확인 문서가 완료되지 않은 탐색에서만 생겨 실행될 수 없었다. 함수 분리 때 제거                         | 코드 정리      | 이 PR에서 처리            |
| 14  | `concepts/reference/code-link.yaml` 「문서에서 코드로 돌아가기」                 | `packages/language-server/src/code-navigation/index.ts`                 | 연결이 1곳일 때만 본문 밑줄이 생기고 2곳 이상은 호버로만 이동한다. 밑줄이 상시 보여 가독성도 떨어진다. 줄 끝 `*` 표시와 호버 배경 강조로 바꾼다             | 코드 수정 필요 | COD-56 (PR #70)           |

## 검증

- `codocs_validate`로 문서 진단이 새로 생기지 않았는지 확인한다.
- 코드 링크를 다시 구성한 뒤 모든 `@codocs` 링크(도메인을 지정한 형식 포함)가 참조 해석기로 해석되는지 확인한다.
- 함수 분리는 기존 테스트가 그대로 통과하는지로 동작이 바뀌지 않았음을 확인한다.
- 커밋 훅의 타입 검사, lint, 테스트, 포맷 검사를 통과한다.

## 완료 기준

- 모든 문서를 검토해 개념은 concepts에, 작성 방법은 「문서 컨벤션」에 정리했다.
- 다시 구성한 코드 링크가 정리된 문서의 조항과 실제 담당 구현·테스트를 가리킨다.
- 문서의 각 조건 줄에 담당 구현 또는 테스트가 연결되어 있다.
- 문서 정비 중 새로 발견한 코드 수정 필요 항목은 모두 판정과 함께 「후속 항목」에 기록되어 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-43

# COD-43 — .codocs 문서 정비 및 문서↔코드 링크 정합성 점검

선행 작업: [COD-42](https://seojaewan.atlassian.net/browse/COD-42), [PR #55](https://github.com/SeoJaeWan/codocs/pull/55)

## 목적

COD-42에서 코드에 `@codocs [[문서]]#Lx-Ly` 링크 311개를 추가하면서 문서와 구현이 어긋난 부분을 일부 발견했다. 이번 작업에서는 `.codocs` 문서를 사용자와 함께 한 편씩 읽으며 문서를 정리하고, 문서와 코드 사이의 링크가 실제 담당 구현과 테스트를 가리키도록 맞춘다.

## 범위

- `.codocs` 문서 79개: core 18, workspace 25, mcp 9, language-server 5, vscode 3, development 12, writing-guide 6, index 1
- 문서의 표현, 중복과 구조, 정책이 모호한 부분 정리
- 코드의 `@codocs` 링크 추가, 수정, 삭제. 링크 대상 문서의 이름과 행 범위가 바뀌면 함께 갱신한다.

## 범위 밖

- 코드 동작 수정과 테스트 추가는 하지 않는다. 문서와 구현이 다른 경우, 테스트가 부족한 경우, 계약은 있으나 구현이 없는 경우는 이 PR에 기록만 하고 별도 PR에서 처리한다.
- 링크 주석 외의 소스 변경은 하지 않는다.

## 진행 방식

문서 하나마다 다음 순서로 진행한다.

1. 문서를 함께 읽고 표현, 중복, 정책을 정리한다. 문구와 정책은 사용자가 결정한다.
2. 조항별 링크가 실제 담당 구현과 테스트를 가리키는지 확인하고 정리한다.
3. 불일치를 발견하면 아래 셋 중 하나로 판정해 「후속 항목」에 기록한다.
   - 문서 수정: 문서가 틀렸거나 모호하면 이 PR에서 고친다.
   - 코드 수정 필요: 기획과 구현이 다르면 별도 PR로 넘긴다.
   - 테스트 보완 필요: 계약을 검증하는 테스트가 없거나 약하면 별도 PR로 넘긴다.

## COD-42에서 넘어온 항목

COD-42에서 확인한 상황을 공유하기 위한 목록이다. 해당 문서를 검토할 때 참고하며, 이 항목들을 위해 별도 PR을 만들지 않는다.

| #   | 패키지                                                                         | 내용                                                                                                             | 구분                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `concepts/document/document-attributes.yaml`                                   | core validator·query, workspace 조회 커서, mcp 조회                                                              | 문서 속성을 필수 5개로 정리: `kind`·`status`·`examples` 제거, `deprecatedAliases` 필수화(create 생략 시 `[]`)                                                                                          | 코드 수정 필요 | COD-46 (PR #60)              |
| 2   | language-server                                                                | 작업 공간 제거 중 진행된 매칭이 이전 결과를 반환함 (`document-sync.yaml:49` ↔ `server-session/index.ts:761–781`) | 문서·구현 불일치                                                                                                                                                                                       |
| 3   | workspace                                                                      | 여러 문서의 이름 변경 반영과 실패 복구 계약에 대응하는 구현이 없음 (`rename-application.yaml:11–20`)             | 미구현 계약                                                                                                                                                                                            |
| 4   | mcp                                                                            | 저장에 따른 코드 연결 영향 안내 계약에 대응하는 구현이 없음 (`write-impact.yaml`)                                | 미구현 계약                                                                                                                                                                                            |
| 5   | core                                                                           | Unicode 정규화와 원문 위치 보존을 확인하는 테스트가 없음 (`duplicate-detection.yaml:25`)                         | 테스트 공백                                                                                                                                                                                            |
| 6   | `concepts/reference/document-link.yaml`                                        | core 참조 추출                                                                                                   | `[[ ]]`를 모든 속성의 문자열에서 참조로 인식                                                                                                                                                           | 코드 수정 필요 | COD-47 (PR #61)              |
| 7   | `concepts/document/document-attributes.yaml`                                   | core validator                                                                                                   | 사용자 속성의 `unknown_field` 경고 제거                                                                                                                                                                | 코드 수정 필요 | COD-48 (PR #62)              |
| 8   | `core/matcher/previous-id.yaml`                                                | `core/src` 이전 ID 링크 1개                                                                                      | 「이전 ID」 내용을 「문서 속성」 deprecatedAliases 절로 옮겼으므로 core 문서를 삭제하고 참조·코드 링크를 정리                                                                                          | 문서 수정      | core 검토 때 이 PR           |
| 9   | `core/change-plan/document-change-plan.yaml`, `workspace/storage/storage.yaml` | -                                                                                                                | 요청·결과 계약을 「codocs_write」로 모으고 core·workspace에는 구현 경계만 남김                                                                                                                         | 문서 수정      | core·workspace 검토 때 이 PR |
| 10  | `mcp/*`, `vscode/*`, `language-server/*`                                       | -                                                                                                                | 「MCP 서버」·도구별 문서·「VS Code 확장」·참조 3종과 겹치는 패키지 문서(조회, 문서 검증 요청, 본문 중복 검토 요청, 사용 가이드, 색인 갱신, 언어 서버 연결, 명시적 코드 참조, 코드 식별자 매칭 등) 정리 | 문서 수정      | 각 패키지 검토 때 이 PR      |
| 6   | workspace                                                                      | 후보 revision을 형식만 검사하고 실제 해시 일치는 검사하지 않음 (`change-plan.test.ts:83`)                        | 테스트 공백                                                                                                                                                                                            |
| 7   | language-server                                                                | 자동완성 미제공을 명시적으로 검증하지 않음 (`server-process.test.ts:331`)                                        | 테스트 공백                                                                                                                                                                                            |
| 8   | vscode                                                                         | 이동 명령이 source·token 외의 추가 속성을 허용함. 문서의 "허용"이 엄격한 제한인지 불분명 (`open-source.yaml:43`) | 정책 모호                                                                                                                                                                                              |
| 9   | core                                                                           | 예시 `[[이름]]`이 대상 없는 참조로 진단됨 (`reference-extraction.yaml:19`)                                       | COD-45 `98193f3`에서 처리됨                                                                                                                                                                            |
| 10  | -                                                                              | `.github/workplans/COD-42.md` 포맷 검사 실패                                                                     | 작업 계획 자동화                                                                                                                                                                                       |

항목별 재현 근거는 [이전 계획서](https://github.com/SeoJaeWan/codocs/blob/ed1c8ab/.github/workplans/COD-43.md)에 남아 있다.

## 후속 항목

문서 정비 중 발견한 항목을 여기에 추가한다. 각 항목에는 문서 위치, 코드 위치, 판정, 처리 PR을 적는다.

| #   | 문서 위치                                                                                                                                                                         | 코드 위치                                           | 내용                                                                                                                                                                                                   | 판정           | 처리                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------- |
| 1   | `concepts/document/document-attributes.yaml`                                                                                                                                      | core validator·query, workspace 조회 커서, mcp 조회 | 문서 속성을 필수 5개로 정리: `kind`·`status`·`examples` 제거, `deprecatedAliases` 필수화(create 생략 시 `[]`)                                                                                          | 코드 수정 필요 | COD-46 (PR #60)              |
| 2   | `concepts/document/yaml-mapping-style.yaml`                                                                                                                                       | `core/src/parser/index.ts:141`                      | 「YAML 매핑 표기」를 「문서 형식」에 합치고 '원문을 다룰 때의 의미' 절은 「YAML 파싱」으로 옮긴다                                                                                                      | 문서 수정      | core 검토 때 이 PR           |
| 3   | `core/code-reference.yaml:22`, `core/duplicate-detection.yaml:9`, `mcp/duplicate-review-request.yaml:46`, `mcp/guide/authoring-guide.yaml:28,33`, `workspace/project-root.yaml:7` | -                                                   | 삭제·통합한 문서(기본 작성 지침·설명 분리·지식을 선택해서 읽고 변경하는 흐름·도메인·문서 작성 가이드 도메인)를 가리키는 참조                                                                           | 문서 수정      | 각 패키지 검토 때 이 PR      |
| 4   | `core/core.yaml`, `mcp/mcp.yaml`                                                                                                                                                  | -                                                   | concepts로 옮긴 「YAML 매핑 표기」·「문서 검증」·「검증 오류가 있는 문서를 조회하고 수정하는 절차」가 목차에 남아 있다                                                                                 | 문서 수정      | 각 패키지 검토 때 이 PR      |
| 5   | `docs/guide`, `mcp/guide/authoring-guide.yaml`, `development/documentation-convention.yaml` '사용자 가이드' 절                                                                    | `packages/mcp/src/guide/index.ts`                   | 사용자 가이드는 제품 개념만 안내하도록 정리한다                                                                                                                                                        | 문서 수정      | 문서 정리 후 별도 PR         |
| 6   | `concepts/reference/document-link.yaml`                                                                                                                                           | core 참조 추출                                      | `[[ ]]`를 모든 속성의 문자열에서 참조로 인식                                                                                                                                                           | 코드 수정 필요 | COD-47 (PR #61)              |
| 7   | `concepts/document/document-attributes.yaml`                                                                                                                                      | core validator                                      | 사용자 속성의 `unknown_field` 경고 제거                                                                                                                                                                | 코드 수정 필요 | COD-48 (PR #62)              |
| 8   | `core/matcher/previous-id.yaml`                                                                                                                                                   | `core/src` 이전 ID 링크 1개                         | 「이전 ID」 내용을 「문서 속성」 deprecatedAliases 절로 옮겼으므로 core 문서를 삭제하고 참조·코드 링크를 정리                                                                                          | 문서 수정      | core 검토 때 이 PR           |
| 9   | `core/change-plan/document-change-plan.yaml`, `workspace/storage/storage.yaml`                                                                                                    | -                                                   | 요청·결과 계약을 「codocs_write」로 모으고 core·workspace에는 구현 경계만 남김                                                                                                                         | 문서 수정      | core·workspace 검토 때 이 PR |
| 10  | `mcp/*`, `vscode/*`, `language-server/*`                                                                                                                                          | -                                                   | 「MCP 서버」·도구별 문서·「VS Code 확장」·참조 3종과 겹치는 패키지 문서(조회, 문서 검증 요청, 본문 중복 검토 요청, 사용 가이드, 색인 갱신, 언어 서버 연결, 명시적 코드 참조, 코드 식별자 매칭 등) 정리 | 문서 수정      | 각 패키지 검토 때 이 PR      |

## 검증

- `codocs_validate`로 문서 진단이 새로 생기지 않았는지 확인한다.
- 모든 `@codocs` 링크가 참조 해석기로 해석되는지 확인한다.
- 링크 주석 외에 소스가 바뀌지 않았는지 주석을 제외한 AST로 확인한다.
- 커밋 훅의 타입 검사, lint, 테스트, 포맷 검사를 통과한다.

## 완료 기준

- 79개 문서를 모두 함께 검토했다.
- 검토한 문서의 링크가 실제 담당 구현과 테스트를 가리킨다.
- 문서 정비 중 새로 발견한 코드 수정·테스트 보완 필요 항목은 모두 판정과 함께 「후속 항목」에 기록되어 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-43

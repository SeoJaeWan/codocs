# .codocs 작성 가이드

문서는 이름을 붙여 찾아보고 참조할 수 있는 설명의 단위다. 용어·동작·정책·조건·예외·판단 근거·작업 흐름을 YAML 파일 하나에 문서 하나로 기록한다.
AI도 `codocs_guide`를 호출하면 이 디렉터리의 같은 원문을 읽는다. 색인 초기화·refresh·실패가 있어도 가이드는 색인 완료를 기다리지 않는다.

## 작성 순서

1. `codocs_list`로 필요한 문서를 고르고 `codocs_get`으로 현재 내용·참조·revision을 읽는다. 기존 담당 원문이 있으면 먼저 보완한다.
2. [문서 형식](schema.md)과 [작성 원칙](writing.md)에 맞춰 설명을 작성한다. 제품은 고정된 폴더 계층을 요구하지 않는다.
3. [네 문서 연결 예시](examples.md)로 용어·정책·절차의 책임과 참조를 확인한다.
4. [수정 절차](updating.md)에 따라 최신 revision으로 set/unset을 요청하고 저장 여부와 색인 상태를 확인한다.
5. [검증과 복구](validation.md)에서 오류·경고를 확인하고 필요한 수정과 refresh를 수행한다.

`status: confirmed`는 합의된 내용이라는 뜻이다. 구현 완료나 AI가 사실을 자동 검증했다는 보장이 아니다.
개발 진행도와 이슈·PR 배정은 작업 관리 도구에서 관리한다.

## 주제 선택

| topic      | 안내                                        |
| ---------- | ------------------------------------------- |
| overview   | 이 문서: 전체 순서와 주제 목록              |
| schema     | [YAML 속성과 허용 값](schema.md)            |
| writing    | [설명의 책임과 이름·참조](writing.md)       |
| examples   | [실행 가능한 가상 프로젝트](examples.md)    |
| updating   | [revision 수정·삭제·폐기·충돌](updating.md) |
| validation | [진단과 색인 복구](validation.md)           |

`codocs_guide({})`는 overview를 반환한다. 예를 들어 `codocs_guide({"topic":"updating"})`으로 수정 안내를 읽는다.
결과의 `topic`, `topics`, `content`는 선택 주제·전체 주제·Markdown 원문이다. 상대 링크는 배포된 `docs/guide`를 기준으로 읽는다.
지원하지 않는 주제이거나 알 수 없는 속성이 있으면 `invalid_input`이다. 원문 파일을 읽지 못하면 `file_access_failed`와 패키지 확인 안내를 반환한다.

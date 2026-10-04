# 문서 수정

[전체 순서와 주제](README.md)

## 내용 갱신과 이름 변경

개발 진행만 바뀌면 문서를 수정하지 않는다. 설명하는 의미·동작·정책이 바뀌면 담당 원문에 합의한 조건·근거·예외를 반영한다.
원문을 갱신한 뒤 그 내용을 사용하는 문서의 설명과 참조도 확인한다.
코드에서 특정 문서 행을 참조하는 경우, 변경한 뒤 코드 링크가 의도한 문서 행을 여는지 확인한다.

이름 변경 계산은 대상 이름 필드와 연결된 참조의 변경 후보를 보여준다.
모호한 참조나 여러 도메인은 사용자의 후보·도메인 선택이 필요할 수 있고, 같은 도메인의 새 이름 충돌은 변경을 차단한다.
미리보기의 `ready` 상태는 파일 저장 허용을 의미하지 않는다. 저장 기능은 최신 원문, 각 대상의 쓰기 가능 여부와 YAML 따옴표·escape를 다시 확인해야 한다.

명시적인 ID 변경 기능은 직전 ID를 `deprecatedAliases`에 보존하고 새 현재 ID가 이전 목록에 있으면 제거한다.
같은 이전 ID를 중복 추가하지 않고 작성한 변경 안내를 유지한다. YAML을 직접 편집할 때는 필요한 이전 ID 목록도 직접 관리한다.
update 요청의 `set`/`unset`으로는 `deprecatedAliases`를 직접 바꿀 수 없다. 이전 ID 목록은 ID를 실제로 변경할 때 자동으로 관리되며, 목록 자체를 고치려면 YAML을 직접 편집할 수 있다.
이전 ID 목록의 유지가 사용자 코드의 자동 변경이나 이전 ID를 통한 문서 조회를 의미하지 않는다.

## get에서 set/unset과 validate까지

먼저 `codocs_get({"ids":["sample-order"]})`로 문서와 `revision`을 읽고 수정할 설명과 연결을 검토한다.
아래의 `읽은 revision`은 실제 응답의 값으로 바꾼다.

```json
{
  "mode": "update",
  "id": "sample-order",
  "revision": "읽은 revision",
  "set": { "definition": "가상 주문의 검토한 새 설명이다." },
  "unset": ["reviewNote"]
}
```

`codocs_write`의 set은 지정 속성만 바꾸고 unset은 선택 속성이나 사용자 속성을 삭제한다.
필수 속성을 삭제할 수 없으며 같은 속성을 set과 unset에 함께 지정하지 않는다.
`deprecatedAliases`는 이 요청으로 직접 편집하지 않는다. YAML 직접 편집과 ID 변경의 차이는 위 내용을 확인한다.
저장 전에 `codocs_duplicates({"draft":{...}})`로 같은 초안의 반복 구절 후보를 확인할 수 있다. `draft`에는 위와 같은 `codocs_write` 입력을 그대로 넣는다.
이 결과는 검토 정보이며 저장을 막지 않는다. `codocs_write`는 중복 검토를 실행하지 않고, 파일이나 색인도 바꾸지 않는다.
`status`가 `complete`가 아니면 중복이 없다는 뜻이 아니다. 후보가 여러 페이지면 `nextCursor`를 `{"cursor":"..."}`로 보내 다음 페이지를 읽고, 원문이 바뀌어 `cursor_expired`가 오면 처음부터 다시 요청한다. 위치의 줄·문자 번호는 0부터 시작한다.
저장 뒤 `codocs_validate({"path":".codocs/order.yaml"})` 또는 `codocs_validate({})`로 진단을 읽는다.
경고는 저장을 막지 않을 수 있으므로 성공 여부와 별도로 확인한다.

`saved: true`는 파일 반영 완료다. `indexUpdated: false`여도 파일을 다시 저장하지 않고 [색인 복구](validation.md#저장-후-색인-복구)를 따른다.
무변경이면 `saved: false`, `changed: false`이며 `indexUpdated`는 생략된다.

## 충돌 후 재조회와 검토

`revision_conflict` 또는 변경 후보 단계의 `change_revision_mismatch`가 오면 저장되지 않은 요청이다.
최신 문서를 다시 get하고 다른 작성자의 변경과 내 수정 의도를 비교한다. 그 내용을 보존하거나 합의한 수정안을 만든 뒤 최신 revision으로 요청한다.
revision 값만 바꿔 이전 set을 자동 재적용하지 않는다.

저장 직전 revision 검사와 파일 교체는 별도 연산이다. 프로세스 간 잠금·공유 FIFO가 없으므로 검사 뒤 발생한 경쟁을 완전히 막지 못한다.
충돌 오류가 없다는 사실만으로 동시 변경이 모두 보존됐다고 판단하지 않는다.

## 상호 참조를 처음 만드는 순서

1. `codocs_write({"mode":"create","path":".codocs/a.yaml","document":{"id":"a","name":"가상 A","domains":["연습"],"definition":"가상 A의 의미다."}})`
2. `codocs_write({"mode":"create","path":".codocs/b.yaml","document":{"id":"b","name":"가상 B","domains":["연습"],"definition":"[[가상 A]]를 사용하는 절차다."}})`
3. `codocs_get({"ids":["a"]})`로 A의 최신 원문과 revision을 읽는다.
4. 검토한 A 본문에 B를 연결한다: `codocs_write({"mode":"update","id":"a","revision":"A의 최신 revision","set":{"definition":"가상 A의 의미다. 사용 절차는 [[가상 B]]에서 확인한다."}})`
5. `codocs_validate({})`로 양쪽 참조를 확인한다.

create 경로가 이미 있으면 덮어쓰지 않는다. 실패를 update로 자동 전환하거나 처리 지연 때문에 create를 반복하지 않는다.

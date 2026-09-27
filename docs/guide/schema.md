# 문서 형식

[전체 순서와 주제](README.md)

## 문서 형식

개념·규칙·작업 흐름을 같은 형식으로 작성한다. `type` 필드는 사용하지 않는다.

```yaml
id: sample-order
name: 가상 주문
definition: 가상 고객의 구매 요청이다.
domains:
  - sample-sales
examples:
  - 가상 주문 SAMPLE-001을 생성한다.
deprecatedAliases:
  - id: previous-order
    message: sample-order로 변경되었습니다.
```

필수 필드는 `id`, `name`, `definition`, `domains`다. `domains`에는 문자열이 하나 이상 있어야 한다.
`examples`는 문자열 배열, `deprecatedAliases`는 필수 `id`와 선택 `message`를 가진 객체 배열이다. 두 선택 배열은 비어 있어도 된다.
이전 ID는 현재 ID와 같은 형식을 사용하며 이전 코드 식별자의 매칭을 유지한다. 문서 간 참조와 ID 기반 조회·수정은 각각 현재 `name`과 현재 `id`를 사용한다.

여러 도메인에 걸친 흐름도 같은 형식을 사용한다.

```yaml
id: sample-fulfillment
name: 가상 주문 처리
definition: |
  구매 요청의 주문 항목과 처리 조건을 확인한다.
  확인한 뒤 배송 절차를 진행한다.
domains:
  - sample-sales
  - sample-delivery
kind: procedure
status: confirmed
```

`kind`는 `policy`, `procedure`, `decision`, `discussion` 중 하나이고 `status`는 `proposed`, `confirmed`, `deprecated` 중 하나다.
모든 문서에서 선택 속성을 함께 사용할 수 있으며 생략한 값은 자동으로 추가하지 않는다.

`kind`는 내용의 성격을 나타낸다. `policy`는 규칙, `procedure`는 절차, `decision`은 선택과 판단 근거, `discussion`은 논의할 쟁점과 대안이다.

`status`는 내용의 합의·적용 상태를 나타낸다.

| 값           | 의미                                     |
| ------------ | ---------------------------------------- |
| `proposed`   | 제안되어 검토 중인 내용                  |
| `confirmed`  | 합의된 내용                              |
| `deprecated` | 적용이 종료되어 참고용으로 보존하는 내용 |

개발 작업의 대기·진행·완료를 나타내지 않는다. `confirmed`도 구현 완료를 뜻하지 않는다. 생략하면 상태를 명시하지 않은 것이며 자동으로 확정하지 않는다.

## 공통 값 규칙

- ID는 소문자와 숫자를 하이픈으로 연결한다. 정규식은 `^[a-z0-9]+(?:-[a-z0-9]+)*$`다.
- 문서의 문자열 값은 비거나 공백뿐일 수 없다.
- 대소문자, 앞뒤 공백과 줄바꿈은 작성한 그대로 의미가 있다.
- 알려지지 않은 필드는 JSON 값이면 보존되지만 `unknown_field` 경고가 생긴다.
- `aliases`라는 사용자 필드는 이름 참조나 `deprecatedAliases`의 의미를 갖지 않는다.

사용자 필드에는 문자열, 유한한 숫자, boolean, null, 배열과 문자열 키 객체를 사용할 수 있다. `NaN`, 무한대, undefined, 함수, 순환 객체처럼 JSON으로 표현할 수 없는 값은 API 입력에서 거부된다.

## YAML 표기

주석, 작은따옴표·큰따옴표, literal/folded 블록 문자열, 중첩 배열·매핑과 flow 표기를 사용할 수 있다. 단일 문서 표시 `---`도 허용한다.

다음 기능은 지원하지 않는다.

- 앵커와 별칭
- 병합 키
- 사용자 태그
- 한 파일의 복수 YAML 문서
- 중복 매핑 키

이 기능들은 `unsupported_yaml_feature` 오류가 된다. 일반 YAML 문법 오류, 빈 파일과 최상위 배열·스칼라는 `invalid_yaml`이다.
오류 코드와 함께 메시지와 위치를 확인해 해당 구문이나 값을 고친다.

## 이전 형식에서 옮기기

- `type`을 제거한다.
- `title`은 `name`, `body`는 `definition`으로 값 그대로 옮긴다.
- `domain` 문자열은 `domains` 배열로 감싸며 기존 복수 소속은 유지한다.
- 이름·ID·본문과 필요한 선택 속성을 보존하고 형식·충돌·참조를 검증한다.

이전 형식을 자동으로 해석하거나 변환하지 않는다. 예전 필드는 사용자 속성으로 보존·경고되며 새 필수 필드를 대신하지 않는다.
공개 TypeScript 성공 타입은 `Document`이며 이전 `Term`·`Knowledge` 타입은 제공하지 않는다.

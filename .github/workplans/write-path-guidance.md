# codocs_write path 기준과 경로 오류 안내 정비

## 배경

codocs_write의 create·move는 path가 `.codocs/`로 시작해야 저장된다. 그런데 툴 설명에는 경로 형식이 없고, 개념 문서(write-tool)는 ".codocs 아래의 상대 path"라고 적어 `.codocs/`를 빼라는 뜻으로 읽힌다. 형식이 틀렸을 때의 오류 메시지 "작업 경로는 비어 있지 않은 경로 문자열이어야 합니다."도 원인을 알려주지 않는다. 2026-10-08 로컬 MCP 점검에서 AI가 정상 문서를 만들다가 세 번 연속 invalid_workspace_path로 실패했다.

## 범위

### 경로 기준

- path는 프로젝트 루트 기준 상대 경로다. `--project`를 생략하면 서버를 실행한 위치가 프로젝트 루트다.
- `--project`를 지정하면 그 폴더를 기준으로 한다.
- 결과로 돌려주는 경로(source.path, changes[].path)와 같은 형식이라 그대로 다시 입력할 수 있다.

### 안내와 메시지

- codocs_write 툴 설명에 path 형식과 예시(`.codocs/orders/order.yaml`)를 적는다.
- 경로 형식 오류(`.codocs` 구간 없음, `.`·`..` 포함, 확장자 불일치)에 원인을 알려주는 메시지를 따로 둔다.
- 문자열이 아닌 입력의 기존 메시지는 그대로 둔다.
- 코드값 invalid_workspace_path는 바꾸지 않는다.

### 문서

- 개념 문서: codocs_write의 create·move, 탐색:프로젝트 루트, MCP 서버:실행과 프로젝트
- 사용자 가이드(updating)와 README의 path 설명

## 범위 밖

- 하위 폴더의 `.codocs` 인정 (별도 이슈)
- 단일 변경 입력 스키마 문제 (별도 논의)

## 검증

- 형식이 틀린 path로 create·move하면 원인을 알려주는 메시지가 나온다.
- `.codocs/`로 시작하는 path는 기존과 같이 저장된다.
- `--project` 지정·생략 두 경우 모두 프로젝트 루트 기준으로 해석된다.
- typecheck, lint, test, format check를 통과한다.

## 완료 기준

- AI가 툴 설명만 읽고 올바른 path로 첫 시도에 문서를 만들 수 있다.

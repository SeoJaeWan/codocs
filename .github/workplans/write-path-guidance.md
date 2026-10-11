# codocs_write path 기준과 경로 오류 안내 정비

## 배경

codocs_write의 create·move는 path가 `.codocs/`로 시작해야 저장된다. 그런데 툴 설명에는 경로 형식이 없고, 개념 문서(write-tool)는 ".codocs 아래의 상대 path"라고 적어 `.codocs/`를 빼라는 뜻으로 읽힌다. 형식이 틀렸을 때의 오류 메시지 "작업 경로는 비어 있지 않은 경로 문자열이어야 합니다."도 원인을 알려주지 않는다. 2026-10-08 로컬 MCP 점검에서 AI가 정상 문서를 만들다가 세 번 연속 invalid_workspace_path로 실패했다.

경로 기준을 확정하는 김에 하위 폴더의 `.codocs`도 함께 인정한다. 모노레포에서는 `packages/core/.codocs/a.yaml`처럼 코드 가까이에 문서를 두는 편이 자연스럽고, 경로 규칙을 한 번에 정리해야 안내가 어긋나지 않는다.

## 범위

### 경로 기준

- path는 프로젝트 루트 기준 상대 경로다. `--project`를 생략하면 서버를 실행한 위치가 프로젝트 루트다.
- `--project`를 지정하면 그 폴더를 기준으로 한다.
- 결과로 돌려주는 경로(source.path, changes[].path, previousPath)와 같은 형식이라 그대로 다시 입력할 수 있다.

### 경로 정규화

- 입력의 `\`와 연속한 `/`는 모든 OS에서 `/` 하나로 바꿔 받는다.
- 결과 경로(source.path, changes[].path, previousPath, 진단의 path·relatedPaths)는 항상 `/`로 구분한다.
- 절대 경로, `.`·`..` 구간, 파일명 없이 `/`로 끝나는 경로, `.codocs` 구간이 없는 경로, `.yaml`·`.yml`이 아닌 확장자는 보정하지 않고 거부한다.
- 형식 오류마다 원인을 알려주는 메시지를 따로 두고, 끝에 올바른 예시(`.codocs/orders/order.yaml`)를 붙인다.

### 하위 `.codocs` 인정

- 프로젝트 루트의 `.codocs`뿐 아니라 `packages/core/.codocs/a.yaml`처럼 하위 폴더의 `.codocs`도 인정한다.
- 인정 위치는 각 폴더의 `.gitignore`와 루트 `.codocsignore`로 제외되지 않은 위치다. 판단에 git 명령을 쓰지 않으며 Git 추적 여부를 보지 않으므로 무시 폴더 안에 강제 커밋된 `.codocs`도 제외한다. 다른 위치의 문서는 색인하지 않는다. 제외된 위치로의 create·move는 그 위치를 알리는 메시지와 함께 invalid_workspace_path로 거부한다.
- 문서는 경로에서 가장 바깥의 `.codocs`에 속한다. 예를 들어 `.codocs/a/.codocs/b.yaml`은 루트 `.codocs`의 문서다.
- git이 없거나 실패해도 하위 `.codocs` 탐색과 모든 저장은 영향을 받지 않는다. `.gitignore`나 `.codocsignore`를 읽지 못하면 루트 `.codocs`는 그대로 저장되고, 판단할 수 없는 하위 위치만 확인 못함으로 알리며 그 위치로의 create·move만 거부한다.
- ID와 이름은 모든 `.codocs`를 합쳐 프로젝트 전체에서 유일해야 한다.
- create와 move는 단일 요청과 changes 모두 없는 `.codocs`와 바깥 폴더를 전부 만든다. changes가 실패하면 이번 요청이 만든 폴더를 모두 지운다.
- 삭제나 이동으로 비게 된 폴더는 문서가 속한 `.codocs` 바로 아래까지만 지운다. `.codocs` 자체와 그 바깥 폴더는 남긴다.
- 탐색·감시·codocs_get·codocs_list·codocs_validate(path 포함)·이름 변경이 인정된 모든 `.codocs`를 대상으로 한다. 서버 실행 중 하위 `.codocs`를 만들거나 지우면, 또 `.codocsignore`를 고치면 재시작 없이 반영한다.

### 편집기

- 언어 서버와 VS Code 확장이 하위 `.codocs` 문서를 루트 `.codocs` 문서와 똑같이 판별하고 진단·이름 바꾸기·링크를 제공한다. 어느 깊이에서든 `.codocs` 폴더를 만들거나 지우면 색인을 갱신한다.
- 같은 이름의 참조 후보를 구분할 때 루트 `.codocs` 문서는 지금처럼 `.codocs/`를 뺀 경로를, 하위 `.codocs` 문서는 프로젝트 기준 전체 경로(`packages/core/.codocs/a.yaml`)를 hover에 보여준다.

### 안내와 메시지

- codocs_write 툴 설명에 path 형식과 예시(`.codocs/orders/order.yaml`, `packages/core/.codocs/a.yaml`)를 적는다.
- 경로 형식 오류(`.codocs` 구간 없음, 절대 경로, `.`·`..` 포함, 파일명 없음, 확장자 불일치)에 원인을 알려주는 메시지를 따로 둔다.
- 문자열이 아닌 입력의 기존 메시지는 그대로 둔다.
- 코드값 invalid_workspace_path는 바꾸지 않는다.

### 문서

- 개념 문서: codocs_write의 create·move, codocs_validate, 탐색, 문서 색인, 코드 참조, MCP 서버, VS Code 확장 관련 문서
- 사용자 가이드(updating, writing)와 README의 path 설명, 하위 `.codocs` 설명
- 변경 기록(changeset)

## 범위 밖

- 단일 변경 입력 스키마 문제 (별도 논의)

## 검증

- 형식이 틀린 path로 create·move하면 원인을 알려주는 메시지가 나온다.
- `.codocs/`로 시작하는 path는 기존과 같이 저장된다.
- `--project` 지정·생략 두 경우 모두 프로젝트 루트 기준으로 해석된다.
- `\`나 `//`가 섞인 path도 저장되고, 결과 경로는 `/`로 나온다.
- `packages/core/.codocs/a.yaml`을 create하면 codocs_get·codocs_list·codocs_validate로 조회된다.
- 제외된 위치(예: `.gitignore`가 제외한 폴더)의 `.codocs`로 create·move하면 위치를 알리는 메시지로 거부되고 폴더가 만들어지지 않는다.
- git 실행 파일을 찾을 수 없는 환경에서도 루트 `.codocs`와 `.gitignore`가 제외하지 않은 하위 `.codocs`의 create·update가 저장되고 탐색은 complete다.
- `.gitignore`가 제외한 폴더의 `.codocs`는 git에 강제 추적되어 있어도 인정되지 않는다.
- `.codocsignore`를 읽지 못하면 루트 문서 저장은 성공하고 하위 위치 create는 거부된다.
- 다른 `.codocs`에 같은 ID나 이름이 있으면 저장하지 않는다.
- 하위 `.codocs` 문서를 지우거나 옮기면 소유 `.codocs` 바로 아래까지만 빈 폴더를 지운다. changes가 실패하면 만든 폴더를 모두 지운다.
- 언어 서버 세션 테스트에서 하위 `.codocs` 문서의 hover가 프로젝트 기준 전체 경로를 보여준다.
- vscode-client 테스트가 통과한다.
- typecheck, lint, test, format check를 통과한다.

## 완료 기준

- AI가 툴 설명만 읽고 올바른 path로 첫 시도에 문서를 만들 수 있다.
- 루트와 하위 폴더의 `.codocs`에 문서를 만들고 옮기고 지울 수 있으며, MCP와 편집기가 같은 문서 집합을 본다.
- 개념 문서, 사용자 가이드, README, 변경 기록이 구현과 같은 내용을 설명한다.

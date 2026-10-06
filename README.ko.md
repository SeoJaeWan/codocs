# Codocs

[English](README.md)

Codocs는 로컬 `.codocs` YAML 파일에 작성한 프로젝트 지식을 코드와 연결한다. 도메인 용어, 비즈니스 규칙, 개발 규칙을 문서로 관리하고 VS Code와 AI 도우미에서 같은 지식을 활용할 수 있다.

- **MCP:** AI 도우미가 프로젝트 지식을 검색·조회하고 문서를 작성·수정한다.
- **VS Code:** 명시한 `@codocs` 링크와 문서 링크를 따라 이동하고 연결된 코드 위치로 돌아간다.

필요한 연동만 설치하거나 둘 다 사용할 수 있다. Windows·macOS의 로컬 디스크에 있는 프로젝트를 지원하며, 문서 이름과 본문은 원하는 언어로 작성할 수 있다.

## MCP

### 설치

**Node.js 24.x**가 필요하다. 원하는 디렉터리에서 다음 명령으로 설치한다.

```sh
npm install co-documentation@0.0.1
```

MCP 클라이언트 설정에 설치된 실행 파일과 **프로젝트의 절대 경로**를 지정한다.

```json
{
  "mcpServers": {
    "codocs": {
      "command": "/absolute/install/node_modules/.bin/codocs",
      "args": ["--project", "/absolute/path/my-project"]
    }
  }
}
```

`/absolute/install`은 `npm install`을 실행한 디렉터리로 바꾼다. `--project`에는 `.codocs`를 포함하는 프로젝트 폴더를 지정한다.

Windows에서는 JSON의 command 값으로 `C:\\absolute\\install\\node_modules\\.bin\\codocs.cmd`를 사용한다. `.cmd` 파일을 실행하지 못하는 클라이언트에서는 `command`를 `node`로 지정하고, 첫 번째 인자로 `node_modules/co-documentation/dist/runtime/cli.js`의 절대 경로를 전달한 뒤 `--project`와 프로젝트 경로를 이어서 지정한다. 클라이언트별 설정 형식에 맞춰 로컬 stdio 연결을 사용한다.

### 사용할 수 있는 도구

| 도구              | 역할                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `codocs_list`     | 최상위 문서와 직속 자식을 섹션 이름과 함께 탐색                                                  |
| `codocs_get`      | `이름` 또는 `이름:섹션`으로 문서·섹션 본문·참조·revision 조회                                    |
| `codocs_write`    | 문서 생성, 읽은 revision을 사용한 수정·전체 교체·삭제·이동, `changes`로 여러 문서를 한 번에 변경 |
| `codocs_rename`   | 문서나 섹션의 이름과 그것을 가리키는 참조를 함께 미리보고 변경                                   |
| `codocs_validate` | 문서와 코드 파일의 `@codocs` 참조 오류·경고 확인                                                 |
| `codocs_refresh`  | 프로젝트 문서·코드 참조 색인 재구성                                                              |
| `codocs_guide`    | 문서 작성·수정·복구 가이드 조회                                                                  |

AI 도우미에게 “주문의 정의를 찾아줘”, “프로젝트 문서의 오류를 확인해줘”, “이 비즈니스 규칙을 문서로 작성해줘”처럼 요청할 수 있다. 문서를 수정할 때는 `codocs_get`으로 먼저 읽고, 응답의 revision을 `codocs_write`에 전달해 일부를 수정(`update`)하거나 문서 전체를 교체(`replace`, 생략한 섹션은 삭제)하며, 문서를 삭제(`delete`)하거나 이동(`move`)할 수도 있다. 여러 문서를 함께 바꿀 때는 `changes`로 보내면 최종 상태를 한 번 검증해 전부 저장하거나 아무것도 저장하지 않고, 저장 도중 실패하면 되돌린다. 다른 문서나 코드 파일의 `@codocs` 표기가 새로 깨지는 변경은 저장하지 않고 거절한다. 문서 이름이나 섹션 이름(`section` 지정)을 바꿀 때는 `codocs_rename`으로 미리본 뒤 그 결과를 반영하며, `codocs_write`는 문서의 이름을 바꾸지 않는다.

## VS Code

### 설치

데스크톱 **VS Code 1.100.0 이상**이 필요하다. 확장 화면에서 `seojaewan.codocs`를 검색하거나 다음 명령으로 설치한다.

```sh
code --install-extension seojaewan.codocs@0.0.1
```

VSIX 파일이 있다면 **Extensions: Install from VSIX...**로 설치할 수 있다. 확장에 언어 서버가 포함되어 있고 VS Code 내장 런타임을 사용하므로 별도의 Node.js 설치는 필요하지 않다.

`.codocs`가 있는 프로젝트 폴더를 열면 확장을 사용할 수 있다.

### 사용할 수 있는 기능

- **문서 진단:** `.codocs` 문서의 YAML 문법, `_codocs` 메타데이터와 섹션, ID·이름 중복, 상위 문서(parent), 참조 오류를 확인한다.
- **문서 간 링크:** 문서의 모든 섹션에 쓴 `[[문서 이름]]` 참조에서 확정된 대상 문서로, `[[문서 이름:섹션]]` 참조에서 대상 문서의 섹션으로 이동한다.
- **문서·섹션 이름 변경:** 이름·섹션 키·참조에서 이름 바꾸기(F2)로 문서나 섹션의 이름을 바꾸고 그것을 가리키는 참조를 코드 파일의 `@codocs` 표기까지 함께 고친다.
- **명시 코드 링크:** 프로젝트 텍스트에 `@codocs [[문서 이름]]` 또는 `@codocs [[문서 이름:섹션]]`을 작성해 문서 전체나 문서의 섹션으로 이동한다. 닫는 `]]` 뒤의 `#L11` 같은 글자는 표기에 포함하지 않는다.
- **코드 역참조:** 섹션 키에 커서를 두면 그 섹션을 가리키는 코드 목록을, `_codocs.name` 값에 커서를 두면 문서 전체를 가리키는 코드 목록을 보여준다. 각 항목은 해당 코드 위치로 이동하며, 섹션 키 옆과 문서 첫 행의 `코드 N곳`은 개수만 표시한다.
- **작업 공간 지원:** 여러 폴더를 연 작업 공간에서도 프로젝트별 지식을 구분해 사용하며, 문서 변경을 자동으로 반영한다.

서버 문제를 해결한 뒤 다시 연결해야 할 때는 명령 팔레트에서 **Codocs: Restart Language Servers**를 실행한다.

## 첫 문서 작성하기

프로젝트에 `.codocs/order.yaml`을 만든다.

```yaml
_codocs:
  id: order
  name: 주문
개요: |
  주문은 고객의 구매 요청과 이행 조건을 기록한다.
```

코드 주석에 `@codocs [[주문]]`을 작성해 문서와 연결하거나, AI 도우미에게 MCP로 해당 문서를 조회하도록 요청한다. 문서는 `id`, `name`, 선택 항목인 `parent`를 담은 `_codocs` 객체와 하나 이상의 섹션으로 구성하며, 섹션은 이름을 키로 하고 내용 문자열을 값으로 가진다. 어느 섹션에서든 `[[주문]]`과 같은 문서 참조나 `[[주문:취소]]`와 같은 섹션 참조로 관련 지식을 연결할 수 있다. 변수나 함수의 이름이 같다는 이유만으로 문서를 자동 연결하지는 않는다.

자세한 작성법은 [작성 가이드](docs/guide/README.md)와 [예시 프로젝트](examples/.codocs)를 참고한다. 상세 가이드와 예시 프로젝트는 현재 한국어로 제공한다.

## 관련 링크

- [문제 신고](https://github.com/SeoJaeWan/codocs/issues)
- [개발 문서](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/index.yaml)

## 라이선스

[MIT](LICENSE). 번들 의존성 라이선스는 `dist/THIRD-PARTY-NOTICES.txt`에, VSIX 서버의 의존성 라이선스는 `dist/server/THIRD-PARTY-NOTICES.txt`에도 포함한다.

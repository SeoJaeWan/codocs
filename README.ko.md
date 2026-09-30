# Codocs

[English](README.md)

Codocs는 로컬 `.codocs` YAML 파일에 작성한 프로젝트 지식을 코드와 연결한다. 도메인 용어, 비즈니스 규칙, 개발 규칙을 문서로 관리하고 VS Code와 AI 도우미에서 같은 지식을 활용할 수 있다.

- **MCP:** AI 도우미가 프로젝트 지식을 검색·조회하고 문서를 작성·수정한다.
- **VS Code:** 코드 식별자의 정의와 명시 문서 링크를 확인하고 연결된 코드 위치로 이동한다.

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

| 도구              | 역할                                     |
| ----------------- | ---------------------------------------- |
| `codocs_list`     | 필터와 페이지 단위로 문서 목록 검색      |
| `codocs_get`      | 문서 본문·참조·revision 조회             |
| `codocs_write`    | 문서 생성 및 읽은 revision을 사용한 수정 |
| `codocs_validate` | 문서의 오류·경고 확인                    |
| `codocs_refresh`  | 프로젝트 지식 색인 재구성                |
| `codocs_guide`    | 문서 작성·수정·복구 가이드 조회          |

AI 도우미에게 “주문의 정의를 찾아줘”, “프로젝트 문서의 오류를 확인해줘”, “이 비즈니스 규칙을 문서로 작성해줘”처럼 요청할 수 있다. 문서를 수정할 때는 `codocs_get`으로 먼저 읽고, 응답의 revision을 `codocs_write`에 전달한다.

## VS Code

### 설치

데스크톱 **VS Code 1.100.0 이상**이 필요하다. 확장 화면에서 `seojaewan.codocs`를 검색하거나 다음 명령으로 설치한다.

```sh
code --install-extension seojaewan.codocs@0.0.1
```

VSIX 파일이 있다면 **Extensions: Install from VSIX...**로 설치할 수 있다. 확장에 언어 서버가 포함되어 있고 VS Code 내장 런타임을 사용하므로 별도의 Node.js 설치는 필요하지 않다.

`.codocs`가 있는 프로젝트 폴더를 열면 확장을 사용할 수 있다.

### 사용할 수 있는 기능

- **코드 호버:** 영어 코드 식별자에 마우스를 올려 연결된 문서의 이름·정의·도메인을 확인한다.
- **원문 이동:** 호버의 링크를 눌러 원본 YAML 문서를 연다.
- **관련 지식 탐색:** 문서가 참조하는 지식, 해당 문서를 참조하는 지식, 같은 식별자에서 함께 매칭된 용어로 이동한다.
- **문서 진단:** `.codocs` 문서의 YAML 문법, 필수 속성, ID 중복, 참조 오류를 확인한다.
- **문서 간 링크:** YAML 본문의 `[[문서 이름]]` 참조에서 확정된 대상 문서로 이동한다.
- **명시 코드 링크:** 프로젝트 텍스트에 `@codocs [[문서 이름]]`, `@codocs [[문서 이름]]#L11`, `@codocs [[도메인:문서 이름]]#L11-L12`를 작성해 문서 전체·행·행 범위로 이동한다. 행 범위의 끝 행을 포함한다.
- **코드 역참조:** 문서의 연결 행에서 코드 출현으로 돌아간다. 여러 출현은 호버의 개별 링크로 선택하고, 문서 전체 참조는 첫 행 앞의 Inlay Hint로 표시한다. 단일 출현은 IDE 이동 제스처로 연다.
- **작업 공간 지원:** 여러 폴더를 연 작업 공간에서도 프로젝트별 지식을 구분해 사용하며, 문서 변경을 자동으로 반영한다.

서버 문제를 해결한 뒤 다시 연결해야 할 때는 명령 팔레트에서 **Codocs: Restart Language Servers**를 실행한다.

## 첫 문서 작성하기

프로젝트에 `.codocs/order.yaml`을 만든다.

```yaml
id: order
name: 주문
domains: [판매]
definition: |
  주문은 고객의 구매 요청과 이행 조건을 기록한다.
```

코드의 `order` 식별자에 마우스를 올려 정의를 확인하거나, AI 도우미에게 MCP로 해당 문서를 조회하도록 요청한다. `[[주문]]`과 같은 문서 참조로 관련 지식을 연결할 수 있다.

자세한 작성법은 [작성 가이드](docs/guide/README.md)와 [예시 프로젝트](examples/.codocs)를 참고한다. 상세 가이드와 예시 프로젝트는 현재 한국어로 제공한다.

## 관련 링크

- [문제 신고](https://github.com/SeoJaeWan/codocs/issues)
- [개발 문서](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/index.yaml)

## 라이선스

[MIT](LICENSE). 번들 의존성 라이선스는 `dist/THIRD-PARTY-NOTICES.txt`에, VSIX 서버의 의존성 라이선스는 `dist/server/THIRD-PARTY-NOTICES.txt`에도 포함한다.

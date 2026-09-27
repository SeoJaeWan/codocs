# Codocs

[English](README.md)

Codocs는 로컬 `.codocs` YAML에 기록한 프로젝트 지식을 코드와 연결한다. 개발자는 VS Code의 영어 코드 식별자에서 정의·원문 링크를 확인하고, AI는 MCP로 같은 지식을 읽는다. 문서 이름과 본문은 원하는 언어로 작성할 수 있다.

**0.0.1은 아직 게시하지 않은 배포 후보이다.** 게시·게시 권한·최종 Windows/macOS 검증은 별도 배포 조건이다. 아래 명령은 제공받은 로컬 후보 파일을 설치한다.

## 후보 설치

MCP와 VS Code 확장 중 필요한 연동만 설치하거나 둘 다 사용할 수 있다.

### MCP

**Node.js 24.x**를 설치하고 원하는 디렉터리에서 제공받은 tarball 하나를 설치한다.

```sh
npm install /absolute/path/co-documentation-0.0.1.tgz
```

실행 코드와 의존성이 포함되어 모노레포·내부 tarball·TypeScript 변환기·추가 빌드가 필요하지 않다. 실행 명령은 `codocs`다.

로컬 stdio MCP 클라이언트에 설치된 실행 파일과 **절대 프로젝트 경로**를 설정한다.

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

Windows command에는 `C:\absolute\install\node_modules\.bin\codocs.cmd`를 지정한다(JSON 백슬래시는 두 번 작성). 클라이언트별 설정 형식은 다르므로 stdio와 같은 명령·인자를 지정한다. Windows 명령 wrapper를 실행하지 못하는 클라이언트에서는 `node`에 설치된 `node_modules/co-documentation/dist/runtime/cli.js` 경로와 같은 인자를 전달한다.

`--project`는 `.codocs`가 아닌 이를 포함하는 프로젝트 디렉터리다. 생략하면 서버 시작 시 작업 디렉터리를 사용하고 상대 경로도 그 위치에서 해석한다. 상위 폴더에서 프로젝트를 탐색하지 않는다. stdout은 MCP 전용이고 준비·실패 안내는 stderr로 출력한다. stdin이 종료되면 서버와 watcher를 정리한다.

별도 승인 후 게시할 고정 registry 버전은 `co-documentation@0.0.1`이다. 해당 배포 경로를 쓰기 전에 실제 게시 여부와 이름·계정 권한을 확인한다.

### VS Code

데스크톱 **VS Code 1.100.0 이상**에서 **Extensions: Install from VSIX...**로 `codocs-0.0.1.vsix`를 선택한다. 확장 ID는 `seojaewan.codocs`, 버전은 `0.0.1`이다.

`.codocs`가 있는 프로젝트 폴더를 연 뒤 연결되는 영어 식별자에서 정의를 읽고 YAML 원문 링크를 연다. 언어 서버가 VSIX에 포함되고 VS Code 내장 런타임을 사용하므로 확장에 별도 시스템 Node 설치는 필요하지 않다.

workspace 폴더별 서버·색인은 분리된다. 중첩 workspace에서는 가장 가까운 포함 폴더에 연결하고 workspace 밖 파일은 매칭하지 않는다. 없는 `.codocs`를 자동 생성하지 않으며 사용자가 추가하면 색인을 시작한다.

## 지식 작성과 사용

[작성 가이드](docs/guide/README.md)와 [가상 프로젝트](examples/.codocs)를 참고한다. 현재 상세 가이드·예시는 한국어이며 전체 번역은 별도 작업이다.

프로젝트에 `.codocs/order.yaml`을 만든다.

```yaml
id: order
name: Order
domains: [Sales]
definition: |
  An order records a customer's purchase and its fulfillment rules.
```

코드의 `order` 식별자에서 문서로 연결할 수 있다. Codocs는 지식·참조를 제공하며 코드 이름을 자동 변경하거나 자연어 정책 준수를 판정하지 않는다.

| MCP 도구          | 역할                                 |
| ----------------- | ------------------------------------ |
| `codocs_list`     | 필터·커서로 목록 조회                |
| `codocs_get`      | 현재 ID·원문·참조·revision 조회      |
| `codocs_refresh`  | 전체 색인 재구성과 색인 실패 후 복구 |
| `codocs_validate` | 프로젝트·파일 진단 확인              |
| `codocs_write`    | 문서 생성 및 읽은 revision으로 수정  |
| `codocs_guide`    | 색인과 독립된 작성·갱신·복구 안내    |

수정 전에 `codocs_get`으로 읽고 응답의 revision을 사용한다. 충돌하면 다시 읽고 수정안을 검토하며 새 revision을 무조건 대입하지 않는다. 디스크 저장과 색인 갱신 결과는 별개다. 저장 후 색인만 실패하면 파일을 보존하고 원인을 해결한 뒤 `codocs_refresh`를 호출한다. 준비·refresh 진행 중에는 반복 재시작하지 않고 기다린다. [갱신](docs/guide/updating.md)과 [검증](docs/guide/validation.md) 안내에서 복구 절차를 확인한다.

VS Code 서버 시작 문제를 해결한 뒤 **Codocs: Restart Language Servers**를 실행한다. 해당 workspace의 Codocs 출력·상태 상세를 확인하고 문서 파싱·접근 실패와 서버 연결 실패를 구분한다.

## 지원 범위와 제한

로컬 디스크의 Windows·macOS를 배포 대상으로 한다. 검증 결과는 실제 OS·CPU·Node·VS Code 조합에 한정된다. 이 후보는 **최종 두 OS 및 최신 stable 검증 완료를 주장하지 않는다.** Linux·WSL·컨테이너·SSH/원격 workspace·네트워크 공유는 현재 지원 범위 밖이다.

0.0.1은 초기 실험 버전이다. 자동완성·코드 자동 이름 변경·의미 검색·원격 MCP·프로세스 간 트랜잭션 저장을 보장하지 않는다. revision을 확인하지만 프로세스 간 잠금·트랜잭션은 없으므로 동시 편집을 조정하고 충돌 결과를 확인한다.

문서 1,000개에서 초기 준비 2초, 호버/MCP 조회 p95 100ms, 변경 반영 500ms는 참고 목표이며 실측값이나 보장이 아니다. 최종 후보의 실측과 미측정 범위를 별도로 기록해야 한다.

## 빌드와 검증

`.node-version`의 Node와 pnpm `10.34.5`를 사용한다.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm release:pack
pnpm release:verify /absolute/path/co-documentation-0.0.1.tgz /absolute/path/codocs-0.0.1.vsix
pnpm test:vscode --vsix /absolute/path/codocs-0.0.1.vsix --mcp-tgz /absolute/path/co-documentation-0.0.1.tgz
node packages/vscode/test-runner/lifecycle.mjs --vsix /absolute/path/codocs-0.0.1.vsix
```

`release:pack`은 고유 `.workbench/release/candidate-*`에 한 번 빌드하고 `release.json`에 파일 해시를 기록한다. 검증은 입력 파일을 재빌드하지 않는다. 단독 검사는 저장소 밖에 tarball 하나를 offline 설치하고 설치된 bin으로 stdio를 검사한다. 내부 패키지 소비 검사도 `pnpm check`에서 유지한다.

산출물 인자를 생략한 VS Code·lifecycle 실행기는 현재 소스를 빌드·패키징한다. 격리 프로필을 쓰며 실제 창이 표시될 수 있다. `--vscode-version x.y.z`로 버전을 고정하고 `node packages/vscode/test-runner/run.mjs --resolve-version stable`로 다음 실행에 고정할 버전을 조회한다. 성능은 같은 실행기의 `--mode performance`로 선택하고 `pnpm bench --help`를 참고한다. Windows symlink 검사는 권한·개발자 모드가 필요하며 준비 실패는 통과가 아니다.

일반 커밋 훅은 staged 파일 서식·린트 적용 후 독립 staged-tree에서 설치·타입·린트·빌드·로직 검사를 수행한다. IDE·lifecycle·패키지 소비·성능 증거는 별도로 수집한다. 내부 패키지 경계·기여 규칙은 [프로젝트 지식 읽기 안내](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/index.yaml)에서 확인한다. 내부 패키지를 새 공개 JavaScript API로 제공하지 않는다.

## 라이선스

MIT — [LICENSE](LICENSE)를 참고한다. 번들 의존성 라이선스 원문은 `dist/THIRD-PARTY-NOTICES.txt`, VSIX 서버는 `dist/server/THIRD-PARTY-NOTICES.txt`에도 포함한다.

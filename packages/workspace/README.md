# workspace

프로젝트 루트 선택과 논리 경로·실제 대상·읽기/쓰기 범위 판정을 담당하는 IO 경계다. 순수 검증과 진단 코드·고정 문구는 `@codosc/core` 공개 진입점만 소비한다. `src/projectRoot`는 루트 선택·확인, `src/paths`는 연결 경로 해석·범위 판정, `src/diagnostics`는 확인된 경로와 실제 시스템 오류 코드 전달을 담당한다.

공개 진입점은 `@codosc/workspace`이며 다른 패키지의 내부 경로·subpath import를 금지한다. tsc는 core 다음에 ESM `dist/index.js`와 `dist/index.d.ts`를 생성한다. ES2022·NodeNext·type module·상대 `.js` import를 유지하고 Node IO를 사용하는 workspace에만 `types: [node]`를 활성화한다. 공개 반환 타입은 Node Stats 같은 FS 내부 타입을 노출하지 않는다.

```ts
import { resolveProjectRoot, resolveWorkspacePath } from '@codosc/workspace';

const selected = await resolveProjectRoot({ project: '../app' });
if (selected.success) {
  const checked = await resolveWorkspacePath(
    selected.root,
    '.codocs/공통/terms.yaml',
  );
  if (checked.success)
    console.log(checked.path, checked.realPath, checked.access);
  else console.log(checked.status, checked.diagnostics);
}
```

`resolveProjectRoot(options?: unknown): Promise<ProjectRootResult>`는 객체 옵션의 `cwd/project`를 검증한다. cwd 생략 시 호출 시점의 `process.cwd()`를 고정한다. project 생략 시 그 cwd를 루트로 선택하고 상대 project는 시작 cwd 기준으로 해석한다. 상위 `.codocs`나 Git을 탐색하지 않는다. 선택 루트의 디렉터리 여부·읽기/탐색 권한·실제 경로를 확인한 성공 결과는 `root`를 제공한다. 실패에는 진단과 확인한 논리 선택 경로만 있고 실제 루트는 없다. `.codocs` 부재는 루트 선택을 바꾸지 않는다. 옵션 접근자·Proxy 오류도 실패 진단으로 반환한다.

`resolveWorkspacePath(root: ProjectRoot, input: unknown): Promise<WorkspacePathResult>`는 프로젝트 상대 `.codocs/...` 경로 또는 선택 루트 아래의 논리 절대 경로를 받는다. `.codocs` 자체가 폴더 링크여도 동일하게 해석한다. 성공에는 논리 절대 `logicalPath`, 프로젝트 상대 `path`, 확인한 `realPath`, 대상 종류 `kind`, 마지막 경로의 `isSymbolicLink`, 가장 가까운 연결의 `scope`와 `access`가 있다. 대소문자·유니코드를 임의 변환하거나 같은 실제 대상의 논리 별칭을 합치지 않는다.

파일 링크는 해당 파일만 편입하고 폴더 링크는 그 하위를 편입한다. 연결 대상의 실제 외부 경로 직접 입력은 거부한다. `..`는 일반 하위 폴더 또는 연결 폴더 내부에서 부모로 돌아올 때만 허용하며 `.codocs` 또는 현재 연결 루트 밖으로 넘어가면 거부한다. 전체 입력을 먼저 정규화하여 `link/..`를 지우지 않는다. `.codocs/공통/하위/../terms.yaml`은 연결 루트 안에서 허용하지만 `.codocs/공통/../형제.yaml`은 거부한다. 파일 뒤의 폴더 탐색도 허용하지 않는다.

성공의 `access.read/write: true`는 현 시점 연결 범위 정책이며 OS 파일 읽기/쓰기 성공을 보장하지 않는다. 조회는 루트·대상을 확인하지만 파일 원문 읽기·폴더 열거·실제 저장은 수행하지 않는다. 루트는 각 경로 확인 시 다시 검증하며 실제 writer는 쓰기 시 링크 대상을 다시 확인해야 한다. 링크 유지 저장·대상 교체 충돌·watcher·색인·공유 대상 잠금·YAML 탐색/파싱 연결·가지별 순환 중단은 후속 작업이다.

실패 `status`는 `denied`(입력 또는 범위 거부), `missing`(유효한 루트의 `.codocs` 자체 부재), `unavailable`(깨진 링크·잘못된 대상·대상 확인 실패)이다. 존재하는 깨진 `.codocs` 링크를 부재로 반환하지 않는다. 확인하지 못한 원문·실경로·ID·좌표는 만들지 않는다. 진단은 core의 `workspaceDiagnosticCodes/workspaceDiagnosticMessages`와 선택적인 실제 `ioCode`를 사용한다. 후속 로더는 `.codocs` 부재를 정상 빈 프로젝트로, 실제 루트/IO 오류를 실패로 분리해야 한다.

기능과 test는 `src/기능/`에 함께 두며 build에서 test/spec를 제외한다. `pnpm exec vitest run packages/workspace/src/projectRoot packages/workspace/src/paths`는 테스트마다 고유한 실제 임시 파일·폴더·링크를 만들고 자기 fixture만 정리한다. 루트 선택·잘못된 루트·체인·별칭·범위 탈출·깨진 링크·실제 권한 실패·정책과 OS 권한 구분을 확인한다. `pnpm typecheck`는 공개 선언을 순차로 준비한다. 이번 경로 기능 검증은 macOS arm64 / Node 24.21.0 / pnpm 10.34.5에서 수행한다. Windows 정션·다른 OS/Node 버전과 소스 없는 로더 소비는 미검증이다. 기존 Windows x64 진입점/빌드 검증과 구분한다.

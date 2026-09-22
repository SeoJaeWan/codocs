# Windows·macOS 성능 재현

같은 Git SHA에서 Node 24.21.0, pnpm 10.34.5를 사용한다. 각 OS에서 `pnpm install --frozen-lockfile`과 `pnpm build`를 실행한 뒤, 다른 측정과 겹치지 않게 전용 fixture·output 경로를 지정한다. OS 파일 캐시는 강제로 비우지 않으며 JSON에 상태를 남긴다. 이 명령은 로컬 기능 검사, CI 환경 계약, 커밋 검사에 포함되지 않는다.

```sh
pnpm performance:cod14 --documents 1000 --seed cod14-fixed-seed-v1 --startup-runs 10 --warmup-runs 100 --query-runs 1000 --propagation-runs 100 --output .workbench/cod19-performance --fixture-root .workbench/cod19-performance-fixtures
```

같은 명령을 Windows PowerShell과 macOS 터미널에서 사용한다. 결과는 `cod14-performance.json`과 한국어 `cod14-performance.md`, 프로세스별 JSONL 진행 기록에 남는다. 초기 준비는 생성 완료 직후 새 Node 프로세스 시작부터 첫 준비 완료 조회까지, 상세 1·10·20은 공개 `codocs_get` 호출부터 반환까지, 외부 변경은 실제 쓰기 완료부터 변경 내용의 공개 조회 확인까지 측정한다. 워밍업은 지연 통계의 분모에서 제외한다. 오류·중단·미완료와 정확성 및 시간 목표 비교는 구분한다.

실제 설치된 VS Code Hover는 다음 동일 옵션으로 실행한다. `--vsix`에는 해당 SHA로 빌드·패키징한 VSIX를 지정한다. 저장소 루트에서 `pnpm build`를 실행한 다음, 두 OS에서 같은 순서로 패키징한다.

```sh
cd packages/vscode
pnpm dlx @vscode/vsce@3.6.2 package --no-dependencies --out ../../.workbench/codocs-0.0.0.vsix
cd ../..
```

기본 VS Code 1.100.0은 공통 런타임의 무결성 확인 캐시에서 준비하며, `--code-version`으로 양쪽 OS에서 같은 다른 정식 버전을 선택할 수 있다. `node tools/extension-host/run.mjs --help`에 전체 옵션이 있다.

```sh
node tools/extension-host/run.mjs --vsix .workbench/codocs-0.0.0.vsix --hover-performance --documents 1000 --warmup-runs 100 --query-runs 1000 --code-version 1.100.0 --output .workbench/cod19-hover
```

Windows에서는 전용 숨김 데스크톱·Job 안에서 설치, 실행, 관측, 정리를 수행한다. 실제 Hover 결과는 `.workbench/cod19-hover.json`, `.md`, `.progress.jsonl`에 기록한다. macOS는 현재 검증된 GUI 세션 격리 어댑터가 없어 이 명령이 창을 시작하기 전 준비 실패로 끝난다. Mac 코어 성능 명령은 이 제약과 독립적으로 실행 가능하다. Mac Hover와 `pnpm test:vscode`는 별도 GUI 세션 또는 VM 격리 및 외부 화면·포커스 관측을 구현하고 같은 SHA에서 재실행하기 전까지 미검증이다.

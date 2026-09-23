# Windows·macOS 성능 재현

같은 Git SHA에서 Node 24.21.0, pnpm 10.34.5를 사용한다. 각 OS에서 `pnpm install --frozen-lockfile`과 `pnpm build`를 실행한 뒤, 다른 측정과 겹치지 않게 전용 fixture·output 경로를 지정한다. OS 파일 캐시는 강제로 비우지 않으며 JSON에 상태를 남긴다. 이 명령은 로컬 기능 검사, CI 환경 계약, 커밋 검사에 포함되지 않는다.

```sh
pnpm bench --documents 1000 --seed cod14-fixed-seed-v1 --startup-runs 10 --warmup-runs 100 --query-runs 1000 --propagation-runs 100 --output .workbench/cod19-performance --fixture-root .workbench/cod19-performance-fixtures
```

같은 명령을 Windows PowerShell과 macOS 터미널에서 사용한다. 결과는 `cod14-performance.json`과 한국어 `cod14-performance.md`, 프로세스별 JSONL 진행 기록에 남는다. 초기 준비는 생성 완료 직후 새 Node 프로세스 시작부터 첫 준비 완료 조회까지, 상세 1·10·20은 공개 `codocs_get` 호출부터 반환까지, 외부 변경은 실제 쓰기 완료부터 변경 내용의 공개 조회 확인까지 측정한다. 워밍업은 지연 통계의 분모에서 제외한다. 오류·중단·미완료와 정확성 및 시간 목표 비교는 구분한다.

실제 VS Code Hover 성능 측정은 [후속 PR #33](https://github.com/SeoJaeWan/codocs/pull/33)에서 별도로 구현한다. 이전 전용 실행기는 제거했으며 현재 `pnpm bench` 결과에는 실제 IDE Hover 지연이 포함되지 않는다.

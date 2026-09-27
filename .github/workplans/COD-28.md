# COD-28 — 0.0.1 배포 후보의 통합 검증

이 파일은 사용자가 승인한 로컬 execute-task 실행 기록이다. 원격 PR #25와 Memory의 immutable prepare artifact를 변경하지 않는다.

- 실행: `wb-prepare-20260927T111517Z-8249a22b31f2-5eaf0e`, intent/1
- 기준: TASK-001 `fea2375c8c3675f34e4e52f63d7a5e0b002aa7ea`를 포함한 TASK-002 `95a628fc1f2b8772c51c9792e0a2c8edf69f935a`
- 계획 artifact: `01a0e2a2-e642-78a6-a803-6e1ba0f865d2`
- 계획 SHA-256: `7c101d8a0ca551da0fcc9a126a87af994676aa6f621ae667c69c6970e2d0f1fc`
- INT-001 source packet: `253ceacf51d15c8e6234351ce2a7dc06a7a44c5deccafd5209d56b9a55e0453d`
- INT-001 binding: `b020508dd070a677c33747f6e60cd53c46cc16442dbc6540f6883966031cb067`

소유 범위 안에서 오래된 revision 거부 시험의 준비 상태 가정을 수정하고, 기능 CI가 같은 tgz·VSIX를 Windows/macOS에서 검사하도록 연결했다. 제품의 준비 guard·원본 보존·revision 확인·현재 동시성 한계는 바꾸지 않았다.

최종 실행 결과·지원 매트릭스·게시 전 체크리스트는 [통합 결과](COD-28-results/integration.md)에 기록한다. macOS와 게시 권한의 미확인은 Windows 통과로 대체하지 않는다. 실제 게시·push·PR 변경·main 통합·기존 작업 공간 정리는 승인 범위 밖이며 수행하지 않았다.

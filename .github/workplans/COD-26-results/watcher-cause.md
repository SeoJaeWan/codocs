# watcher 종료 경합의 원인과 수정

종료 중인 하위 폴더 경로 확인이 완료된 뒤 새 OS 감시 연결이 만들어져 Node 자식이 종료하지 않는 결함이었다. `#prepareDirectory`가 두 비동기 경로 확인 이전에만 현재 세대를 검사했으며, `close`는 그때 존재하는 연결만 정리했다.

[실제 IO 관측](watcher-natural-failure.json)에서 close1047.85ms → 경로 확인1051.63ms → closed=true인 새 connect1051.67ms →15초 timeout을 확인했다. [native 핸들 기록](watcher-native-handles.json)에는 close 뒤 생성된 deep 폴더와 alpha.yaml의 FSWatcher/FSEventWrap2개가 남았다. 스택은 Chokidar의 `_addToNodeFs → _handleDir/_handleFile → _watchWithNodeFs → setFsWatchListener → createFsWatchInstance → fs.watch`로 이어진다.

진단에서는 watcher 내부를 대기시키지 않고 별도16개 Node 프로세스가 진단 폴더의 실제 파일을 write/lstat/realpath/read하도록 했다. 같은 물리 경로와 하나의 계속 실행되는 IO workload에서 [기준 A/B/A](watcher-aba-summary.json)는 guard 없음3/4 실패 → guard0/4 실패 → guard 제거1/4 실패였다. guard4회 중3회는 실제 close 뒤 늦게 끝난 경로 확인을 차단했다. [guard run1](watcher-guard-pass.json)은 close1235.31ms 뒤1364.51/1390.60ms에 종료 상태를 재확인해 자연 종료했다.

[관측 없는 원래 child](watcher-raw-original-summary.json)도 기준에서2/4 실패했고, [변경 tree 대조](watcher-modified-summary.json)는 원래 child4/4 실패·관측3/4 실패·guard0/4 실패였다. 기준과 변경 watcher 번들은 바이트까지 같았다. 따라서 가이드 변경 전에 존재한 경합이며, 경로 확인이 close 전후 어느 쪽에 끝나는지에 따라 결과가 달라진다. 과거 두 실패 자체에는 핸들 기록이 없어 각각의 내부 순서를 소급 증명했다고 주장하지 않는다.

intent/3에서 제품에는 경로 확인 뒤 연결 조회/생성 전에 `#active(epoch)`를 재검사하는 한 줄을 추가했다. 기존 실제 등록 테스트는 유지하고 별도 child 모드로 `fs.promises.realpath`의 실제 확인 결과 반환을 제어한다. 경로 확인 도달 → close 완료 → 결과 반환 순서를 확정하고 자식의 자연 종료를 검사한다.

[guard 전 회귀](watcher-regression-before.txt)는 close902ms 이후15초 제한에서 실패했다. guard 후에는 새 회귀와 기존 watcher·MCP·write·query를 포함한 [204개 집중 검사](intent3-focused.txt)가 통과했다. 대기 한도를 늘리거나 process.exit로 종료를 숨기지 않았고 진단 부하 실험은 상시 테스트에 포함하지 않았다.

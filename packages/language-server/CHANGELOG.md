# @codocs/language-server

## 0.0.2

### Patch Changes

- fa61fc1: Code reference watching now follows the collection rules (Git-tracked files and the project `.gitignore`) instead of the whole project, rebuilds only when those rules change, and recovers automatically from watch errors such as EPERM when a folder is deleted and recreated, instead of staying incomplete. The IDE shows "감시 재연결 중" while it reconnects.

  코드 참조 감시가 프로젝트 전체 대신 수집 규칙(Git 추적 파일과 프로젝트 `.gitignore`)을 따르고, 해당 규칙이 바뀔 때만 다시 구성하며, 폴더 삭제 후 재생성 시 발생하는 EPERM 같은 감시 오류에서 자동으로 복구되어 "수집 불완전" 상태에 머물지 않는다. 재연결하는 동안 IDE에는 "감시 재연결 중"이 표시된다.

- a4f2418: Code reference links no longer underline whitespace, and code links stay visible and clickable while references are re-collected. Refreshes now check only the changed paths instead of the whole project, and hover no longer re-requests after unrelated changes.

  코드 참조 링크가 공백에 밑줄을 긋지 않고, 코드 연결을 다시 수집하는 동안에도 링크가 계속 보이고 클릭할 수 있다. 갱신은 프로젝트 전체 대신 바뀐 경로만 확인하며, 관련 없는 변경 뒤에는 hover가 다시 요청되지 않는다.

- Updated dependencies [fa61fc1]
- Updated dependencies [a4f2418]
  - @codocs/workspace@0.0.2

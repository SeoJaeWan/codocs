---
'@codocs/workspace': patch
'@codocs/language-server': patch
'codocs': patch
---

Code reference watching now follows the collection rules (Git-tracked files and the project `.gitignore`) instead of the whole project, rebuilds only when those rules change, and recovers automatically from watch errors such as EPERM when a folder is deleted and recreated, instead of staying incomplete. The IDE shows "감시 재연결 중" while it reconnects.

코드 참조 감시가 프로젝트 전체 대신 수집 규칙(Git 추적 파일과 프로젝트 `.gitignore`)을 따르고, 해당 규칙이 바뀔 때만 다시 구성하며, 폴더 삭제 후 재생성 시 발생하는 EPERM 같은 감시 오류에서 자동으로 복구되어 "수집 불완전" 상태에 머물지 않는다. 재연결하는 동안 IDE에는 "감시 재연결 중"이 표시된다.

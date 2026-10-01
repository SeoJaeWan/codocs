---
'@codocs/workspace': patch
'@codocs/language-server': patch
'codocs': patch
---

Code reference links no longer underline whitespace, and code links stay visible and clickable while references are re-collected. Refreshes now check only the changed paths instead of the whole project, and hover no longer re-requests after unrelated changes.

코드 참조 링크가 공백에 밑줄을 긋지 않고, 코드 연결을 다시 수집하는 동안에도 링크가 계속 보이고 클릭할 수 있다. 갱신은 프로젝트 전체 대신 바뀐 경로만 확인하며, 관련 없는 변경 뒤에는 hover가 다시 요청되지 않는다.

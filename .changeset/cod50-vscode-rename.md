---
'@codocs/language-server': patch
'codocs': patch
---

Add document rename in VS Code: pressing F2 on a `.codocs` document's `name` value or on a resolved `[[reference]]` previews the rename, asks which document each ambiguous reference should point to (closing the picker leaves it unresolved), and then writes the shared rename engine's result to disk and reports it. If any affected file has unsaved changes, the rename stops before writing and lists those files. The language server gains `codocs/prepareRename`, `codocs/planRename` and `codocs/applyRename` requests.

VS Code에서 문서 이름 변경을 추가한다. `.codocs` 문서의 `name` 값이나 확정된 `[[참조]]`에서 F2를 누르면 이름 변경을 미리 계산하고, 모호한 참조마다 가리킬 문서를 고르게 한 뒤(목록을 닫으면 미해결로 남김) 공유 이름 변경 엔진의 결과를 디스크에 쓰고 결과를 알린다. 영향받는 파일에 저장하지 않은 수정이 있으면 쓰기 전에 중단하고 그 파일을 알린다. language server에 `codocs/prepareRename`, `codocs/planRename`, `codocs/applyRename` 요청이 추가된다.

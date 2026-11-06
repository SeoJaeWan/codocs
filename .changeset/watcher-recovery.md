---
'@codocs/mcp': minor
'@codocs/workspace': minor
'codocs': patch
---

File watching now recovers on its own and no longer stalls the server. When watching stops, Codocs reconnects right away; if that fails it keeps retrying after 1s, 5s and 30s and then every 60s, and the interval resets once it reconnects. While it waits, lookups answer from the last completed index and validate and write stay blocked as before, and `codocs_refresh` reconnects immediately instead of waiting. Changes made while watching was stopped are picked up by a full recheck after reconnecting; they no longer make the server re-run the scan in a loop that blocked every request. Watching stopping, failing to reconnect and recovering are each logged to stderr with the cause, and a repeated failure with the same cause is logged only once. When the MCP server is started without `--project` in a folder that has neither `.git` nor `.codocs`, it no longer scans everything below that folder; each tool returns `project_root_unconfirmed` asking you to set `--project`.

파일 감시가 스스로 복구하며 더 이상 서버를 멈추지 않는다. 감시가 끊기면 바로 다시 연결하고, 실패하면 1초·5초·30초 뒤, 그 뒤로는 60초마다 계속 다시 연결하며 연결되면 간격을 처음으로 되돌린다. 기다리는 동안 조회는 마지막으로 완료한 색인으로 답하고 검증·저장은 지금처럼 막으며, `codocs_refresh`는 기다리지 않고 바로 다시 연결한다. 감시가 끊긴 동안의 변경은 다시 연결한 뒤 전체를 다시 확인해 반영하며, 이 변경 때문에 서버가 스캔을 끝없이 반복해 모든 요청에 응답하지 못하던 문제를 고쳤다. 감시가 끊기거나, 다시 연결하지 못하거나, 복구되면 원인과 함께 stderr에 남기고, 같은 원인의 반복 실패는 한 번만 남긴다. MCP 서버를 `--project` 없이 `.git`도 `.codocs`도 없는 폴더에서 시작하면 그 아래 전체를 탐색하지 않고, 도구마다 `project_root_unconfirmed`로 `--project` 지정을 안내한다.

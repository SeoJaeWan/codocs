---
'@codocs/mcp': minor
'@codocs/workspace': minor
'@codocs/core': minor
---

`codocs_write` can now check for duplicated content before saving. Set `CODOCS_REVIEW_API_KEY` in the MCP server's environment to turn it on: for a request that would otherwise be saved, the sentences it newly writes (slightly edited sentences excluded) and up to 10 nearby sections from other documents are sent to the chosen model provider (Anthropic by default, model `claude-haiku-5-5`). If they restate content from another document, nothing is saved and the result is `duplicate_content` with the overlapping sentence pairs in `overlaps` and a `reviewToken`; resending the same request with that token saves it without another check. Overlaps that only show another document copying this one are saved and reported, and a failed check saves with a `review_failed` warning. Provider, model and excluded paths (`.gitignore` syntax) can be set with `CODOCS_REVIEW_PROVIDER`, `CODOCS_REVIEW_MODEL` and `CODOCS_REVIEW_EXCLUDE`, or in an optional `codocs.config.yaml` at the project root. Without the key nothing is sent and `codocs_write` behaves exactly as before.

`codocs_write`가 저장하기 전에 중복된 내용을 확인할 수 있다. MCP 서버 환경 변수에 `CODOCS_REVIEW_API_KEY`를 넣으면 켜지며, 저장될 수 있는 요청이 새로 쓴 문장(조금 고친 문장 제외)과 다른 문서에서 가까운 섹션 최대 10개를 사용자가 고른 모델 제공자(기본 Anthropic, 모델 `claude-haiku-5-5`)에게 보낸다. 다른 문서의 내용을 다시 적었다고 보면 저장하지 않고 `duplicate_content`와 겹치는 문장 쌍 `overlaps`, `reviewToken`을 돌려주며, 같은 요청에 그 값을 붙여 다시 보내면 확인 없이 저장한다. 다른 문서가 이 글을 옮겨 적은 겹침만 있으면 저장하고 알려 주고, 확인하지 못하면 `review_failed` 경고와 함께 저장한다. 제공자·모델·제외 경로(`.gitignore` 문법)는 `CODOCS_REVIEW_PROVIDER`·`CODOCS_REVIEW_MODEL`·`CODOCS_REVIEW_EXCLUDE` 또는 프로젝트 루트의 선택 파일 `codocs.config.yaml`로 정한다. 키가 없으면 아무것도 보내지 않고 `codocs_write`는 지금과 똑같이 동작한다.

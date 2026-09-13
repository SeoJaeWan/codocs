# .codocs 작성 가이드 골격

이 문서는 후속 파서와 도구의 구현을 위한 작성 계약이다. 현재 파싱, 스키마 검증, 참조 해석, Hover, MCP guide 도구와 사용자 문서 저장 기능은 구현하지 않았다.

가상 프로젝트 예시는 `examples/.codocs`에 있다. 예시의 업무 사실은 모두 가상이다. term 필드는 `type/id/name/definition/domain`, knowledge 필드는 `type/id/title/body/domains`다. ID는 `^[a-z0-9]+(?:-[a-z0-9]+)*$`에 맞춘다.

참조는 `definition`, `examples`, `body` 본문에서 `[[id]]`로 표시한다. 후속 구현은 외부 YAML을 unknown으로 받고 구조와 의미, 중복 ID 및 없는 참조를 검증해야 한다. 이 골격은 검증 구현이나 실제 업무 정의가 아니다.

개발 Prettier 검사는 저장소의 가상 예시에만 적용한다. 사용자 .codocs 저장 시 문서 전체를 재포맷하는 동작은 제공하지 않는다. 가이드와 예시는 MCP 및 VS Code의 dist asset에 복사하지만 도구 API와 VSIX 배포 기능은 아직 없다.

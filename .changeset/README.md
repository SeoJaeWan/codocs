# Changesets

기능·수정 PR에서 `pnpm changeset`으로 미출시 기록을 추가한다. npm 제품은
`@codocs/mcp`, VS Code 제품은 `codocs`를 선택한다. 공통 코드가 두 제품에
영향을 주면 두 대상을 모두 기록한다. 경로로 배포 대상이나 변경 수준을 추정하지 않는다.

실제 버전·changelog는 릴리스 브랜치에서 공식 `pnpm release:version`으로만
계산한다. 기능 PR마다 버전을 올리지 않는다. private 내부 패키지의 버전 전파도
공식 CLI가 처리하며 두 제품의 fixed/linked 그룹을 만들지 않는다.

# workspace

파일 탐색, 읽기/쓰기, 인덱싱과 workspace 상태를 담당할 IO 경계다. 순수 검증은 `@codosc/core`를 사용한다. 현재 진입점은 빈 모듈이며 파일 처리와 상태 관리, 오류 복구는 구현하지 않았다.

허용 내부 의존성은 `@codosc/core`의 공개 진입점이다. 패키지 사이의 상대 경로와 하위 경로 import는 금지한다. `private`는 npm 게시 정책이며 프로젝트 내부 API의 가시성과 별개다. 초기 타입은 `src/index.ts`, 실행 출력은 후속 빌드의 `dist/index.js`다.

구현 시 `src/기능/index.ts`, `src/기능/기능.test.ts`를 함께 배치한다. README에는 입력/출력, 실제 IO와 상태 전이, 오류 전달, 실제 파일로 시험한 범위를 적는다. 현재 IO 기능 테스트는 없고 개발 규칙만 검증한다.

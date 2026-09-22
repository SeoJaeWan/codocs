import { main } from '../vscode-tests/run.mjs';
console.log(
  'test:ui는 실제 provider·명령 API 검사인 test:vscode로 이전되었습니다. 화면 렌더링/마우스 제스처 검사는 포함하지 않습니다.',
);
await main();

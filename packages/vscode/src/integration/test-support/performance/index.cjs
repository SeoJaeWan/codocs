/** 후속 측정 모듈이 시나리오별로 이 공식 Extension Host 진입점을 확장한다. */
exports.run =
  /** 미구현 시나리오를 성공으로 보고하지 않는다. */ async function run() {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const config = JSON.parse(
      await fs.readFile(process.env.CODOCS_VSCODE_CONFIG, 'utf8'),
    );
    const scenario = config.performanceSession?.scenario ?? 'unknown';
    const message = `성능 시나리오 ${scenario} 측정 모듈을 사용할 수 없습니다`;
    await fs.writeFile(
      path.join(config.output, `scenario-error-${scenario}.json`),
      JSON.stringify({ scenario, error: message }),
    );
    throw new Error(message);
  };

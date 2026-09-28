const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { uiContext } = require('./test-support/ui-context.cjs');
const { scenarios } = require('./extension.test.cjs');

/** 설치 준비는 API 응답으로 확인하고 기능은 실제 renderer 입력으로 검사한다. */
exports.run = /** 현재 UI 입력·응답 관측을 연결한다. */ async function run() {
  const config = JSON.parse(
    await fs.readFile(process.env.CODOCS_VSCODE_CONFIG, 'utf8'),
  );
  const { connectRenderer, until } =
    await import('../../test-runner/ui/driver.mjs');
  const environment = {
    vscode: vscode.version,
    platform: process.platform,
    packageKind: 'installed-vsix',
    renderedUi: true,
    vsixSha256: config.vsixSha256,
  };
  const results = [];
  let driver;
  try {
    const assert = require('node:assert/strict');
    assert.equal(vscode.version, config.version);
    const extension = vscode.extensions.getExtension('seojaewan.codocs');
    assert.ok(extension, 'installed VSIX registration');
    assert.equal(
      await fs.realpath(extension.extensionPath),
      await fs.realpath(config.extension),
    );
    await extension.activate();
    assert.ok(extension.isActive);
    environment.extensionPath = extension.extensionPath;
    environment.extensionVersion = extension.packageJSON.version;
    const uri = vscode.Uri.file(
      path.join(config.workspace, '.codocs/old-source.yaml'),
    );
    await until(
      /** 현재 UI 입력·응답 관측을 연결한다. */ () =>
        vscode.languages
          .getDiagnostics(uri)
          .some(
            (item) =>
              (typeof item.code === 'object' ? item.code.value : item.code) ===
              'deprecated_reference',
          ),
      'installed server diagnostic response',
    );
    await fs.writeFile(
      path.join(config.output, 'installation.json'),
      JSON.stringify(
        {
          ...environment,
          active: true,
          serverResponse: 'published-diagnostics',
          passed: true,
        },
        null,
        2,
      ),
    );
    driver = await connectRenderer(config.profile);
    const c = uiContext(config, driver, until);
    for (const scenario of scenarios) {
      const result = {
        id: scenario.id,
        passed: false,
        input: 'renderer-mouse',
      };
      try {
        await scenario.run(c);
        result.passed = true;
      } catch (error) {
        result.error = error.stack ?? String(error);
        try {
          await driver.screenshot(
            path.join(config.output, `failure-${scenario.id}.png`),
          );
        } catch (error) {
          result.evidenceError = String(error);
        }
      }
      results.push(result);
      try {
        await c.reset();
      } catch (error) {
        result.passed = false;
        result.cleanupError = String(error);
      }
      await fs.writeFile(
        path.join(config.output, 'functional.json'),
        JSON.stringify({ environment, results }, null, 2),
      );
      if (result.cleanupError)
        throw new Error(`Fixture restoration failed: ${result.cleanupError}`);
    }
    const failures = results.filter((result) => !result.passed);
    if (failures.length)
      throw new Error(
        `Rendered UI failures: ${failures.map((item) => item.id).join(', ')}`,
      );
  } catch (error) {
    await fs.writeFile(
      path.join(config.output, 'functional.json'),
      JSON.stringify(
        { environment, results, error: error.stack ?? String(error) },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    driver?.close();
  }
};
